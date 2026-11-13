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
  if (!phone) return null;
  // "0324 7087 907" → keep digits so save never fails on spaces
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 8 ? digits : String(phone).trim();
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
    // Agent often dumps "Kal Shaam 5 Baje" into only date OR only time — cross-fill both.
    const dateBlob = rawDate != null && String(rawDate).trim() && !/^(none|null|n\/a|unknown)$/i.test(String(rawDate).trim())
      ? String(rawDate).trim()
      : null;
    const timeBlob = rawTime != null && String(rawTime).trim() && !/^(none|null|n\/a|unknown)$/i.test(String(rawTime).trim())
      ? String(rawTime).trim()
      : null;
    const combinedBlob = [dateBlob, timeBlob].filter(Boolean).join(" ");
    const hasRelativeDate = (s) =>
      s && /\b(aaj|today|tonight|kal|tomorrow|parson|parso|agle\s*din|day\s*after)\b/i.test(s);
    const isoDate = dateBlob
      ? parseReservationDate(dateBlob)
      : hasRelativeDate(timeBlob)
        ? parseReservationDate(timeBlob)
        : null;
    const parseTimeLoose = (s) =>
      s
        ? parseReservationTime(s) ||
          parseReservationTime(String(s).replace(/[^\d:apm.\s]/gi, "")) ||
          lastSpokenReservationTime(String(s))
        : null;
    const isoTime =
      parseTimeLoose(timeBlob) ||
      parseTimeLoose(dateBlob) ||
      parseTimeLoose(combinedBlob);

    // Conversational flow questions if details are missing:
    if (!isoDate && !isoTime) {
      return res.status(200).json({
        success: false,
        speak: "Main table reservation mein madad kar sakta hoon. Aap kis date aur kis time table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: Main table reservation mein madad kar sakta hoon. Aap kis date aur kis time table chahengay?",
      });
    }

    if (!isoTime) {
      return res.status(200).json({
        success: false,
        speak: "Kis time table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: kis time table chahengay?",
      });
    }

    if (!isoDate) {
      return res.status(200).json({
        success: false,
        speak: "Kis date ke liye table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: kis date ke liye table chahengay?",
      });
    }

    if (!pSize) {
      return res.status(200).json({
        success: false,
        speak: "Kitne persons ke liye table chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: kitne persons ke liye table chahengay? NEVER say afraad.",
      });
    }

    if (!customer_name || /^(none|null|n\/a|unknown)$/i.test(String(customer_name).trim())) {
      return res.status(200).json({
        success: false,
        speak: "Aap kis naam se reservation karwana chahengay?",
        message:
          "CRITICAL: Reply ONLY in the caller's LOCKED language. Ask: aap kis naam se reservation karwana chahengay?",
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
        speak: "Maazrat, abhi restaurant verify nahi ho saka. Thori der baad dobara koshish karein.",
        message: `CRITICAL: Reply ONLY in the caller's LOCKED language. READ speak EXACTLY. ${resolved.error || "Could not identify the restaurant."}`,
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
        speak: "Maazrat, is waqt koi table khali nahi hai. Kya aap kisi aur waqt aana chahenge?",
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

    const speakUr = `Aapki table confirm ho chuki hai, ${pSize} persons ke liye table mehfooz hai. Bohot shukriya!`;
    const speakEn = `Your table is confirmed for ${pSize} guest(s). Thank you so much!`;

    return res.json({
      success: true,
      available: true,
      speak: speakUr,
      speak_en: speakEn,
      speak_ur: speakUr,
      message:
        `CRITICAL: Reply ONLY in the caller's LOCKED language. READ speak EXACTLY once. ` +
        `Never say order number or bill. Never invent failure. FORBIDDEN: afraad, tareekh, raabta, rabta, UUIDs, table numbers.`,
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
    // Always return speak so the phone agent never invents "table reserve nahi ho raha".
    return res.status(200).json({
      success: false,
      speak:
        "Maazrat, abhi reservation complete nahi ho saki. Date, time, aur kitne persons hain, dobara bata dein?",
      message:
        "CRITICAL: Reply ONLY in the caller's LOCKED language. READ speak EXACTLY. Do not invent failure drama. Ask date, time, and party size once more, then call reserve_table again.",
      error: e.message || "Failed to create reservation",
    });
  }
}
