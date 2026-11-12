import { getKnex } from "../db.js";
import {
  attachPhoneNumbersToAgent,
  createOutboundAgent,
  getAssistant,
  pickOutboundCallerId,
  startOutboundCall,
  updateAgent,
} from "../lib/synthflowClient.js";
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

function restaurantDialInNumber(restaurant) {
  return (
    normalizeE164(restaurant?.telnyx_phone_number || "") ||
    normalizeE164(restaurant?.twilio_phone_number || "") ||
    normalizeE164(restaurant?.phone || "") ||
    null
  );
}

function unwrapAssistant(found) {
  return found?.assistant || found?.response || found?.raw || found;
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

/**
 * Restaurant voice agents are inbound (customers call in). Synthflow cannot dial out
 * from an inbound agent, so we keep a mirrored outbound twin for Place test call.
 */
async function ensureOutboundTestAgent(knex, restaurant, inboundAgent) {
  const dialIn = restaurantDialInNumber(restaurant);
  let outboundId = String(restaurant.synthflow_outbound_agent_id || "").trim();

  if (outboundId) {
    try {
      const found = await getAssistant(outboundId);
      const agent = unwrapAssistant(found);
      if (String(agent?.type || "").toLowerCase() === "outbound") {
        // Keep prompt/voice roughly in sync with inbound for realistic tests
        const src = inboundAgent?.agent || {};
        try {
          await updateAgent(outboundId, {
            agent: {
              prompt: src.prompt || inboundAgent?.prompt,
              greeting_message: src.greeting_message || inboundAgent?.greeting_message,
              language: src.language || inboundAgent?.language,
              llm: src.llm,
              voice_id: src.voice_id,
              min_words_to_interrupt: 2,
            },
          });
        } catch (syncErr) {
          console.warn("Outbound twin sync skipped:", syncErr?.message || syncErr);
        }
      } else {
        outboundId = "";
      }
    } catch {
      outboundId = "";
    }
  }

  if (!outboundId) {
    const src = inboundAgent?.agent || {};
    const created = await createOutboundAgent({
      name: `${restaurant.name || "Restaurant"} Test Outbound`.slice(0, 80),
      agent: {
        prompt: src.prompt || "You are a restaurant order assistant.",
        greeting_message: src.greeting_message || "Hello, thanks for calling.",
        language: src.language || "hi",
        llm: src.llm || "gpt-4.1-Mini",
        voice_id: src.voice_id || restaurant.agent_voice_id || "EXAVITQu4vr4xnSDxMaL",
        min_words_to_interrupt: 2,
      },
    });
    outboundId =
      created?.response?.model_id ||
      created?.model_id ||
      created?.response?.id ||
      null;
    if (!outboundId) {
      throw new Error("Could not create Synthflow outbound test agent.");
    }
    await knex("restaurants").where({ id: restaurant.id }).update({
      synthflow_outbound_agent_id: outboundId,
      updated_at: knex.fn.now(),
    });
  }

  const outFound = await getAssistant(outboundId);
  const outAgent = unwrapAssistant(outFound);
  let fromNumber = agentOutboundFromNumber(outAgent);

  // Never use the live restaurant DID as the only outbound pool number if we can avoid it —
  // prefer a free Synthflow number for test dials.
  const preferred = await pickOutboundCallerId({
    excludeNumbers: dialIn ? [dialIn] : [],
  });
  if (preferred && preferred !== fromNumber) {
    try {
      await attachPhoneNumbersToAgent(outboundId, [preferred]);
      fromNumber = preferred;
    } catch (attachErr) {
      console.warn("Outbound caller attach failed:", attachErr?.message || attachErr);
    }
  }

  if (!fromNumber) {
    if (preferred) {
      await attachPhoneNumbersToAgent(outboundId, [preferred]);
      fromNumber = preferred;
    } else if (dialIn) {
      // Last resort: share restaurant DID with outbound pool (allowed by Synthflow)
      await attachPhoneNumbersToAgent(outboundId, [dialIn]);
      fromNumber = dialIn;
    }
  }

  if (!fromNumber) {
    throw Object.assign(
      new Error(
        "No Synthflow phone number available for outbound test calls. Claim a free number in Synthflow, then try again.",
      ),
      { status: 400, code: "NO_OUTBOUND_CALLER_ID" },
    );
  }

  return { outboundId, fromNumber };
}

export async function synthflowTestCall(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res, { hard: true })) return;
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

    const dialIn = restaurantDialInNumber(restaurant);
    const found = await getAssistant(restaurant.synthflow_agent_id);
    const inboundAgent = unwrapAssistant(found);
    const agentType = String(inboundAgent?.type || "").toLowerCase() || null;

    let modelId = restaurant.synthflow_agent_id;
    let fromNumber = agentOutboundFromNumber(inboundAgent);

    if (agentType === "inbound") {
      const twin = await ensureOutboundTestAgent(knex, restaurant, inboundAgent);
      modelId = twin.outboundId;
      fromNumber = twin.fromNumber;
    } else if (!fromNumber) {
      return res.status(400).json({
        success: false,
        error:
          "This Synthflow agent has no phone number attached, so outbound test calls never ring. Attach a free Synthflow number, then try again.",
        dial_in_number: dialIn,
      });
    }

    try {
      const result = await startOutboundCall({
        modelId,
        phone,
        name: String(req.body?.name || "Test call").slice(0, 80),
        fromPhoneNumber: fromNumber,
      });

      return res.json({
        success: true,
        call_id: result.call_id,
        phone,
        from_phone_number: fromNumber,
        agent_type: agentType,
        outbound_agent_id: modelId !== restaurant.synthflow_agent_id ? modelId : null,
        message: `The agent is calling ${phone}. Answer the phone to test the order flow.`,
      });
    } catch (dialErr) {
      // 200 + success:false so the browser console does not show a scary 502;
      // Synthflow accepted the API request but never actually dialed.
      const reason = dialErr?.message || "Outbound dial failed";
      return res.status(200).json({
        success: false,
        code: dialErr?.code || "OUTBOUND_DIAL_FAILED",
        call_id: dialErr?.call_id || null,
        dial_in_number: dialIn,
        error:
          "Synthflow could not start the outbound call (telephony). " +
          (dialIn
            ? `Call ${dialIn} from your phone to test the agent — inbound still works.`
            : reason),
      });
    }
  } catch (e) {
    console.error("Synthflow test call error:", e);
    return res.status(Number(e.status) >= 400 && Number(e.status) < 600 ? Number(e.status) : 500).json({
      success: false,
      error: e.message || "Test call failed",
      call_id: e.call_id || null,
      code: e.code || (e.dial ? "OUTBOUND_DIAL_FAILED" : undefined),
    });
  }
}
