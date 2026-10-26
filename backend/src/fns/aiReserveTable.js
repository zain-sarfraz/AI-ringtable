import { getKnex } from "../db.js";
import { resolveSpokenBranchId } from "../lib/branchLocation.js";
import { normalizeElevenLabsToolBody, resolveRestaurantIdForVoiceTools } from "../lib/voiceWebhookUtils.js";
import { findAvailableTable, createReservation, parseReservationDate, parseReservationTime, lastSpokenReservationTime } from "../lib/tableReservationService.js";

function phoneDigitCount(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function looksLikePhone(value) {
  const n = phoneDigitCount(value);
  return n >= 8 && n <= 15;
}

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

function resolveCustomerPhone(body, customerPhone) {
  const caller =
    body.caller_phone || body.twilio_from || body.from || body.user_phone_number || body.user_number || null;
  let phone = customerPhone;
  if (isSamePhonePhrase(phone) || !looksLikePhone(phone)) {
    phone = looksLikePhone(caller) ? caller : null;
  }
  if (phone && /^<[^>]+>$/.test(String(phone).trim())) phone = null;
  return phone ? String(phone).trim() : null;
}

export async function aiReserveTable(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    console.log("\n" + "=".repeat(50));
    console.log("📅 TABLE RESERVATION REQUEST FROM AI");
    console.log("=".repeat(50));

    const rawBody = { ...(req.query || {}), ...(req.body || {}) };
    const body = normalizeElevenLabsToolBody(rawBody);
    if (!body.elevenlabs_agent_id && process.env.ELEVENLABS_AGENT_ID) {
      body.elevenlabs_agent_id = String(process.env.ELEVENLABS_AGENT_ID).trim();
    }

    const {
      customer_name,
      customer_phone,
      customer_email,
      party_size,
      reservation_date,
      reservation_time, // HH:MM
      slot_duration_hours = 1,
      notes,
    } = body;

    if (!customer_name || !reservation_date || !reservation_time || !party_size) {
      return res.status(200).json({
        success: false,
        speak: "Ji, table ke liye aapka naam, afraad ki tadaad, tareekh aur waqt bata dijiye?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask for any missing details: name, date, time, and guest count. Do not switch languages.",
      });
    }

    const knex = getKnex();
    const resolved = await resolveRestaurantIdForVoiceTools(knex, body);
    const restaurantId = resolved.id;

    if (!restaurantId) {
      return res.status(200).json({
        success: false,
        speak: "Maazrat ji, restaurant verify nahi ho saka.",
        message: `CRITICAL: Reply ONLY in the caller's LOCKED language. ${resolved.error || "Could not identify the restaurant."}`,
      });
    }
    const branchRestaurantId = await resolveSpokenBranchId(
      knex,
      restaurantId,
      body.branch_name || body.branch || body.area || null,
    );

    const pSize = Math.max(1, parseInt(party_size, 10) || 1);
    const duration = Number(slot_duration_hours) || 1;
    const isoDate = parseReservationDate(reservation_date);
    const isoTime =
      parseReservationTime(reservation_time) ||
      parseReservationTime(String(reservation_time).replace(/[^\d:apm.\s]/gi, "")) ||
      lastSpokenReservationTime(String(reservation_time));

    if (!isoTime) {
      return res.status(200).json({
        success: false,
        speak: "Ji, kis waqt aana chahenge?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language, softly and politely. Ask the booking time once (example 7 PM). Do not ask area/branch unless ## Branch ordering lists areas. Do not switch languages.",
      });
    }

    console.log(`👤 Customer: ${customer_name} | Party: ${pSize} | Date: ${isoDate} | Time: ${isoTime} (raw=${reservation_time}) | Duration: ${duration}h`);

    const phoneToUse = resolveCustomerPhone(body, customer_phone);

    const availableTable = await findAvailableTable(knex, {
      restaurantId: branchRestaurantId,
      partySize: pSize,
      reservationDate: isoDate,
      startTime: isoTime,
      slotDurationHours: duration,
    });

    if (!availableTable) {
      return res.status(200).json({
        success: false,
        available: false,
        speak: "Maazrat ji, is waqt koi table khali nahi hai. Kya aap kisi aur waqt aana chahenge?",
        message:
          `CRITICAL: Reply ONLY in the caller's LOCKED language, softly and politely (apologize first). No table is free at ${isoTime} on ${isoDate}. Gently ask for a different time once. Do not sound rude. Do not ask area/branch unless ## Branch ordering lists areas. Do not switch languages.`,
      });
    }

    let callId = null;
    if (body.call_sid) {
      const c = await knex("calls").where({ twilio_call_sid: body.call_sid }).select("id").first();
      callId = c?.id ?? null;
    }

    const synthflowCallId =
      body.synthflow_call_id ||
      body.call_id ||
      body.conversation_id ||
      body.executed_action_id ||
      null;

    const reservation = await createReservation(knex, {
      restaurantId: branchRestaurantId,
      tableId: availableTable.id,
      customerName: customer_name,
      customerPhone: phoneToUse,
      customerEmail: customer_email,
      partySize: pSize,
      reservationDate: isoDate,
      startTime: isoTime,
      slotDurationHours: duration,
      status: "confirmed",
      notes: notes || null,
      source: "phone",
      callId,
      aiExtractedData: {
        raw: body,
        provider: body.synthflow_agent_id ? "synthflow" : "elevenlabs",
        synthflow_call_id: synthflowCallId ? String(synthflowCallId) : null,
        reservation_time_raw: reservation_time,
        reservation_time: isoTime,
        reservation_date: isoDate,
      },
    });

    console.log(`✅ Reservation created: id=${reservation.id} table=${availableTable.table_number}`);

    const speakUr = `Ji, aapki table confirm ho chuki hai, ${pSize} logon ke liye table mehfooz hai. Bohot shukriya!`;
    const speakEn = `Your table is confirmed for ${pSize} guest(s). Thank you so much!`;

    const confirmMsg =
      `CRITICAL: Reply ONLY in the caller's LOCKED language — soft, warm, polite human tone — do not switch. ` +
      `READ THIS EXACTLY: ${speakUr} ` +
      `Never say order number or bill. Never ask area after success. FORBIDDEN: spelling out reservation UUIDs or reading Table numbers in English.`;

    return res.json({
      success: true,
      available: true,
      reservation_id: reservation.id,
      table_number: availableTable.table_number,
      table_capacity: availableTable.capacity,
      reservation_date: isoDate,
      reservation_time: isoTime,
      party_size: pSize,
      slot_duration_hours: duration,
      speak: speakUr,
      speak_en: speakEn,
      speak_ur: speakUr,
      message: confirmMsg,
    });
  } catch (e) {
    console.error("❌ Reserve Table Error:", e);
    return res.status(500).json({ error: e.message || "Failed to create reservation" });
  }
}
