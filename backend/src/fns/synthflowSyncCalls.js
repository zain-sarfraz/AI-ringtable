import { getKnex } from "../db.js";
import { synthflowRequest } from "../lib/synthflowClient.js";
import { normalizeE164 } from "../lib/voiceWebhookUtils.js";
import { cleanUrduText } from "../lib/devanagariTransliterator.js";

function mapCallStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "completed" || s === "done") return "completed";
  if (s === "in-progress" || s === "ringing" || s === "pending") return "in_progress";
  if (s === "no-answer" || s === "busy" || s === "failed" || s === "canceled" || s === "user-canceled") {
    return "missed";
  }
  return "completed";
}

export function parseTranscriptIntoTurns(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const turns = [];
  for (const line of lines) {
    const m = line.match(/^(?:\[([^\]]+)\]\s*)?(agent|ai|bot|customer|user|human|lead|caller|assistant|system)[:\-]\s*(.*)$/i);
    if (m) {
      const rawSpeaker = m[2].toLowerCase();
      const message = m[3].trim();
      const speaker = ["agent", "ai", "bot", "assistant", "system"].includes(rawSpeaker) ? "ai" : "customer";
      turns.push({ speaker, message });
    } else if (turns.length > 0) {
      turns[turns.length - 1].message += `\n${line}`;
    } else {
      turns.push({ speaker: "customer", message: line });
    }
  }
  return turns;
}

export async function synthflowSyncCalls(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    const body = req.body || {};
    const requestedRestaurantId = body.restaurant_id || req.query?.restaurant_id || null;
    const requestedOrderId = body.order_id || req.query?.order_id || null;

    let targetRestaurants = [];
    if (requestedRestaurantId) {
      const r = await knex("restaurants").where({ id: requestedRestaurantId }).first();
      if (r) targetRestaurants = [r];
    } else {
      targetRestaurants = await knex("restaurants")
        .whereNotNull("synthflow_agent_id")
        .andWhere("synthflow_agent_id", "!=", "");
    }

    if (!targetRestaurants.length) {
      return res.json({
        success: true,
        message: "No restaurants configured with Synthflow agent ID.",
        synced_calls: 0,
      });
    }

    let totalSyncedCalls = 0;
    let totalLinkedOrders = 0;

    for (const rest of targetRestaurants) {
      const agentId = rest.synthflow_agent_id;
      if (!agentId) continue;

      let synthflowData = null;
      try {
        synthflowData = await synthflowRequest(`/calls?model_id=${encodeURIComponent(agentId)}&limit=25`);
      } catch (sfErr) {
        console.warn(`Could not fetch Synthflow calls for restaurant ${rest.id} (${agentId}):`, sfErr.message);
        continue;
      }

      const callsList = synthflowData?.response?.calls || synthflowData?.calls || [];
      console.log(`[SynthflowSync] Found ${callsList.length} calls for restaurant ${rest.name} (${rest.id})`);

      for (const sfCall of callsList) {
        const synthflowCallId = String(sfCall.call_id || "").trim();
        if (!synthflowCallId) continue;

        const callerPhone =
          normalizeE164(sfCall.phone_number_from) ||
          normalizeE164(sfCall.caller_phone) ||
          normalizeE164(sfCall.from) ||
          "Unknown";

        const recordingUrl = sfCall.recording_url || sfCall.recording || null;
        const transcript = sfCall.transcript || null;
        const durationSeconds = Number(sfCall.duration || sfCall.recording_duration || 0) || 0;
        const callNotes =
          typeof sfCall.analysis === "object"
            ? JSON.stringify(sfCall.analysis)
            : sfCall.call_summary || sfCall.summary || null;

        let callRow = await knex("calls").where({ synthflow_call_id: synthflowCallId }).first();

        const callPatch = {
          phone_number: callerPhone,
          status: mapCallStatus(sfCall.call_status || sfCall.status),
          direction: sfCall.type_of_call === "outbound" ? "outbound" : "inbound",
          duration_seconds: durationSeconds,
          recording_url: recordingUrl,
          transcript: transcript ? cleanUrduText(transcript) : null,
          notes: callNotes ? cleanUrduText(callNotes) : null,
          synthflow_call_id: synthflowCallId,
          restaurant_id: rest.id,
          provider: "synthflow",
          ended_at: new Date().toISOString(),
          started_at: sfCall.start_time ? new Date(Number(sfCall.start_time)).toISOString() : null,
        };

        if (callRow) {
          await knex("calls").where({ id: callRow.id }).update(callPatch);
        } else {
          const [created] = await knex("calls").insert(callPatch).returning("*");
          callRow = created;
        }
        totalSyncedCalls++;

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

        // Link with matching orders — never overwrite a different call already attached
        const callAnchor = callPatch.started_at || callRow?.started_at || callRow?.created_at || new Date();
        const windowStart = new Date(new Date(callAnchor).getTime() - 30 * 60 * 1000);
        const windowEnd = new Date(new Date(callAnchor).getTime() + 30 * 60 * 1000);
        const phoneDigits = String(callerPhone).replace(/\D/g, "").slice(-10);

        // 1. Order explicitly linked via synthflow_call_id
        let matchedOrder = await knex("orders")
          .whereRaw("ai_extracted_data->>'synthflow_call_id' = ?", [synthflowCallId])
          .first();

        // 2. Order linked by call_id
        if (!matchedOrder && callRow?.id) {
          matchedOrder = await knex("orders").where({ call_id: callRow.id }).first();
        }

        // 3. Requested order — only if orphan and within ±30 min of this call (never steal another call)
        if (!matchedOrder && requestedOrderId) {
          const cand = await knex("orders").where({ id: requestedOrderId }).first();
          if (cand) {
            const existingSf = cand.ai_extracted_data?.synthflow_call_id;
            const createdAt = cand.created_at ? new Date(cand.created_at) : null;
            const inWindow =
              createdAt && createdAt >= windowStart && createdAt <= windowEnd;
            const orphan = !cand.call_id && (!existingSf || existingSf === synthflowCallId);
            if (orphan && inWindow && cand.restaurant_id === rest.id) {
              matchedOrder = cand;
            }
          }
        }

        // 4. Same restaurant + phone + orphan + time window
        if (!matchedOrder && callerPhone !== "Unknown" && phoneDigits.length >= 8) {
          matchedOrder = await knex("orders")
            .where({ restaurant_id: rest.id })
            .whereNull("call_id")
            .whereBetween("created_at", [windowStart.toISOString(), windowEnd.toISOString()])
            .andWhere((qb) => {
              qb.where("customer_phone", callerPhone).orWhereRaw(
                "right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ?",
                [phoneDigits],
              );
            })
            .andWhere((qb) => {
              qb.whereNull("ai_extracted_data")
                .orWhereRaw("ai_extracted_data->>'synthflow_call_id' IS NULL")
                .orWhereRaw("ai_extracted_data->>'synthflow_call_id' = ?", [String(synthflowCallId || "")]);
            })
            .orderBy("created_at", "desc")
            .first();
        }

        if (matchedOrder) {
          const currentAiData = matchedOrder.ai_extracted_data || {};
          const existingSf = currentAiData.synthflow_call_id;
          if (existingSf && existingSf !== synthflowCallId) {
            // Already attached to a different Synthflow call — do not overwrite
          } else if (matchedOrder.call_id && callRow?.id && matchedOrder.call_id !== callRow.id) {
            // Already linked to a different calls row
          } else {
            const updatedAiData = {
              ...currentAiData,
              synthflow_call_id: synthflowCallId,
              recording_url: recordingUrl || currentAiData.recording_url,
              transcript: transcript || currentAiData.transcript,
              call_summary: callNotes || currentAiData.call_summary,
              provider: "synthflow",
            };

            await knex("orders").where({ id: matchedOrder.id }).update({
              call_id: callRow?.id || matchedOrder.call_id,
              ai_extracted_data: updatedAiData,
            });
            totalLinkedOrders++;
          }
        }
      }
    }

    return res.json({
      success: true,
      synced_calls: totalSyncedCalls,
      linked_orders: totalLinkedOrders,
    });
  } catch (e) {
    console.error("synthflowSyncCalls error:", e);
    return res.status(500).json({ success: false, error: e.message || "Failed to sync calls" });
  }
}
