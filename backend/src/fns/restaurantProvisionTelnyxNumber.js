import { getKnex } from "../db.js";
import { searchAvailableNumbers, purchaseNumber, listOwnedNumbers } from "../lib/telnyxClient.js";
import { importCustomNumber, updateAgent, findAssistantByPhone } from "../lib/synthflowClient.js";
import { normalizeE164 } from "../lib/voiceWebhookUtils.js";

export async function restaurantTelnyxSearch(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const body = req.body || {};
    const numbers = await searchAvailableNumbers({
      country_code: body.country_code,
      locality: body.locality,
      national_destination_code: body.area_code || body.national_destination_code,
      limit: body.limit || 10,
    });
    return res.json({ success: true, numbers });
  } catch (e) {
    console.error("Telnyx search error:", e);
    return res.status(500).json({ success: false, error: e.message || "search failed" });
  }
}

export async function restaurantTelnyxList(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const numbers = await listOwnedNumbers(100);
    return res.json({ success: true, numbers });
  } catch (e) {
    console.error("Telnyx list error:", e);
    return res.status(500).json({ success: false, error: e.message || "list failed" });
  }
}

/**
 * Purchase (or assign existing) Telnyx number for a restaurant, import into Synthflow.
 */
export async function restaurantProvisionTelnyxNumber(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    const body = req.body || {};
    const restaurant_id = body.restaurant_id;
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error("Restaurant not found");

    let phone = normalizeE164(body.phone_number || body.telnyx_phone_number || "");
    if (!phone) throw new Error("phone_number is required (E.164)");

    // If already assigned to another restaurant:
    // When skip_purchase or reassign is true (e.g. moving the 1 demo number to another restaurant),
    // automatically unassign from the previous restaurant so it can be assigned here.
    const taken = await knex("restaurants")
      .where({ telnyx_phone_number: phone })
      .whereNot({ id: restaurant_id })
      .first();

    let reassignedFrom = null;
    if (taken) {
      if (body.skip_purchase || body.reassign) {
        // Detach phone from previous restaurant's Synthflow agent
        if (taken.synthflow_agent_id) {
          try {
            await updateAgent(taken.synthflow_agent_id, { phone_number: null });
            console.log(`[restaurantProvisionTelnyxNumber] Detached ${phone} from Synthflow agent ${taken.synthflow_agent_id}`);
          } catch (e) {
            console.warn("Could not detach phone from previous Synthflow agent:", e.message);
          }
        }
        await knex("restaurants").where({ id: taken.id }).update({
          telnyx_phone_number: null,
          telnyx_phone_number_id: null,
          telnyx_order_id: null,
          updated_at: knex.fn.now(),
        });
        reassignedFrom = taken.name || `Restaurant ID ${taken.id}`;
        console.log(`[restaurantProvisionTelnyxNumber] Reassigned number ${phone} from ${reassignedFrom} to ${r.name}`);
      } else {
        throw new Error(`Number ${phone} is already assigned to another restaurant (${taken.name || taken.id})`);
      }
    }

    // Also verify if any assistant in Synthflow currently holds this number and detach it
    try {
      const existingAss = await findAssistantByPhone(phone);
      if (existingAss?.model_id && existingAss.model_id !== r.synthflow_agent_id) {
        await updateAgent(existingAss.model_id, { phone_number: null });
        console.log(`[restaurantProvisionTelnyxNumber] Detached ${phone} from previous Synthflow assistant ${existingAss.model_id}`);
      }
    } catch (e) {
      console.warn("Could not detach phone from previous Synthflow assistant:", e.message);
    }

    let provisioned = null;
    if (body.skip_purchase) {
      provisioned = {
        phone_number: phone,
        phone_number_id: body.telnyx_phone_number_id || null,
        order_id: null,
        status: "existing",
      };
    } else {
      provisioned = await purchaseNumber(phone);
      phone = normalizeE164(provisioned.phone_number) || phone;
    }

    // Import into Synthflow so inbound SIP routing can bind the agent
    let synthflowImport = null;
    let importWarning = null;
    try {
      synthflowImport = await importCustomNumber({
        phone_number: phone,
        friendly_name: `${r.name} (${phone})`,
      });
    } catch (e) {
      // Number may already be imported — continue and let agent attach handle assignment
      importWarning = e.message || "Synthflow import failed";
      console.warn("Synthflow number import warning:", importWarning);
    }

    // Attach to current restaurant's Synthflow agent if one already exists
    if (r.synthflow_agent_id) {
      try {
        await updateAgent(r.synthflow_agent_id, { phone_number: phone });
        console.log(`[restaurantProvisionTelnyxNumber] Attached ${phone} to current agent ${r.synthflow_agent_id}`);
      } catch (attErr) {
        console.warn(`[restaurantProvisionTelnyxNumber] Agent attach warning:`, attErr.message);
      }
    }

    await knex("restaurants").where({ id: restaurant_id }).update({
      telnyx_phone_number: phone,
      telnyx_phone_number_id: provisioned.phone_number_id,
      telnyx_order_id: provisioned.order_id,
      voice_provider: "synthflow_telnyx",
      phone: r.phone || phone,
      updated_at: knex.fn.now(),
    });

    return res.json({
      success: true,
      telnyx_phone_number: phone,
      telnyx_phone_number_id: provisioned.phone_number_id,
      telnyx_order_id: provisioned.order_id,
      synthflow_import: synthflowImport,
      reassigned_from: reassignedFrom,
      warning: reassignedFrom
        ? `Number was reassigned from ${reassignedFrom} to ${r.name}.`
        : importWarning,
    });
  } catch (e) {
    console.error("Provision Telnyx number error:", e);
    return res.status(500).json({ success: false, error: e.message || "provision failed" });
  }
}

/**
 * Remove/unassign Telnyx number from a restaurant.
 */
export async function restaurantUnassignTelnyxNumber(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    const body = req.body || {};
    const restaurant_id = body.restaurant_id;
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error("Restaurant not found");

    const oldNumber = r.telnyx_phone_number;

    // Detach phone from Synthflow agent if attached
    if (r.synthflow_agent_id) {
      try {
        await updateAgent(r.synthflow_agent_id, { phone_number: null });
        console.log(`[restaurantUnassignTelnyxNumber] Detached phone from Synthflow agent ${r.synthflow_agent_id}`);
      } catch (e) {
        console.warn(`[restaurantUnassignTelnyxNumber] Could not detach phone from Synthflow agent:`, e.message);
      }
    }

    // Also check if any other assistant in Synthflow has this number and detach it
    if (oldNumber) {
      try {
        const found = await findAssistantByPhone(oldNumber);
        if (found?.model_id) {
          await updateAgent(found.model_id, { phone_number: null });
          console.log(`[restaurantUnassignTelnyxNumber] Detached ${oldNumber} from assistant ${found.model_id}`);
        }
      } catch (e) {
        console.warn(`[restaurantUnassignTelnyxNumber] Could not detach from assistant by phone:`, e.message);
      }
    }

    await knex("restaurants").where({ id: restaurant_id }).update({
      telnyx_phone_number: null,
      telnyx_phone_number_id: null,
      telnyx_order_id: null,
      updated_at: knex.fn.now(),
    });

    console.log(`[restaurantUnassignTelnyxNumber] Unassigned number ${oldNumber} from restaurant ${r.name} (${restaurant_id})`);

    return res.json({
      success: true,
      removed_number: oldNumber,
      message: oldNumber ? `Number ${oldNumber} disconnected successfully.` : "No number was assigned.",
    });
  } catch (e) {
    console.error("Unassign Telnyx number error:", e);
    return res.status(500).json({ success: false, error: e.message || "unassign failed" });
  }
}
