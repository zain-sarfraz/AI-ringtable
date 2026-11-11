import { getKnex } from "../db.js";
import { getAssistant, startOutboundCall } from "../lib/synthflowClient.js";
import { normalizeE164 } from "../lib/voiceWebhookUtils.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

function agentOutboundFromNumber(agent) {
  const direct = normalizeE164(agent?.phone_number || agent?.caller_id_number || "");
  if (direct) return direct;
  const attached = Array.isArray(agent?.attached_phone_numbers)
    ? agent.attached_phone_numbers
    : [];
  for (const p of attached) {
    const n = normalizeE164(p?.phone_number || p?.number || p || "");
    if (n) return n;
  }
  return null;
}

function canPlaceTestCall(user, restaurantId) {
  if (!user?.id) return false;
  if (user.roles?.includes("super_admin")) return true;
  const onRestaurant = (user.memberships || []).some(
    (m) =>
      m.restaurant_id === restaurantId &&
      ["owner", "admin", "manager"].includes(m.member_role),
  );
  if (onRestaurant) return true;
  return Boolean(user.ownedParentIds?.length && user.restaurantIds?.includes(restaurantId));
}

export async function synthflowTestCall(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const restaurantId = req.body?.restaurant_id;
    const phone = normalizeE164(req.body?.phone);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      return res.status(400).json({
        success: false,
        error: "Enter a phone number with country code, for example +923001234567.",
      });
    }
    if (!canPlaceTestCall(req.user, restaurantId)) {
      return res.status(403).json({ success: false, error: "You cannot place a test call for this restaurant." });
    }

    const restaurant = await knex("restaurants").where({ id: restaurantId }).first();
    if (!restaurant) return res.status(404).json({ success: false, error: "Restaurant not found" });
    if (!restaurant.synthflow_agent_id) {
      return res.status(400).json({ success: false, error: "Create the Synthflow agent first, then place a test call." });
    }

    try {
      const found = await getAssistant(restaurant.synthflow_agent_id);
      const agent = found?.assistant || found?.response || found?.raw || found;
      const fromNumber = agentOutboundFromNumber(agent);
      if (!fromNumber) {
        return res.status(400).json({
          success: false,
          error:
            "This Synthflow agent has no phone number attached, so outbound test calls stay queued and never ring. Attach a free Synthflow number to the agent (do not move the live Pizza Go DID), then try again.",
        });
      }
    } catch (lookupErr) {
      console.warn("Synthflow test call: could not verify agent phone:", lookupErr?.message || lookupErr);
    }

    const result = await startOutboundCall({
      modelId: restaurant.synthflow_agent_id,
      phone,
      name: String(req.body?.name || "Test call").slice(0, 80),
    });

    return res.json({
      success: true,
      call_id: result.call_id,
      phone,
      message: `The agent is calling ${phone}. Answer the phone to test the order flow.`,
    });
  } catch (e) {
    console.error("Synthflow test call error:", e);
    return res.status(500).json({ success: false, error: e.message || "Test call failed" });
  }
}
