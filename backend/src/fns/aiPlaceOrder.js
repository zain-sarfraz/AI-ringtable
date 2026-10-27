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
import { createPhoneOrder, normalizeVoicePaymentMethod } from "../lib/phoneOrderService.js";
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
    // Match ## Branch ordering / loadActiveChildBranches (accepting only).
    const childBranchCount = await knex("restaurants")
      .where({
        parent_restaurant_id: restaurantId,
        is_branch: true,
        is_active: true,
        is_accepting_orders: true,
      })
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
    } else if (childBranchCount === 1) {
      const singleBranch = await knex("restaurants")
        .where({
          parent_restaurant_id: restaurantId,
          is_branch: true,
          is_active: true,
          is_accepting_orders: true,
        })
        .first();
      if (!spokenBranch || inventedBranch) {
        spokenBranch = singleBranch?.name || "none";
        body.branch_name = spokenBranch;
      }
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
        "Ji, phone number digits mein share kar dein?";
      return res.status(200).json({
        success: false,
        phone_required: true,
        order_failed: false,
        speak: speakUr,
        message:
          "PHONE NEEDED — order is NOT failed and NOT saved yet. FORBIDDEN phrases: Order save nahi ho saka, order fail, error. Speak EXACTLY once: \"" +
          speakUr +
          "\" After they give ANY digits, call place_order again with customer_phone as those digits only — NEVER ask if number is same. Do NOT invent an order number.",
      });
    }

    // Idempotent: retry after a successful save must re-read success speak (never "save nahi hua").
    if (validSynthflowCallId) {
      const existingOrder = await knex("orders")
        .where({ restaurant_id: restaurantId })
        .whereRaw("ai_extracted_data->>'synthflow_call_id' = ?", [validSynthflowCallId])
        .orderBy("created_at", "desc")
        .first();
      if (existingOrder?.order_number) {
        console.log(
          `✅ place_order idempotent hit: ${existingOrder.order_number} call=${validSynthflowCallId}`,
        );
        const targetRest = await knex("restaurants")
          .where({ id: existingOrder.restaurant_id })
          .select("currency")
          .first();
        const restSettings = await knex("restaurant_settings")
          .where({ restaurant_id: existingOrder.restaurant_id })
          .select("currency")
          .first();
        const currCode = restSettings?.currency || targetRest?.currency || "USD";
        const currInfo = getCurrencyDetails(currCode);
        const totalHints = spokenPriceHints(Number(existingOrder.total_amount ?? existingOrder.total ?? 0), currInfo);
        const orderSpeak = speakOrderNumberForPhone(existingOrder.order_number);
        const spokenScript =
          `Aapka order confirm ho gaya hai. Aapka order number ${orderSpeak} hai, isay mehfooz kar lijiye. ` +
          `Tax include kar ke kul bill ${totalHints.urduSpeak} bana hai. Bohot shukriya, Allah hafiz!`;
        return res.json({
          success: true,
          already_created: true,
          branch_required: false,
          ask_branch: false,
          order_number: existingOrder.order_number,
          order_number_speak: orderSpeak,
          tracking_code: existingOrder.tracking_code,
          total: existingOrder.total_amount ?? existingOrder.total,
          currency: currInfo.code,
          speak: spokenScript,
          message:
            `SUCCESS (already saved). READ ALOUD EXACTLY. Do NOT say order failed. ` +
            `FORBIDDEN: asking city/area/branch/town. Script: ${spokenScript}`,
        });
      }
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

    const orderInput = (branchOverride) => ({
      restaurantId,
      customer_name: body.customer_name,
      customer_phone: phoneToUse,
      customer_email: body.customer_email || body.email || null,
      delivery_address: body.delivery_address,
      delivery_notes: body.delivery_notes || body.notes || null,
      items: body.items,
      coupon_code: body.coupon_code || body.discount_code || null,
      payment_method: normalizeVoicePaymentMethod(body.payment_method),
      fulfillment_type: body.fulfillment_type || "delivery",
      branch_name: branchOverride !== undefined ? branchOverride : spokenBranch,
      area: branchOverride === "none" ? null : body.area || body.branch_area || null,
      branch: branchOverride === "none" ? null : body.branch || null,
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

    let placed;
    try {
      placed = await createPhoneOrder(knex, orderInput());
    } catch (branchErr) {
      if (!branchErr?.isBranchError) throw branchErr;
      const areas = (branchErr.availableAreas || []).filter(Boolean);
      const forceNone =
        childBranchCount === 0 ||
        !areas.length ||
        branchErr.shouldAskCaller === false;
      console.warn(
        "⚠️ Branch not matched. Requested:",
        branchErr.requestedBranch,
        "| areas:",
        areas.join(" ya ") || "(none)",
        "| forceNone:",
        forceNone,
      );
      if (forceNone) {
        // Root fix: branchless (or empty area list) — complete the order server-side.
        // Do not return a speak script that lets the LLM invent town names.
        placed = await createPhoneOrder(knex, orderInput("none"));
      } else {
        const areaList = areas.join(" ya ");
        return res.status(200).json({
          success: false,
          branch_required: true,
          requested_branch: branchErr.requestedBranch || null,
          available_areas: areas,
          speak: `Aap kaunsa area chahenge: ${areaList}?`,
          message:
            `READ "speak" EXACTLY once (Roman Urdu). After they answer, call place_order again ONCE with branch_name set to that exact area name. ` +
            `ONLY use these areas from the tool response — never invent other areas. Do NOT invent an order number. Do NOT keep asking area after one answer.`,
        });
      }
    }

    const { order, reservation, reservationError, unmatched, coupon, totals, assignedBranchName, assignmentStatus } =
      placed;

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
    // English number words (TTS-safe) + unit — never Urdu numbers, never decimals
    const spokenTotal = totalHints.urduSpeak;
    const orderSpeak = speakOrderNumberForPhone(order.order_number);
    // Locked script only — no English debug in `message` (LLM paraphrases and invents wrong ORD suffixes).
    // Soft, natural Lahori close — still digit-safe for the order number.
    const spokenScript =
      `Aapka order confirm ho gaya hai. Aapka order number ${orderSpeak} hai, isay mehfooz kar lijiye. ` +
      `Tax include kar ke kul bill ${spokenTotal} bana hai. Bohot shukriya, Allah hafiz!` +
      (branchNote ? ` ${branchNote.trim()}` : "") +
      (couponNote ? ` ${couponNote.trim()}` : "");

    return res.json({
      success: true,
      branch_required: false,
      ask_branch: false,
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
      // ask_branch:false — branchless agents must NOT invent area questions after a saved order.
      message:
        `SUCCESS. Order already saved. READ ALOUD EXACTLY (zero digit changes). ` +
        `FORBIDDEN next: asking city/area/branch/town, inventing locations, saying order failed, mentioning SMS. ` +
        `Script: ${spokenScript}`,
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
      // Retry path already attempted with none — do not teach the LLM failure scripts.
      return res.status(200).json({
        success: false,
        branch_required: false,
        order_failed: false,
        speak: "Ji, ek second, main order confirm karti hoon.",
        message:
          "Do NOT ask for city, area, or branch. Do NOT say order failed / save nahi hua. " +
          "Call place_order ONCE more with branch_name exactly \"none\". Do NOT invent an order number.",
      });
    }
    if (/no order items/i.test(String(e.message || ""))) {
      return res.status(200).json({
        success: false,
        order_failed: false,
        message:
          "Items were empty. Ask which food they want, then call place_order again with items. Do NOT invent an order number. Do NOT say order failed.",
      });
    }
    // Soft 200 — Synthflow often paraphrases HTTP 500 into "order fail" even when a later retry/webhook succeeds.
    return res.status(200).json({
      success: false,
      order_failed: false,
      speak: "Ji, ek second, main order confirm karti hoon.",
      message:
        "Temporary issue — NOT a final failure. Do NOT say Order save nahi ho saka. " +
        "Call place_order ONCE more with the same fields (branch_name none if NO branches). " +
        "If the next response has success/speak, READ speak EXACTLY. Do NOT invent an order number.",
    });
  }
}
