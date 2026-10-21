import crypto from "crypto";
import { getKnex } from "../db.js";
import { resolveSpokenBranchId } from "../lib/branchLocation.js";
import { createPhoneOrder, parseOrderItemsText } from "../lib/phoneOrderService.js";
import { normalizeE164 } from "../lib/voiceWebhookUtils.js";
import { parseTranscriptIntoTurns } from "./synthflowSyncCalls.js";
import {
  findAvailableTable,
  createReservation,
  parseReservationDate,
  parseReservationTime,
  lastSpokenReservationTime,
} from "../lib/tableReservationService.js";
import { cleanUrduText } from "../lib/devanagariTransliterator.js";

function truthyYes(v) {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["yes", "true", "y", "1", "ordered", "order placed", "oui", "vrai", "commande passée", "commande validée"].includes(s);
}

function emptyish(v) {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === "none" || s === "null" || s === "n/a" || s === "na" || s === "unknown" || s === "aucun" || s === "aucune";
}

function customerTranscriptFrom(transcript) {
  if (!transcript || typeof transcript !== "string") return "";
  try {
    return parseTranscriptIntoTurns(transcript)
      .filter((t) => t.speaker === "customer" && t.message)
      .map((t) => t.message)
      .join("\n");
  } catch {
    return "";
  }
}

function cleanEmail(v) {
  if (emptyish(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (
    s === "none" ||
    s === "null" ||
    s === "n/a" ||
    s === "no" ||
    s === "skip" ||
    s.endsWith("@example.com") ||
    s.endsWith("@test.com")
  ) {
    return null;
  }
  return s.includes("@") && s.includes(".") ? s : null;
}

function mapCallStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "completed" || s === "done") return "completed";
  if (s === "in-progress" || s === "ringing" || s === "pending") return "in_progress";
  if (s === "no-answer" || s === "busy" || s === "failed" || s === "canceled" || s === "user-canceled") {
    return "missed";
  }
  return "completed";
}

/**
 * Pull plain-text values from Synthflow executed_actions / collected_variables.
 */
export function extractSynthflowFields(payload) {
  /** @type {Record<string, string>} */
  const fields = {};

  const collected = payload?.collected_variables;
  if (collected && typeof collected === "object") {
    for (const [key, val] of Object.entries(collected)) {
      if (val && typeof val === "object" && "value" in val) {
        if (val.value != null) fields[key] = String(val.value);
      } else if (val != null) {
        fields[key] = String(val);
      }
    }
  }

  const executed = payload?.executed_actions;
  if (executed && typeof executed === "object") {
    for (const action of Object.values(executed)) {
      if (!action || typeof action !== "object") continue;
      const name = String(action.name || "").toLowerCase();
      const hardId = String(action.parameters_hard_coded?.identifier || "").toLowerCase();
      for (const bag of [action.parameters, action.variables, action.inputs, action.parameters_from_llm]) {
        if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
        for (const [key, val] of Object.entries(bag)) {
          if (fields[key] != null) continue;
          const text = val && typeof val === "object" && "value" in val ? val.value : val;
          if (text != null && typeof text !== "object") fields[key] = String(text);
        }
      }
      const ret = action.return_value;
      let value = null;
      if (ret != null && typeof ret === "object") {
        const vals = Object.values(ret).filter((x) => x != null && String(x).trim() !== "");
        value = vals.length ? vals[0] : null;
      } else if (ret != null) {
        value = ret;
      }
      if (value == null) continue;

      const key =
        hardId ||
        name.replace(/^extract_info[_\s-]*/i, "").replace(/\s+/g, "_") ||
        null;
      if (key) fields[key] = String(value);
    }
  }

  // Common aliases
  const aliases = {
    customer_name: ["customer_name", "name", "user_name", "full_name"],
    customer_phone: ["customer_phone", "phone", "phone_number", "caller_phone"],
    customer_email: ["customer_email", "email", "email_address", "user_email"],
    delivery_address: ["delivery_address", "address", "shipping_address"],
    order_items: ["order_items", "items", "ordered_items", "food_items"],
    coupon_code: ["coupon_code", "promo_code", "discount_code", "coupon"],
    special_notes: ["special_notes", "notes", "delivery_notes", "instructions"],
    fulfillment_type: ["fulfillment_type", "order_type", "delivery_or_pickup"],
    branch_name: ["branch_name", "branch", "restaurant_branch", "selected_branch"],
    payment_method: ["payment_method", "payment"],
    order_placed: ["order_placed", "placed_order", "order_confirmed"],
    party_size: ["party_size", "party", "guests", "number_of_guests", "people", "guest_count", "persons"],
    reservation_date: ["reservation_date", "booking_date", "date", "res_date"],
    reservation_time: ["reservation_time", "booking_time", "time", "start_time", "res_time"],
    slot_duration_hours: ["slot_duration_hours", "duration", "duration_hours", "slot_duration", "slot_hours"],
    table_reserved: ["table_reserved", "reserve_table", "table_reservation", "reservation_made", "is_reservation"],
  };

  /** @type {Record<string, string | null>} */
  const out = {};
  for (const [canon, keys] of Object.entries(aliases)) {
    const takeLast = canon === "reservation_time" || canon === "reservation_date";
    let found = null;
    for (const k of keys) {
      for (const [fk, fv] of Object.entries(fields)) {
        const fl = fk.toLowerCase();
        const exact = fl === k;
        const fuzzy = k !== "time" && k !== "date" && fl.includes(k);
        if (!exact && !fuzzy) continue;
        if (canon === "reservation_time") {
          const parsed = parseReservationTime(fv);
          if (parsed) found = parsed;
          else if (takeLast) found = fv;
        } else {
          found = fv;
        }
        if (found != null && !takeLast) break;
      }
      if (found != null && !takeLast) break;
    }
    out[canon] = found ? cleanUrduText(found) : found;
  }
  return out;
}

export function supplementFieldsFromTranscript(fields, transcript, callNotes = null) {
  const out = { ...fields };
  const combined = `${transcript || ""} ${callNotes || ""}`;
  let customerTranscript = "";

  if (transcript && typeof transcript === "string") {
    const turns = parseTranscriptIntoTurns(transcript);
    customerTranscript = turns
      .filter((t) => t.speaker === "customer" && t.message)
      .map((t) => t.message)
      .join("\n");

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const prevTurn = i > 0 ? turns[i - 1] : null;

      if (turn.speaker === "customer" && turn.message) {
        const msg = turn.message.trim();
        const prevBotMsg = prevTurn?.speaker === "ai" ? prevTurn.message.toLowerCase() : "";

        // 1. Customer Name fallback
        if (emptyish(out.customer_name)) {
          if (
            prevBotMsg.includes("name") ||
            prevBotMsg.includes("who am i speaking") ||
            prevBotMsg.includes("naam")
          ) {
            const clean = msg
              .replace(/^(my name is|i am|this is|mera naam|mera nam|it's|it is)\s+/i, "")
              .replace(/[.!?,]$/, "")
              .trim();
            if (clean && clean.length <= 60 && !/^(delivery|pickup|yes|no|order|food)/i.test(clean)) {
              out.customer_name = clean;
            }
          }
        }

        // 2. Delivery Address fallback
        if (emptyish(out.delivery_address)) {
          if (
            prevBotMsg.includes("address") ||
            prevBotMsg.includes("location") ||
            prevBotMsg.includes("where should we deliver") ||
            prevBotMsg.includes("delivery address") ||
            prevBotMsg.includes("pata")
          ) {
            const clean = msg
              .replace(/^(my address is|delivery address is|it's|it is|address is|address)\s+/i, "")
              .replace(/[.!?,]$/, "")
              .trim();
            if (clean && clean.length >= 3 && !/^(pickup|takeaway|no|yes|none|null)$/i.test(clean)) {
              out.delivery_address = clean;
            }
          }
        }

        // 3. Customer Phone fallback
        if (emptyish(out.customer_phone)) {
          if (
            prevBotMsg.includes("phone") ||
            prevBotMsg.includes("contact number") ||
            prevBotMsg.includes("mobile") ||
            prevBotMsg.includes("number")
          ) {
            const phoneMatch = msg.match(/(\+?\d[\d\s\-]{8,}\d)/);
            if (phoneMatch) {
              out.customer_phone = phoneMatch[1].replace(/\s+/g, "");
            }
          }
        }

        // 4. Reservation details from conversational turns
        if (emptyish(out.party_size) && (prevBotMsg.includes("how many guests") || prevBotMsg.includes("party size") || prevBotMsg.includes("how many people"))) {
          const numMatch = msg.match(/\b(\d{1,2})\b/);
          if (numMatch) out.party_size = numMatch[1];
        }

        const askedDate =
          prevBotMsg.includes("what day") ||
          prevBotMsg.includes("which day") ||
          prevBotMsg.includes("preferred date") ||
          (prevBotMsg.includes("date") && (prevBotMsg.includes("book") || prevBotMsg.includes("reserv") || prevBotMsg.includes("table")));
        if (askedDate && /\btoday\b|\btomorrow\b|\btonight\b|\d{4}-\d{2}-\d{2}/i.test(msg)) {
          out.reservation_date = parseReservationDate(msg);
        }

        const askedTime =
          prevBotMsg.includes("what time") ||
          prevBotMsg.includes("preferred time") ||
          prevBotMsg.includes("booking time") ||
          (prevBotMsg.includes("time") &&
            (prevBotMsg.includes("book") ||
              prevBotMsg.includes("reserv") ||
              prevBotMsg.includes("table") ||
              prevBotMsg.includes("would you like") ||
              prevBotMsg.includes("different")));
        if (askedTime) {
          const parsed = parseReservationTime(msg) || lastSpokenReservationTime(msg);
          if (parsed) out.reservation_time = parsed;
        }

        if (emptyish(out.slot_duration_hours) && (prevBotMsg.includes("how long") || prevBotMsg.includes("slot") || prevBotMsg.includes("duration"))) {
          const durMatch = msg.match(/(\d(?:\.5)?)\s*hours?/i) || msg.match(/\b(1|1\.5|2)\b/);
          if (durMatch) out.slot_duration_hours = durMatch[1];
        }
      }
    }
  }

  // Also check if summary turn has "For [Customer Name], delivery to [Address]"
  if (emptyish(out.customer_name) || emptyish(out.delivery_address)) {
    const summaryMatch = combined.match(/for\s+([A-Za-z\s]{2,40}),\s+delivery\s+to\s+([^,.]+)/i);
    if (summaryMatch) {
      if (emptyish(out.customer_name) && summaryMatch[1]) {
        out.customer_name = summaryMatch[1].trim();
      }
      if (emptyish(out.delivery_address) && summaryMatch[2]) {
        out.delivery_address = summaryMatch[2].trim();
      }
    }
  }

  // Reservation regex extraction across full text & summary
  const hasReservationCue = /reserv(e|ation)|table\s+for|book(ing)?\s+(a\s+)?table/i.test(combined);
  if (hasReservationCue) {
    if (emptyish(out.party_size)) {
      const pm = combined.match(/(?:party of|table for|for)\s+(\d{1,2})\s*(?:guests?|people|persons?)/i) ||
                 combined.match(/(\d{1,2})\s*(?:guests?|people|persons?)/i);
      if (pm) out.party_size = pm[1];
    }
    if (emptyish(out.reservation_date)) {
      const dm = combined.match(/\b(202\d-\d{2}-\d{2})\b/);
      if (dm) {
        out.reservation_date = dm[1];
      } else if (/\btonight\b|\btoday\b|\btomorrow\b/i.test(combined)) {
        out.reservation_date = parseReservationDate(combined);
      }
    }
    const lastTime = lastSpokenReservationTime(customerTranscript);
    if (lastTime) out.reservation_time = lastTime;
    if (emptyish(out.slot_duration_hours)) {
      const durMatch = combined.match(/(\d(?:\.5)?)\s*hours?/i);
      if (durMatch) out.slot_duration_hours = durMatch[1];
    }
  }

  return out;
}

async function resolveRestaurant(knex, payload) {
  const modelId =
    payload?.call?.model_id ||
    payload?.model_id ||
    (payload?.executed_actions && Object.values(payload.executed_actions)[0]?.model_id);

  if (modelId) {
    const row = await knex("restaurants")
      .where({ synthflow_agent_id: String(modelId) })
      .first();
    if (row) return row;
  }

  const promptVars = payload?.lead?.prompt_variables || {};
  const candidates = [
    // Restaurant DID is often the "from" in Synthflow prompt vars when customer dials in
    promptVars.from_phone_number,
    promptVars.to_phone_number,
    payload?.call?.to,
    payload?.call?.to_number,
    payload?.call?.from,
    payload?.metadata?.to,
    payload?.lead?.to_phone_number,
  ].filter(Boolean);

  for (const toNumber of candidates) {
    const raw = String(toNumber).trim();
    const norm = normalizeE164(raw);
    const phones = [...new Set([raw, norm].filter(Boolean))];
    for (const phone of phones) {
      let row = await knex("restaurants").where({ telnyx_phone_number: phone }).first();
      if (row) return row;
      row = await knex("restaurants").where({ twilio_phone_number: phone }).first();
      if (row) return row;
    }
  }

  return null;
}

/**
 * Synthflow signs call_id with HMAC-SHA256 and sends base64 in HTTP_SYNTHFLOW_SIGNATURE.
 * @see https://docs.synthflow.ai/security
 */
function getSynthflowSignatureHeader(req) {
  const h = req.headers || {};
  const keys = [
    "x-synthflow-signature",
    "synthflow-signature",
    "http-synthflow-signature",
    "http_synthflow_signature",
    "x-webhook-secret",
  ];
  for (const k of keys) {
    const v = req.get?.(k) || h[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const auth = req.get?.("authorization") || h.authorization;
  if (auth != null && String(auth).trim()) return String(auth).trim();
  return "";
}

function verifyWebhookSecret(req, payload = {}) {
  const secret = String(process.env.SYNTHFLOW_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;

  const header = getSynthflowSignatureHeader(req);
  if (!header) return false;

  // Legacy shared-secret compare (custom setups)
  if (header === secret) return true;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token === secret) return true;

  // Official Synthflow: HMAC-SHA256(call_id) → base64
  const callId =
    payload?.call?.call_id ||
    payload?.call_id ||
    payload?.lead?.prompt_variables?.call_id ||
    "";
  if (!callId) return false;

  const expected = crypto.createHmac("sha256", secret).update(String(callId), "utf8").digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token || header);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Synthflow post-call webhook → persist call + auto-create order when extractors confirm one.
 */
export async function synthflowPostCallWebhook(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    if (!verifyWebhookSecret(req, req.body || {})) {
      return res.status(401).json({ success: false, error: "invalid webhook secret" });
    }

    const payload = req.body || {};
    console.log("\n" + "=".repeat(50));
    console.log("📞 SYNTHFLOW POST-CALL WEBHOOK");
    console.log("=".repeat(50));

    // Inbound routing probe (Synthflow may POST call_inbound before connecting)
    if (payload.event === "call_inbound" || payload.call_inbound) {
      return res.json({
        call_inbound: payload.call_inbound || {},
      });
    }

    const knex = getKnex();
    const restaurant = await resolveRestaurant(knex, payload);
    const callMeta = payload.call || {};
    const lead = payload.lead || {};
    const synthflowCallId = String(payload.call_id || callMeta.call_id || lead.call_id || "").trim() || null;
    const callerPhone =
      normalizeE164(payload.phone_number_from) ||
      normalizeE164(lead.phone_number) ||
      normalizeE164(callMeta.from) ||
      normalizeE164(callMeta.phone) ||
      normalizeE164(payload.caller_phone) ||
      "Unknown";

    const recordingUrl =
      payload.recording_url ||
      payload.recording ||
      callMeta.recording_url ||
      callMeta.recording ||
      payload.audio_url ||
      null;

    const rawTranscript =
      payload.transcript ||
      callMeta.transcript ||
      payload.conversation_history ||
      payload.transcript_object ||
      null;
    const transcript =
      typeof rawTranscript === "object" && rawTranscript !== null
        ? JSON.stringify(rawTranscript)
        : rawTranscript;

    const durationSeconds =
      Number(payload.recording_duration || callMeta.recording_duration || callMeta.duration || payload.duration || 0) || 0;

    const rawNotes =
      payload.analysis?.call_summary ||
      payload.analysis?.summary ||
      payload.analysis?.call_summary_feedback ||
      payload.analysis?.all_feedback ||
      payload.summary ||
      payload.call_summary ||
      null;
    const callNotes =
      typeof rawNotes === "object" && rawNotes !== null
        ? JSON.stringify(rawNotes)
        : rawNotes;

    let callRow = null;
    if (synthflowCallId) {
      callRow = await knex("calls").where({ synthflow_call_id: synthflowCallId }).first();
    }

    const callPatch = {
      phone_number: callerPhone,
      status: mapCallStatus(callMeta.status || payload.status || payload.call_status),
      direction: "inbound",
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      transcript: transcript ? cleanUrduText(transcript) : null,
      notes: callNotes ? cleanUrduText(callNotes) : null,
      synthflow_call_id: synthflowCallId,
      restaurant_id: restaurant?.id || null,
      provider: "synthflow",
      ended_at: new Date().toISOString(),
      started_at: callMeta.start_time || payload.start_time || null,
    };

    if (callRow) {
      await knex("calls").where({ id: callRow.id }).update(callPatch);
    } else {
      const [created] = await knex("calls").insert(callPatch).returning("*");
      callRow = created;
    }

    // Save conversation turns into conversations table
    if (callRow?.id && transcript) {
      try {
        const turns = parseTranscriptIntoTurns(transcript);
        if (turns.length > 0) {
          await knex("conversations").where({ call_id: callRow.id }).del();
          await knex("conversations").insert(
            turns.map((t) => ({
              call_id: callRow.id,
              speaker: t.speaker,
              message: cleanUrduText(t.message),
              timestamp: new Date().toISOString(),
            }))
          );
        }
      } catch (convErr) {
        console.warn("Could not insert conversations for call:", convErr.message);
      }
    }

    // Also link any existing order by same caller phone for this restaurant
    if (callRow?.id && callerPhone !== "Unknown" && restaurant?.id) {
      try {
        const phoneDigits = String(callerPhone).replace(/\D/g, "").slice(-10);
        let query = knex("orders")
          .where({ restaurant_id: restaurant.id })
          .whereNull("call_id")
          .orderBy("created_at", "desc");
        
        if (phoneDigits.length >= 8) {
          query = query.andWhere(function() {
            this.where("customer_phone", callerPhone)
                .orWhereRaw("ai_extracted_data->'raw'->>'caller_phone' = ?", [callerPhone])
                .orWhereRaw("right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ?", [phoneDigits]);
          });
        }
        const recentOrderByPhone = await query.first();
        if (recentOrderByPhone) {
          const currentAiData = recentOrderByPhone.ai_extracted_data || {};
          await knex("orders").where({ id: recentOrderByPhone.id }).update({
            call_id: callRow.id,
            ai_extracted_data: {
              ...currentAiData,
              synthflow_call_id: synthflowCallId,
              recording_url: recordingUrl || currentAiData.recording_url,
              transcript: transcript || currentAiData.transcript,
              call_summary: callNotes || currentAiData.call_summary,
              provider: "synthflow",
            },
          });
        }
      } catch (linkErr) {
        console.warn("Could not auto-link recent order by phone:", linkErr.message);
      }
    }

    const rawFields = extractSynthflowFields(payload);
    const fields = supplementFieldsFromTranscript(rawFields, transcript, callNotes);
    const orderPlaced = truthyYes(fields.order_placed);
    const items = parseOrderItemsText(fields.order_items);
    const hasCustomer = !emptyish(fields.customer_name);
    const shouldCreate = (orderPlaced || items.length > 0) && items.length > 0;

    if (!restaurant) {
      console.warn("Synthflow webhook: restaurant not resolved");
      return res.json({
        success: true,
        call_id: callRow?.id,
        order_created: false,
        reason: "restaurant_not_resolved",
      });
    }

    // ── TABLE RESERVATION EXTRACTION & CREATION ────────────────
    let reservationResult = null;
    const hasReservationIntent =
      truthyYes(fields.table_reserved) ||
      !emptyish(fields.reservation_date) ||
      !emptyish(fields.reservation_time) ||
      /reserv(e|ation)|table\s+for\s+\d|book(ing)?\s+(a\s+)?table/i.test(`${transcript || ""} ${callNotes || ""}`);

    if (hasReservationIntent && restaurant?.id) {
      const reservationRestaurantId = await resolveSpokenBranchId(
        knex,
        restaurant.id,
        fields.branch_name || fields.area || null,
      );
      const partySize = Math.max(1, parseInt(fields.party_size, 10) || 2);
      const resDate = parseReservationDate(fields.reservation_date);
      const resTime =
        lastSpokenReservationTime(customerTranscriptFrom(transcript)) ||
        parseReservationTime(fields.reservation_time);
      const duration = Number(fields.slot_duration_hours) || 1;
      const custName = (!emptyish(fields.customer_name) && fields.customer_name) || "Phone Customer";
      const custPhone = (!emptyish(fields.customer_phone) && fields.customer_phone) || callerPhone;

      let existingReservation = null;
      if (callRow?.id) {
        existingReservation = await knex("table_reservations").where({ call_id: callRow.id }).first();
      }
      if (!existingReservation && synthflowCallId) {
        existingReservation = await knex("table_reservations")
          .whereRaw("ai_extracted_data->>'synthflow_call_id' = ?", [String(synthflowCallId)])
          .first();
      }
      if (!existingReservation && custPhone && custPhone !== "Unknown") {
        const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const phoneTail = String(custPhone).replace(/\D/g, "").slice(-10);
        const callerPhoneTail = String(callerPhone).replace(/\D/g, "").slice(-10);
        
        const familyRows = await knex("restaurants").where({ parent_restaurant_id: restaurant.id }).select("id");
        const familyIds = [restaurant.id, reservationRestaurantId, ...familyRows.map((row) => row.id)];
        
        let recentQuery = knex("table_reservations")
          .whereIn("restaurant_id", familyIds)
          .where({ reservation_date: resDate })
          .whereIn("status", ["pending", "confirmed", "seated"])
          .andWhere("created_at", ">=", since)
          .orderBy("created_at", "desc");
          
        if (phoneTail.length >= 8 || callerPhoneTail.length >= 8) {
          recentQuery = recentQuery.andWhere(function() {
             this.where("customer_phone", custPhone)
                 .orWhere("customer_phone", callerPhone);
                 
             if (phoneTail.length >= 8) {
                 this.orWhereRaw("right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ?", [phoneTail]);
             }
             if (callerPhoneTail.length >= 8) {
                 this.orWhereRaw("right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ?", [callerPhoneTail]);
             }
             this.orWhereRaw("ai_extracted_data->'raw'->>'caller_phone' = ?", [callerPhone]);
          });
        } else {
          recentQuery = recentQuery.where({ customer_phone: custPhone });
        }
        existingReservation = await recentQuery.first();
      }

      if (existingReservation) {
        const existingTime = String(existingReservation.start_time || "").slice(0, 5);
        const currentAi = existingReservation.ai_extracted_data || {};
        const patch = {
          call_id: callRow?.id || existingReservation.call_id,
          ai_extracted_data: {
            ...currentAi,
            provider: "synthflow",
            synthflow_call_id: synthflowCallId || currentAi.synthflow_call_id,
            recording_url: recordingUrl || currentAi.recording_url,
            transcript: transcript || currentAi.transcript,
            call_summary: callNotes || currentAi.call_summary,
            duration_seconds: durationSeconds || currentAi.duration_seconds,
          },
        };
        if (resTime && existingTime !== resTime) {
          const availableTable = await findAvailableTable(knex, {
            restaurantId: reservationRestaurantId,
            partySize: existingReservation.party_size || partySize,
            reservationDate: resDate,
            startTime: resTime,
            slotDurationHours: duration,
          });
          patch.reservation_date = resDate;
          patch.start_time = resTime;
          patch.table_id = availableTable ? availableTable.id : existingReservation.table_id;
          patch.status = availableTable ? "confirmed" : existingReservation.status;
          console.log(`🕒 Synthflow reservation time corrected: ${existingTime} → ${resTime} id=${existingReservation.id}`);
        }
        await knex("table_reservations").where({ id: existingReservation.id }).update(patch);
        reservationResult = {
          created: false,
          id: existingReservation.id,
          reason: "already_created",
          reservation_time: resTime || existingTime,
        };
      } else if (!resTime) {
        reservationResult = { created: false, reason: "missing_time" };
        console.log("⏭ Synthflow reservation skipped: no booking time in call");
      } else {
        let hasOlderDuplicate = false;
        if (custPhone && custPhone !== "Unknown") {
          const phoneDigits = String(custPhone).replace(/\D/g, "");
          if (phoneDigits) {
            const dup = await knex("table_reservations")
              .whereIn("restaurant_id", [restaurant.id, reservationRestaurantId])
              .andWhere(function() {
                this.where("customer_phone", custPhone)
                    .orWhere("customer_phone", `+${phoneDigits}`)
                    .orWhere("customer_phone", phoneDigits);
                if (phoneDigits.length === 10) this.orWhere("customer_phone", `+1${phoneDigits}`);
                if (phoneDigits.length === 12 && phoneDigits.startsWith("92")) this.orWhere("customer_phone", `0${phoneDigits.slice(2)}`);
              })
              .whereIn("status", ["pending", "confirmed"])
              .where("reservation_date", ">=", knex.raw("CURRENT_DATE"))
              .first();
            if (dup) hasOlderDuplicate = true;
          }
        }

        if (hasOlderDuplicate) {
          reservationResult = { created: false, reason: "already_has_active_reservation" };
          console.log("⏭ Synthflow reservation skipped: caller already has an active reservation for today or future");
        } else {
          const availableTable = await findAvailableTable(knex, {
            restaurantId: reservationRestaurantId,
            partySize,
            reservationDate: resDate,
            startTime: resTime,
            slotDurationHours: duration,
          });

          const createdRes = await createReservation(knex, {
          restaurantId: reservationRestaurantId,
          tableId: availableTable ? availableTable.id : null,
          customerName: custName,
          customerPhone: custPhone,
          customerEmail: cleanEmail(fields.customer_email),
          partySize,
          reservationDate: resDate,
          startTime: resTime,
          slotDurationHours: duration,
          status: availableTable ? "confirmed" : "pending",
          notes: (!emptyish(fields.special_notes) && fields.special_notes) || null,
          source: "phone",
          callId: callRow?.id,
          aiExtractedData: {
            provider: "synthflow",
            synthflow_call_id: synthflowCallId,
            recording_url: recordingUrl,
            transcript: transcript,
            call_summary: callNotes,
            fields,
            reservation_time: resTime,
            reservation_date: resDate,
          },
        });

        reservationResult = {
          created: true,
          id: createdRes.id,
          table_number: availableTable?.table_number || null,
          status: createdRes.status,
          party_size: partySize,
          reservation_date: resDate,
          reservation_time: resTime,
        };

        console.log(`✅ Synthflow table reservation created: id=${createdRes.id} table=${availableTable?.table_number || "unassigned"} time=${resTime}`);
        }
      }
    }

    // Idempotency: one order per Synthflow call - update recording & transcript if exists
    if (synthflowCallId) {
      const existing = await knex("orders")
        .whereRaw("ai_extracted_data->>'synthflow_call_id' = ?", [synthflowCallId])
        .first();
      if (existing) {
        const currentAiData = existing.ai_extracted_data || {};
        const updatedAiData = {
          ...currentAiData,
          synthflow_call_id: synthflowCallId,
          recording_url: recordingUrl || currentAiData.recording_url,
          transcript: transcript || currentAiData.transcript,
          call_summary: callNotes || currentAiData.call_summary,
          provider: "synthflow",
        };
        await knex("orders").where({ id: existing.id }).update({
          call_id: callRow?.id || existing.call_id,
          ai_extracted_data: updatedAiData,
        });

        return res.json({
          success: true,
          call_id: callRow?.id,
          order_created: false,
          reservation_created: Boolean(reservationResult?.created),
          reservation: reservationResult || undefined,
          order_id: existing.id,
          order_number: existing.order_number,
          reason: "already_created",
        });
      }
    }

    if (!shouldCreate) {
      console.log("No order to create from call", {
        orderPlaced,
        itemCount: items.length,
        hasCustomer,
        reservationCreated: Boolean(reservationResult?.created),
      });
      return res.json({
        success: true,
        call_id: callRow?.id,
        order_created: false,
        reservation_created: Boolean(reservationResult?.created),
        reservation: reservationResult || undefined,
        reason: reservationResult ? "reservation_processed" : "no_order_in_call",
        fields,
      });
    }

    const couponRaw = emptyish(fields.coupon_code) ? null : fields.coupon_code;
    const notesRaw = emptyish(fields.special_notes) ? null : fields.special_notes;
    const phone =
      (!emptyish(fields.customer_phone) && fields.customer_phone) || callerPhone;

    const phoneDigits = String(phone || "").replace(/\D/g, "").slice(-10);
    if (phoneDigits.length >= 8) {
      const recent = await knex("orders")
        .where({ restaurant_id: restaurant.id, source: "phone" })
        .where("created_at", ">", new Date(Date.now() - 20 * 60 * 1000))
        .whereRaw("right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ?", [phoneDigits])
        .orderBy("created_at", "desc")
        .first();
      if (recent) {
        const currentAiData = recent.ai_extracted_data || {};
        await knex("orders").where({ id: recent.id }).update({
          call_id: callRow?.id || recent.call_id,
          ai_extracted_data: {
            ...currentAiData,
            synthflow_call_id: synthflowCallId || currentAiData.synthflow_call_id,
            recording_url: recordingUrl || currentAiData.recording_url,
            transcript: transcript || currentAiData.transcript,
            call_summary: callNotes || currentAiData.call_summary,
            provider: "synthflow",
          },
        });
        return res.json({
          success: true,
          call_id: callRow?.id,
          order_created: false,
          order_id: recent.id,
          order_number: recent.order_number,
          reason: "already_created_during_call",
        });
      }
    }

    const { order, reservation: bookedFromItems, reservationError, unmatched, coupon, totals } = await createPhoneOrder(knex, {
      restaurantId: restaurant.id,
      customer_name: (!emptyish(fields.customer_name) && fields.customer_name) || "Phone Customer",
      customer_phone: phone,
      customer_email: cleanEmail(fields.customer_email),
      delivery_address: (!emptyish(fields.delivery_address) && fields.delivery_address) || (String(fields.fulfillment_type || "").toLowerCase() === "pickup" ? "Pickup" : null),
      delivery_notes: notesRaw,
      items,
      coupon_code: couponRaw,
      payment_method: emptyish(fields.payment_method) ? "cash" : fields.payment_method,
      fulfillment_type: fields.fulfillment_type || "delivery",
      branch_name: fields.branch_name || null,
      call_id: callRow?.id,
      source: "phone",
      ai_extracted_data: {
        provider: "synthflow",
        synthflow_call_id: synthflowCallId,
        recording_url: recordingUrl,
        transcript: transcript,
        call_summary: callNotes,
        fields,
        raw_status: payload.status,
        end_call_reason: callMeta.end_call_reason || payload.end_call_reason,
      },
    });

    if (!order) {
      console.log("Skipped food order: call was a table reservation", {
        reservationError,
        reservationId: bookedFromItems?.id || reservationResult?.id,
      });
      return res.json({
        success: true,
        call_id: callRow?.id,
        order_created: false,
        reservation_created: Boolean(bookedFromItems || reservationResult?.created),
        reservation: bookedFromItems || reservationResult || undefined,
        reason: reservationError || "reservation_not_an_order",
      });
    }

    console.log(
      `✅ Synthflow order created: ${order.order_number} restaurant=${restaurant.id} total=${totals.total}`,
    );

    return res.json({
      success: true,
      call_id: callRow?.id,
      order_created: true,
      reservation_created: Boolean(reservationResult?.created),
      reservation: reservationResult || undefined,
      order_id: order.id,
      order_number: order.order_number,
      tracking_code: order.tracking_code,
      unmatched,
      coupon,
      totals,
    });
  } catch (e) {
    console.error("Synthflow post-call webhook error:", e);
    // Always 200-ish friendly for provider retries? Prefer 500 so they retry on transient failures.
    return res.status(500).json({ success: false, error: e.message || "webhook failed" });
  }
}
