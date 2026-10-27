import { getKnex } from "../db.js";
import { branchArea } from "../lib/branchLocation.js";
import { resolveRestaurantFamilyIds } from "../lib/tableSessions.js";
import { normalizeElevenLabsToolBody, phoneMatchVariants, resolveRestaurantIdForVoiceTools } from "../lib/voiceWebhookUtils.js";

function applyPhoneWhere(qb, phone) {
  const variants = phoneMatchVariants(phone);
  if (!variants.length) return false;
  qb.andWhere(function () {
    for (const v of variants) {
      this.orWhere("customer_phone", v);
    }
  });
  return true;
}

export async function aiCheckPreviousOrder(req, res) {
  res.set("Access-Control-Allow-Origin", "*");

  try {
    console.log("\n" + "-".repeat(40));
    console.log("🔍 CHECK PREVIOUS ORDER / RETURNING CALLER");

    const rawBody = { ...(req.query || {}), ...(req.body || {}) };
    const body = normalizeElevenLabsToolBody(rawBody);

    let phone = body.customer_phone || body.caller_phone || body.twilio_from || body.from || "";
    if (phone === "<user_phone_number>" || /same|this|my\s*number/i.test(String(phone))) phone = "";

    console.log("📍 Caller Phone:", phone || "Not provided");
    console.log("-".repeat(40) + "\n");

    const knex = getKnex();

    let restaurantId = body.restaurant_id ?? null;
    if (!restaurantId && (body.twilio_to || body.elevenlabs_agent_id || body.synthflow_agent_id)) {
      const resolved = await resolveRestaurantIdForVoiceTools(knex, body);
      restaurantId = resolved.id;
    }

    if (!phone || !restaurantId) {
      return res.json({
        found: false,
        has_active_reservation: false,
        has_previous_order: false,
        message:
          "Respond in the restaurant's locked language: Politely ask what they would like to order today. (Do NOT mention phone or previous orders; simply ask what food items they want to order).",
      });
    }

    const familyIds = await resolveRestaurantFamilyIds(knex, restaurantId);
    const ids = familyIds.length ? familyIds : [restaurantId];

    let activeReservation = null;
    const reservationQb = knex("table_reservations")
      .whereIn("restaurant_id", ids)
      .whereIn("status", ["pending", "confirmed"])
      .where("reservation_date", ">=", knex.raw("CURRENT_DATE"))
      .orderBy("reservation_date", "asc")
      .orderBy("start_time", "asc");
    if (applyPhoneWhere(reservationQb, phone)) {
      activeReservation = await reservationQb.first();
    }

    let order = null;
    const orderQb = knex("orders")
      .whereIn("restaurant_id", ids)
      .whereNotIn("status", ["cancelled"])
      .orderBy("created_at", "desc");
    if (applyPhoneWhere(orderQb, phone)) {
      order = await orderQb.first();
    }

    let itemDetails = null;
    let previousItems = [];
    let branchName = null;
    let branchAreaLabel = null;
    if (order) {
      const items = await knex("order_items").where({ order_id: order.id }).orderBy("id", "asc");
      if (items.length) {
        previousItems = items.map((i) => ({
          name: i.item_name,
          quantity: i.quantity,
          notes: i.notes || null,
        }));
        itemDetails = previousItems
          .map((i) => {
            let details = `${i.quantity} ${i.name}`;
            if (i.notes) details += ` (${i.notes})`;
            return details;
          })
          .join(", ");
      }
      const branch = await knex("restaurants").where({ id: order.restaurant_id }).first();
      if (branch) {
        branchName = branch.name;
        branchAreaLabel = branchArea(branch);
      }
    }

    const parts = [];
    if (activeReservation) {
      const when = [
        activeReservation.reservation_date,
        String(activeReservation.start_time || "").slice(0, 5),
      ]
        .filter(Boolean)
        .join(" at ");
      parts.push(
        `Active table reservation for ${when} (party of ${activeReservation.party_size}). ` +
          `Tell them in their LOCKED language that their table is already reserved and they must complete that booking before a new reservation. They may still place food.`,
      );
    }

    if (itemDetails && order) {
      parts.push(
        `Previous food order found. Items: ${itemDetails}. ` +
          `Name: ${order.customer_name || "unknown"}. Phone: ${order.customer_phone || phone}. ` +
          `Fulfillment: ${order.fulfillment_type || "delivery"}. ` +
          `Branch/area: ${branchAreaLabel || branchName || "unknown"}. ` +
          `Address: ${order.delivery_address || "n/a"}. ` +
          `IMPORTANT: If the caller ALREADY named a new item (e.g. burger, pizza) or requested to place a new order, IGNORE THIS PREVIOUS ORDER and proceed with their new request. ONLY ask if they want to repeat if the caller explicitly requested their previous/old order ("kya aap wahi order repeat karna chahengay?"). ` +
          `If YES: do NOT re-collect name/phone/branch from scratch. Tell them these saved details and ask if they want to CHANGE anything (name, phone, branch/area, or delivery/pickup). ` +
          `If they say no changes, reuse everything and go to order summary + place_order with branch_name "${branchName || "none"}". ` +
          `If they change only one field, update that field only and keep the rest.`,
      );
    }

    if (!parts.length) {
      return res.json({
        found: false,
        has_active_reservation: false,
        has_previous_order: false,
        message:
          "Respond in the restaurant's locked language: Politely ask what they would like to order today. (Do NOT say no previous order or table was found; directly ask what food items they want to order).",
      });
    }

    return res.json({
      found: true,
      has_active_reservation: !!activeReservation,
      has_previous_order: !!itemDetails,
      message: `Respond ONLY in the caller's LOCKED language: ${parts.join(" ")}`,
      previous_items: itemDetails,
      previous_items_list: previousItems,
      previous_fulfillment_type: order?.fulfillment_type || null,
      previous_customer_name: order?.customer_name || null,
      previous_customer_phone: order?.customer_phone || phone,
      previous_branch_name: branchName,
      previous_branch_area: branchAreaLabel,
      previous_delivery_address: order?.delivery_address || null,
      previous_order_number: order?.order_number || null,
      reservation_date: activeReservation?.reservation_date || null,
      reservation_time: activeReservation ? String(activeReservation.start_time || "").slice(0, 5) : null,
      party_size: activeReservation?.party_size || null,
    });
  } catch (err) {
    console.error("aiCheckPreviousOrder error:", err);
    return res.json({ found: false, has_active_reservation: false, has_previous_order: false, message: "Error checking previous order." });
  }
}
