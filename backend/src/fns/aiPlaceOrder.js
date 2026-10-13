import { getKnex } from "../db.js";
import { normalizeElevenLabsToolBody, resolveRestaurantIdForVoiceTools } from "../lib/voiceWebhookUtils.js";
import { createPhoneOrder } from "../lib/phoneOrderService.js";

function phoneDigitCount(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function looksLikePhone(value) {
  const n = phoneDigitCount(value);
  return n >= 8 && n <= 15;
}

/** Caller said "same number" / "yahi number" / dialed line — use caller ID instead. */
function isSamePhonePhrase(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const s = raw.toLowerCase();
  if (/^<[^>]+>$/.test(s)) return true;
  if (/^(none|null|n\/a|na|unknown)$/i.test(s)) return true;
  if (looksLikePhone(raw) && !/(same|this|calling|dial|yehi|yahi|isi|wahi)/i.test(s)) return false;
  if (
    /\b(same|this|calling|caller|dial(l)?ed?|my)\b/.test(s) ||
    /\b(yehi|yahi|isi|wahi|ye wala|usi|call wala|dial wala)\b/.test(s) ||
    /(यही|इसी|वही|नंबर|नम्बर|फोन|मोबाइल|اسی|یہی|وہی|نمبر|فون)/.test(raw)
  ) {
    return phoneDigitCount(raw) < 8;
  }
  return false;
}

function resolveCustomerPhone(body) {
  const caller =
    body.caller_phone ||
    body.twilio_from ||
    body.from ||
    body.user_phone_number ||
    body.user_number ||
    null;
  let phone = body.customer_phone;
  if (isSamePhonePhrase(phone) || !looksLikePhone(phone)) {
    phone = looksLikePhone(caller) ? caller : null;
  }
  if (phone && /^<[^>]+>$/.test(String(phone).trim())) phone = null;
  return phone ? String(phone).trim() : null;
}

export async function aiPlaceOrder(req, res) {
  res.set("Access-Control-Allow-Origin", "*");

  try {
    console.log("\n" + "=".repeat(50));
    console.log("🔔 NEW ORDER REQUEST RECEIVED FROM ELEVENLABS!");
    console.log("=".repeat(50));

    const rawBody = req.body || {};
    const body = normalizeElevenLabsToolBody(rawBody);
    if (!body.elevenlabs_agent_id && process.env.ELEVENLABS_AGENT_ID) {
      body.elevenlabs_agent_id = String(process.env.ELEVENLABS_AGENT_ID).trim();
    }

    if (String(body.customer_email || "").trim().toLowerCase() === "none") body.customer_email = null;
    if (String(body.coupon_code || "").trim().toLowerCase() === "none") body.coupon_code = null;

    if (!body.customer_name || !body.items) {
      console.error("❌ Validation Failed: Missing customer_name or items");
      return res.status(200).json({
        message:
          "I'm sorry, I missed some details. Could you please provide your name and the items you'd like to order again?",
      });
    }

    const knex = getKnex();
    const resolved = await resolveRestaurantIdForVoiceTools(knex, body);
    const restaurantId = resolved.id;

    const spokenBranch =
      body.branch_name || body.branch || body.area || body.branch_area || body.city || null;
    console.log("👤 Customer:", body.customer_name);
    console.log("📦 Items:", JSON.stringify(body.items));
    console.log("🏬 Branch spoken:", spokenBranch || "(none)", "| fulfillment:", body.fulfillment_type || "delivery");
    console.log(
      restaurantId
        ? `🏪 Restaurant resolved: ${restaurantId}`
        : `❌ No restaurant_id — ${resolved.error || "unknown"}`,
    );

    if (!restaurantId) {
      const hint = resolved.error || "could not resolve restaurant";
      return res.status(200).json({
        success: false,
        message: `${hint}. Set ELEVENLABS_AGENT_ID + restaurants.elevenlabs_agent_id, send restaurant_id in the tool, or set ELEVENLABS_DEFAULT_RESTAURANT_ID.`,
      });
    }

    let callId = null;
    if (body.call_sid) {
      const c = await knex("calls").where({ twilio_call_sid: body.call_sid }).select("id").first();
      callId = c?.id ?? null;
    }

    const phoneToUse = resolveCustomerPhone(body);
    if (!phoneToUse) {
      return res.status(200).json({
        success: false,
        phone_required: true,
        message:
          "Respond ONLY in the caller's LOCKED language (do not switch). Ask once for their contact phone number, then call place_order again. If they said same/this/calling/dial number, pass customer_phone as \"same\" so we use the dialed caller ID.",
      });
    }

    const { order, reservation, reservationError, unmatched, coupon, totals, assignedBranchName, assignmentStatus } = await createPhoneOrder(knex, {
      restaurantId,
      customer_name: body.customer_name,
      customer_phone: phoneToUse,
      customer_email: body.customer_email || body.email || null,
      delivery_address: body.delivery_address,
      delivery_notes: body.delivery_notes || body.notes || null,
      items: body.items,
      coupon_code: body.coupon_code || body.discount_code || null,
      payment_method: body.payment_method ?? "cash",
      fulfillment_type: body.fulfillment_type || "delivery",
      branch_name: spokenBranch,
      area: body.area || body.branch_area || null,
      branch: body.branch || null,
      delivery_latitude: body.delivery_latitude ?? body.latitude ?? null,
      delivery_longitude: body.delivery_longitude ?? body.longitude ?? null,
      call_id: callId,
      source: "phone",
      ai_extracted_data: { raw: body, provider: "elevenlabs" },
    });

    if (!order) {
      if (reservation) {
        const when = [reservation.reservation_date, String(reservation.start_time || "").slice(0, 5)].filter(Boolean).join(" ");
        const tableBit = reservation.table_number ? ` Table ${reservation.table_number}.` : "";
        const speak = `Your table is reserved for ${reservation.party_size} guests on ${when}.${tableBit} This is a reservation, not a food order.`;
        console.log(`✅ Reservation saved instead of order: id=${reservation.id}`);
        return res.json({
          success: true,
          available: true,
          reservation_id: reservation.id,
          table_number: reservation.table_number || null,
          party_size: reservation.party_size,
          reservation_date: reservation.reservation_date,
          reservation_time: String(reservation.start_time || "").slice(0, 5),
          speak,
          message: `Translate and tell the caller in their language: ${speak} Do not give an order number and do not quote a price.`,
        });
      }
      const message =
        reservationError === "unavailable"
          ? "No table is free at that time. Ask for a different time. Do not create a food order."
          : "A table reservation needs a guest count, date, and time. Do not place it as a menu order and do not quote a price.";
      return res.status(200).json({ success: false, available: false, message });
    }

    console.log(`✅ Order saved: id=${order.id} order_number=${order.order_number} restaurant_id=${order.restaurant_id} status=${assignmentStatus}`);

    const couponNote =
      coupon?.amount > 0
        ? ` Discount ${coupon.code} applied (${coupon.amount.toFixed(2)}).`
        : coupon?.error
          ? ` Coupon not applied (${coupon.error}).`
          : "";
    const branchNote = assignedBranchName ? ` This order is for the ${assignedBranchName} branch.` : "";

    return res.json({
      success: true,
      order_number: order.order_number,
      tracking_code: order.tracking_code,
      total: totals.total,
      branch_name: assignedBranchName,
      discount_amount: coupon.amount,
      speak: order.order_number,
      message: `CRITICAL: Reply in the caller's LOCKED language ONLY — do not switch to English or any other language. Say the order number ${order.order_number} and ask them to save it.${branchNote} Total ${totals.total.toFixed(2)}.${couponNote}`,
    });
  } catch (e) {
    console.error("❌ Order Error:", e);
    if (e.isOutOfStock || e.outOfStock?.length) {
      const itemsList = (e.outOfStock || []).join(", ");
      return res.status(200).json({
        success: false,
        out_of_stock: true,
        message: `Translate and tell the caller in their language: I am sorry, but ${itemsList} is currently out of order and unavailable. Would you like to order another item from our menu instead?`,
      });
    }
    if (e.isBranchError) {
      const areas = (e.availableAreas || []).filter(Boolean);
      const areaList = areas.length ? areas.join(" or ") : "one of our branches";
      console.warn("⚠️ Branch not matched. Requested:", e.requestedBranch, "| areas:", areaList);
      return res.status(200).json({
        success: false,
        branch_required: true,
        requested_branch: e.requestedBranch || null,
        available_areas: areas,
        message: `Respond ONLY in the caller's LOCKED language: I need to confirm which area for your order. Which area would you like: ${areaList}? After they answer, call place_order again with branch_name set to that area name (for example Johar Town). Do NOT invent an order number.`,
      });
    }
    return res.status(500).json({ error: e.message || "failed" });
  }
}
