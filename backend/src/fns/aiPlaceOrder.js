import { getKnex } from "../db.js";
import {
  normalizeElevenLabsToolBody,
  resolveRestaurantIdForVoiceTools,
  resolveSpokenCustomerPhone,
  looksLikePhoneNumber,
  isSamePhonePhrase,
  normalizeE164,
  hasUsableOrderItems,
} from "../lib/voiceWebhookUtils.js";
import { createPhoneOrder } from "../lib/phoneOrderService.js";
import { cleanUrduText } from "../lib/devanagariTransliterator.js";
import {
  getCurrencyDetails,
  spokenPriceHints,
  speakOrderNumberForPhone,
} from "../lib/restaurantVoiceContext.js";

export async function aiPlaceOrder(req, res) {
  res.set("Access-Control-Allow-Origin", "*");

  try {
    console.log("\n" + "=".repeat(50));
    console.log(
      String(process.env.APP_ENV || "").toLowerCase() === "development"
        ? "🔔 NEW PHONE ORDER → LOCAL database (APP_ENV=development)"
        : "🔔 NEW PHONE ORDER REQUEST",
    );
    console.log("=".repeat(50));

    // Query params (baked into ElevenLabs tool URLs) merge under body fields.
    const rawBody = { ...(req.query || {}), ...(req.body || {}) };
    const body = normalizeElevenLabsToolBody(rawBody);

    // Only inject env agent id when the tool omitted it — never invent a dead/mismatched id.
    if (!body.elevenlabs_agent_id && process.env.ELEVENLABS_AGENT_ID) {
      const envAgent = String(process.env.ELEVENLABS_AGENT_ID).trim();
      if (envAgent) body.elevenlabs_agent_id = envAgent;
    }

    if (String(body.customer_email || "").trim().toLowerCase() === "none") body.customer_email = null;
    if (String(body.coupon_code || "").trim().toLowerCase() === "none") body.coupon_code = null;

    const fulfillment = String(body.fulfillment_type || "delivery").toLowerCase();
    const isPickup = fulfillment === "pickup" || /pickup|khud|aakar|lenge/i.test(String(body.delivery_address || ""));
    if (isPickup) {
      body.fulfillment_type = "pickup";
      if (!body.delivery_address || /^(none|null|n\/a)$/i.test(String(body.delivery_address).trim())) {
        body.delivery_address = "Pickup";
      }
    }

    if (!body.customer_name || !hasUsableOrderItems(body.items)) {
      console.error("❌ Validation Failed: Missing customer_name or items", {
        name: body.customer_name || null,
        items: body.items,
      });
      return res.status(200).json({
        success: false,
        message:
          "Missing customer_name or items. Ask once for name and items, then call place_order again. Do NOT invent an order number.",
      });
    }

    body.customer_name = cleanUrduText(body.customer_name);
    if (body.delivery_address) {
      body.delivery_address = cleanUrduText(body.delivery_address);
    }

    const knex = getKnex();
    const resolved = await resolveRestaurantIdForVoiceTools(knex, body);
    const restaurantId = resolved.id;

    let spokenBranch =
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

    // Agent sometimes invents "branch 2" / "Main Branch" when the restaurant has no child branches.
    // Force none so place_order never fails or loops on a fake area question.
    const childBranchCount = await knex("restaurants")
      .where({ parent_restaurant_id: restaurantId, is_branch: true, is_active: true })
      .count("id as c")
      .first()
      .then((row) => Number(row?.c || 0))
      .catch(() => 0);
    const inventedBranch =
      !spokenBranch ||
      /^(none|null|n\/a|na|any|no|no preference)$/i.test(String(spokenBranch).trim()) ||
      /^branch\s*\d+$/i.test(String(spokenBranch).trim()) ||
      /^(main\s*)?branch$/i.test(String(spokenBranch).trim());
    if (childBranchCount === 0) {
      if (spokenBranch && !/^(none|null)$/i.test(String(spokenBranch).trim())) {
        console.log(
          `🏬 Branch ignored (0 child branches): "${spokenBranch}" → none`,
        );
      }
      spokenBranch = "none";
      body.branch_name = "none";
      body.branch = null;
      body.area = null;
      body.branch_area = null;
    } else if (inventedBranch && /^branch\s*\d+$/i.test(String(spokenBranch || "").trim())) {
      // Named "branch 2" is almost never a real DB branch name — clear so matcher can fall back.
      console.log(`🏬 Branch label looks invented: "${spokenBranch}" — clearing for matcher`);
      spokenBranch = null;
      body.branch_name = null;
    }

    let callId = null;
    if (body.call_sid) {
      const c = await knex("calls").where({ twilio_call_sid: body.call_sid }).select("id").first();
      callId = c?.id ?? null;
    }

    const synthflowCallId = String(
      body.synthflow_call_id || body.call_id || body.sf_call_id || "",
    ).trim();
    // Synthflow often sends placeholder like "<call_id>" — ignore those
    const validSynthflowCallId =
      synthflowCallId && !/^<[^>]+>$/.test(synthflowCallId) ? synthflowCallId : null;

    // Prefer caller ID already stored on the Synthflow call row (most reliable for "yehi number")
    let callerFromCall = null;
    if (validSynthflowCallId) {
      const existingCall = await knex("calls")
        .where({ synthflow_call_id: validSynthflowCallId })
        .select("id", "phone_number")
        .first();
      if (existingCall?.id) callId = existingCall.id;
      if (looksLikePhoneNumber(existingCall?.phone_number)) {
        callerFromCall = existingCall.phone_number;
      }
    }

    let phoneToUse = resolveSpokenCustomerPhone(body, { callerFallback: callerFromCall });
    // Last resort: if they said yehi/same number but caller ID missing in body, keep trying call row
    if (!phoneToUse && isSamePhonePhrase(body.customer_phone) && looksLikePhoneNumber(callerFromCall)) {
      phoneToUse = normalizeE164(callerFromCall);
    }

    console.log(
      "📞 Phone resolve:",
      "spoken=",
      body.customer_phone,
      "caller_body=",
      body.caller_phone || body.user_phone_number || null,
      "caller_call=",
      callerFromCall,
      "→",
      phoneToUse,
    );

    if (!phoneToUse) {
      // Soft fail — NEVER tell the agent "order failed". Ask digits ONCE; never loop phone questions.
      const speakUr =
        "Ji, raabta number digits mein bata dijiye?";
      return res.status(200).json({
        success: false,
        phone_required: true,
        speak: speakUr,
        message:
          "PHONE NEEDED — NOT an order failure. Do NOT say order save nahi hua / failed. Speak EXACTLY once: \"" +
          speakUr +
          "\" After they give ANY digits, call place_order again with customer_phone as those digits only — NEVER ask raabta number a second time. If they said yahi/yehi, pass customer_phone as \"same\". Do NOT invent an order number.",
      });
    }

    // Ensure a calls row exists for this Synthflow call so the order keeps the correct transcript later
    if (!callId && validSynthflowCallId) {
      let callRow = await knex("calls").where({ synthflow_call_id: validSynthflowCallId }).first();
      if (!callRow) {
        const [created] = await knex("calls")
          .insert({
            phone_number: phoneToUse,
            status: "in_progress",
            direction: "inbound",
            restaurant_id: restaurantId,
            synthflow_call_id: validSynthflowCallId,
            provider: "synthflow",
            started_at: knex.fn.now(),
          })
          .returning("*");
        callRow = created;
      } else if (!looksLikePhoneNumber(callRow.phone_number) && phoneToUse) {
        await knex("calls").where({ id: callRow.id }).update({ phone_number: phoneToUse });
      }
      callId = callRow?.id || null;
    }

    const voiceProvider = validSynthflowCallId
      ? "synthflow"
      : body.elevenlabs_agent_id
        ? "elevenlabs"
        : "phone";

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
      ai_extracted_data: {
        raw: body,
        provider: voiceProvider,
        ...(validSynthflowCallId ? { synthflow_call_id: validSynthflowCallId } : {}),
      },
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

    const targetRest = await knex("restaurants").where({ id: order.restaurant_id }).select("currency").first();
    const restSettings = await knex("restaurant_settings").where({ restaurant_id: order.restaurant_id }).select("currency").first();
    const currCode = restSettings?.currency || targetRest?.currency || "USD";
    const currInfo = getCurrencyDetails(currCode);
    const totalHints = spokenPriceHints(totals.total, currInfo);
    const urduPrice = totalHints.urduSpeak;
    const orderSpeak = speakOrderNumberForPhone(order.order_number);
    // Locked script only — no English debug in `message` (LLM paraphrases and invents wrong ORD suffixes).
    // Soft, natural Lahori close — still digit-safe for the order number.
    const spokenScript =
      `Ji, aapka order daraj ho gaya. Order number ${orderSpeak} hai — mehfooz kar lijiye. ` +
      `Teks shamil karke kul raqam ${urduPrice} hai. Bohot shukriya, Allah hafiz!` +
      (branchNote ? ` ${branchNote.trim()}` : "") +
      (couponNote ? ` ${couponNote.trim()}` : "");

    return res.json({
      success: true,
      order_number: order.order_number,
      order_number_speak: orderSpeak,
      tracking_code: order.tracking_code,
      total: totals.total,
      subtotal: totals.subtotal,
      tax: totals.tax,
      delivery_fee: totals.deliveryFee,
      currency: currInfo.code,
      branch_name: assignedBranchName,
      discount_amount: coupon.amount,
      speak: spokenScript,
      // SMS is sent async after this — never tell the caller the order failed because SMS failed.
      message: `SUCCESS. READ ALOUD EXACTLY (zero digit changes). Do NOT say order failed. Do NOT mention SMS. Script: ${spokenScript}`,
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
      const areaList = areas.length ? areas.join(" ya ") : "";
      console.warn("⚠️ Branch not matched. Requested:", e.requestedBranch, "| areas:", areaList || "(none)");
      // No areas configured → do not ask Johar Town / invent cities; tell agent to retry with branch_name none.
      if (!areas.length) {
        const speakNone =
          "Theek hai ji, main order daraj karti hoon.";
        return res.status(200).json({
          success: false,
          branch_required: false,
          speak: speakNone,
          message:
            "NO BRANCHES — do NOT ask Johar Town, Iqbal Town, city, or area. " +
            "Silently call place_order again with branch_name exactly \"none\". " +
            "Do NOT invent an order number. Do not speak a waiting line.",
        });
      }
      const speakAreas = `Aap kaunsa area chahenge: ${areaList}?`;
      return res.status(200).json({
        success: false,
        branch_required: true,
        requested_branch: e.requestedBranch || null,
        available_areas: areas,
        speak: speakAreas,
        message:
          `READ "speak" EXACTLY once (Roman Urdu). After they answer, call place_order again with branch_name set to that exact area name. ` +
          `ONLY use these areas — never invent Johar Town / Iqbal Town if they are not in the list. Do NOT invent an order number.`,
      });
    }
    if (/no order items/i.test(String(e.message || ""))) {
      return res.status(200).json({
        success: false,
        message:
          "Items were empty. Ask which food they want, then call place_order again with items. Do NOT invent an order number.",
      });
    }
    return res.status(500).json({ error: e.message || "failed" });
  }
}
