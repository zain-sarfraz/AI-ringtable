import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

export async function restaurantTwilioList(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).select("twilio_account_sid", "twilio_auth_token").first();
    if (!r) throw new Error("Restaurant not found");
    if (!r.twilio_account_sid || !r.twilio_auth_token) {
      throw new Error("Twilio not connected for this restaurant");
    }

    const auth = Buffer.from(`${r.twilio_account_sid}:${r.twilio_auth_token}`).toString("base64");
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${r.twilio_account_sid}/IncomingPhoneNumbers.json?PageSize=100`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!resp.ok) throw new Error(`Twilio [${resp.status}]: ${await resp.text()}`);
    const json = await resp.json();
    const numbers = (json.incoming_phone_numbers ?? []).map((n) => ({
      sid: n.sid,
      phone_number: n.phone_number,
      friendly_name: n.friendly_name,
    }));

    return res.json({ success: true, numbers });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
