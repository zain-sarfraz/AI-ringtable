import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

const EL = "https://api.elevenlabs.io";

function defaultPrompt(name) {
  return `You are the friendly, direct AI phone ordering assistant for ${name}. If caller speaks English, converse in English. If caller speaks Urdu/Hindi, converse politely in Roman Urdu, but ALWAYS say product names, categories, menus, and delivery addresses in ENGLISH. Help callers place a NEW delivery order (collect item names with sizes/flavors in English, customer name, delivery address in English, and phone number) or check order status using place_order and get_order_status tools. For status, ask for the order number (e.g. ORD-260929-01) then call get_order_status. Payment is standard Cash on Delivery (COD) by default. Before completing the order, give ONE single complete summary containing: all ordered items in English, customer name, delivery address in English, phone number, and total bill amount. Stay concise, polite, and direct.`;
}
function defaultFirstMessage(name) {
  return `Hi, thanks for calling ${name}! Would you like to place a new order or check on an existing one?`;
}

export async function restaurantCreateAgent(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const body = req.body || {};
    const { restaurant_id, voice_id, language, first_message, system_prompt, name } = body;
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error("Restaurant not found");
    if (!r.elevenlabs_api_key) throw new Error("ElevenLabs not connected for this restaurant");

    const lang = language || r.agent_language || "en";
    const sp = (system_prompt ?? r.agent_system_prompt)?.trim() || defaultPrompt(r.name);
    const fm = (first_message ?? r.agent_first_message)?.trim() || defaultFirstMessage(r.name);
    const voice = voice_id ?? r.agent_voice_id ?? null;
    const agentName = name || `${r.name} (Order Taker)`;

    const conversation_config = {
      agent: { first_message: fm, language: lang, prompt: { prompt: sp } },
    };
    if (voice) conversation_config.tts = { voice_id: voice };

    const resp = await fetch(`${EL}/v1/convai/agents/create`, {
      method: "POST",
      headers: { "xi-api-key": r.elevenlabs_api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ name: agentName, conversation_config }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`EL create [${resp.status}]: ${text}`);
    const created = JSON.parse(text);
    const elAgentId = created.agent_id;
    if (!elAgentId) throw new Error("ElevenLabs did not return agent_id");

    await knex("restaurants")
      .where({ id: r.id })
      .update({
        elevenlabs_agent_id: elAgentId,
        agent_language: lang,
        agent_voice_id: voice,
        agent_first_message: fm,
        agent_system_prompt: sp,
      });

    return res.json({ success: true, elevenlabs_agent_id: elAgentId, name: agentName });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
