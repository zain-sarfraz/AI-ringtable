import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

const EL = "https://api.elevenlabs.io";

export async function restaurantAttachTwilio(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const { restaurant_id, twilio_phone_number, agent_id } = req.body || {};
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error("Restaurant not found");
    if (!r.elevenlabs_api_key) throw new Error("ElevenLabs not connected");
    if (!r.twilio_account_sid || !r.twilio_auth_token) throw new Error("Twilio not connected");

    const number = (twilio_phone_number || "").trim();
    if (!number) throw new Error("twilio_phone_number is required");
    const targetAgent = agent_id || r.elevenlabs_agent_id;
    if (!targetAgent) throw new Error("No ElevenLabs agent to bind — create one first");

    let phoneNumberId;
    const importResp = await fetch(`${EL}/v1/convai/phone-numbers/create`, {
      method: "POST",
      headers: { "xi-api-key": r.elevenlabs_api_key, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "twilio",
        label: `${r.name} (${number})`,
        phone_number: number,
        sid: r.twilio_account_sid,
        token: r.twilio_auth_token,
      }),
    });
    const importText = await importResp.text();
    if (importResp.ok) {
      phoneNumberId = JSON.parse(importText).phone_number_id;
    } else {
      const listResp = await fetch(`${EL}/v1/convai/phone-numbers`, {
        headers: { "xi-api-key": r.elevenlabs_api_key },
      });
      if (!listResp.ok) throw new Error(`EL import [${importResp.status}]: ${importText}`);
      const listJson = await listResp.json();
      const list = listJson.phone_numbers ?? listJson ?? [];
      const match = list.find((p) => p.phone_number === number);
      if (!match) throw new Error(`EL import [${importResp.status}]: ${importText}`);
      phoneNumberId = match.phone_number_id;
    }
    if (!phoneNumberId) throw new Error("Could not resolve ElevenLabs phone_number_id");

    const assignResp = await fetch(`${EL}/v1/convai/phone-numbers/${phoneNumberId}`, {
      method: "PATCH",
      headers: { "xi-api-key": r.elevenlabs_api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: targetAgent }),
    });
    if (!assignResp.ok) throw new Error(`EL assign [${assignResp.status}]: ${await assignResp.text()}`);

    await knex("restaurants")
      .where({ id: r.id })
      .update({
        twilio_phone_number: number,
        elevenlabs_agent_id: targetAgent,
      });

    return res.json({ success: true, phone_number_id: phoneNumberId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
