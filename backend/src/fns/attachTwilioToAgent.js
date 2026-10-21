import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

const EL_API = "https://api.elevenlabs.io";

export async function attachTwilioToAgent(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ error: "restaurant_id is required" });

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) return res.status(404).json({ error: "Restaurant not found" });
    if (!r.twilio_phone_number) {
      return res.json({ success: true, action: "skipped", warning: "Restaurant has no Twilio phone number" });
    }
    if (!r.elevenlabs_agent_id) {
      return res.json({ success: true, action: "skipped", warning: "Restaurant has no ElevenLabs agent — create one first" });
    }

    const ELEVENLABS_API_KEY = r.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY;
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

    if (!ELEVENLABS_API_KEY || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return res.json({
        success: true,
        action: "skipped",
        warning: "Twilio / ElevenLabs credentials not configured on backend; skipped Twilio phone number import."
      });
    }

    try {
      const importResp = await fetch(`${EL_API}/v1/convai/phone-numbers/create`, {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "twilio",
          label: `${r.name} (${r.twilio_phone_number})`,
          phone_number: r.twilio_phone_number,
          sid: TWILIO_ACCOUNT_SID,
          token: TWILIO_AUTH_TOKEN,
        }),
      });
      const importText = await importResp.text();
      let phoneNumberId;
      if (importResp.ok) {
        phoneNumberId = JSON.parse(importText).phone_number_id;
      } else {
        const listResp = await fetch(`${EL_API}/v1/convai/phone-numbers`, {
          headers: { "xi-api-key": ELEVENLABS_API_KEY },
        });
        if (!listResp.ok) throw new Error(`EL import failed [${importResp.status}]: ${importText}`);
        const list = await listResp.json();
        const match = (list.phone_numbers || list || []).find((p) => p.phone_number === r.twilio_phone_number);
        if (!match) throw new Error(`EL import failed [${importResp.status}]: ${importText}`);
        phoneNumberId = match.phone_number_id;
      }
      if (!phoneNumberId) throw new Error("Could not resolve ElevenLabs phone_number_id");

      const assignResp = await fetch(`${EL_API}/v1/convai/phone-numbers/${phoneNumberId}`, {
        method: "PATCH",
        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: r.elevenlabs_agent_id }),
      });
      if (!assignResp.ok) throw new Error(`EL assign failed [${assignResp.status}]: ${await assignResp.text()}`);

      return res.json({ success: true, phone_number_id: phoneNumberId });
    } catch (apiErr) {
      console.warn("⚠️ Twilio import/assign skipped:", apiErr.message);
      return res.json({
        success: true,
        action: "skipped",
        warning: `Twilio setup notice: ${apiErr.message}`,
      });
    }
  } catch (e) {
    console.error("attach-twilio-to-agent error:", e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
