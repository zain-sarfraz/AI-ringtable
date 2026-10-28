import { getKnex } from "../db.js";
import { resolveSpokenBranchId } from "../lib/branchLocation.js";
import {
  createReservation,
  findAvailableTable,
  lastSpokenReservationTime,
  parsePartySize,
  parseReservationDate,
  parseReservationTime,
} from "../lib/tableReservationService.js";
import { normalizeElevenLabsToolBody, resolveRestaurantIdForVoiceTools } from "../lib/voiceWebhookUtils.js";

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

    // Direct and alias support:
    // tareekh -> date / reservation_date
    // waqt -> time / reservation_time
    // afraad -> person / party_size
    // raabta number -> phone number / customer_phone
    const customer_name =
      body.customer_name ||
      body.name ||
      body.guest_name ||
      body.caller_name ||
      null;

    const customer_phone =
      body.customer_phone ||
      body.phone_number ||
      body.phone ||
      body.raabta_number ||
      body.rabta_number ||
      body.contact_number ||
      null;

    const customer_email = body.customer_email || body.email || null;

    const rawPartySize =
      body.party_size ??
      body.person ??
      body.persons ??
      body.afraad ??
      body.guests ??
      body.guest_count ??
      body.people ??
      body.tadaad ??
      null;

    const rawDate =
      body.reservation_date ||
      body.date ||
      body.tareekh ||
      body.tareeqh ||
      body.booking_date ||
      body.res_date ||
      null;

    const rawTime =
      body.reservation_time ||
      body.time ||
      body.waqt ||
      body.booking_time ||
      body.start_time ||
      body.res_time ||
      null;

    const slot_duration_hours = body.slot_duration_hours || body.duration || 1;
    const notes = body.notes || body.special_notes || body.instructions || null;

    const pSize = parsePartySize(rawPartySize);
    const isoDate = rawDate ? parseReservationDate(rawDate) : null;
    const isoTime = rawTime
      ? parseReservationTime(rawTime) ||
      parseReservationTime(String(rawTime).replace(/[^\d:apm.\s]/gi, "")) ||
      lastSpokenReservationTime(String(rawTime))
      : null;

    // Conversational flow questions if details are missing:
    if (!isoDate && !isoTime) {
      return res.status(200).json({
        success: false,
        speak: "Ji, main table reservation mein madad kar sakti hoon. Aap kis date aur kis time table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Ji, main table reservation mein madad kar sakti hoon. Aap kis date aur kis time table chahengay?",
      });
    }

    if (!isoTime) {
      return res.status(200).json({
        success: false,
        speak: "Ji, kis time table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Ji, kis time table chahengay?",
      });
    }

    if (!isoDate) {
      return res.status(200).json({
        success: false,
        speak: "Ji, kis date ke liye table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Ji, kis date ke liye table chahengay?",
      });
    }

    if (!pSize) {
      return res.status(200).json({
        success: false,
        speak: "Ji, kitne person ke liye table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Ji, kitne person ke liye table chahengay?",
      });
    }

    if (!customer_name || /^(none|null|n\/a|unknown)$/i.test(String(customer_name).trim())) {
      return res.status(200).json({
        success: false,
        speak: "Ji, aap kis naam se reservation karwana chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Ji, aap kis naam se reservation karwana chahengay?",
      });
    }

    const phoneToUse = resolveCustomerPhone(body, customer_phone);
    if (!phoneToUse) {
      return res.status(200).json({
        success: false,
        phone_required: true,
        speak: "Apna phone number share kar dein?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Apna phone number share kar dein?",
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

    const duration = Number(slot_duration_hours) || 1;

    console.log(`👤 Customer: ${customer_name} | Party: ${pSize} | Date: ${isoDate} | Time: ${isoTime} (raw=${rawTime}) | Phone: ${phoneToUse} | Duration: ${duration}h`);

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
        reservation_time_raw: rawTime,
        reservation_time: isoTime,
        reservation_date: isoDate,
      },
    });

    console.log(`✅ Reservation created: id=${reservation.id} table=${availableTable.table_number}`);

    const speakUr = `Ji, aapki table confirm ho chuki hai, ${pSize} person ke liye table mehfooz hai. Bohot shukriya!`;
    const speakEn = `Your table is confirmed for ${pSize} guest(s). Thank you so much!`;

    const confirmMsg =
      `CRITICAL: Reply ONLY in the caller's LOCKED language — soft, warm, polite human tone — do not switch. ` +
      `READ THIS EXACTLY: ${speakUr} ` +
      `Never say order number or bill. Never ask area after success. FORBIDDEN: spelling out reservation UUIDs or reading Table numbers in English.`;

    return res.json({
      success: true,
      available: true,
      speak: speakUr,
      speak_en: speakEn,
      speak_ur: speakUr,
      message: speakUr,
      reservation_id: reservation.id,
      _reservation_id: reservation.id,
      table_number: availableTable.table_number,
      _table_number: availableTable.table_number,
      party_size: pSize,
      _party_size: pSize,
      person: pSize,
      date: isoDate,
      time: isoTime,
      customer_name,
      customer_phone: phoneToUse,
    });
  } catch (e) {
    console.error("❌ Reserve Table Error:", e);
    return res.status(500).json({ error: e.message || "Failed to create reservation" });
  }
}
