import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

const EL = "https://api.elevenlabs.io";

export async function restaurantElevenlabsList(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) throw new Error("restaurant_id is required");

    const r = await knex("restaurants").where({ id: restaurant_id }).select("elevenlabs_api_key").first();
    if (!r) throw new Error("Restaurant not found");
    const envKey = process.env.ELEVENLABS_API_KEY;
    if (!r.elevenlabs_api_key && !envKey) {
      throw new Error("ElevenLabs not connected (set restaurant.elevenlabs_api_key or ELEVENLABS_API_KEY)");
    }

    const key = r.elevenlabs_api_key || envKey;
    const [agentsResp, phonesResp] = await Promise.all([
      fetch(`${EL}/v1/convai/agents?page_size=100`, { headers: { "xi-api-key": key } }),
      fetch(`${EL}/v1/convai/phone-numbers`, { headers: { "xi-api-key": key } }),
    ]);

    let agentsJson = { agents: [] };
    if (!agentsResp.ok) {
      const txt = await agentsResp.text();
      let missingConvaiRead = false;
      try {
        const j = JSON.parse(txt);
        if (j?.detail?.status === "missing_permissions" && String(j?.detail?.message || "").includes("convai_read")) {
          missingConvaiRead = true;
        }
      } catch {
        /* ignore */
      }
      if (missingConvaiRead) {
        console.warn(
          "[restaurantElevenlabsList] API key missing convai_read; agent dropdown empty — create a key with ConvAI read or paste Agent ID manually."
        );
      } else {
        throw new Error(`EL agents [${agentsResp.status}]: ${txt}`);
      }
    } else {
      agentsJson = await agentsResp.json();
    }

    const phonesJson = phonesResp.ok ? await phonesResp.json() : { phone_numbers: [] };

    const agents = (agentsJson.agents ?? []).map((a) => ({
      agent_id: a.agent_id,
      name: a.name,
    }));
    const phone_numbers = (phonesJson.phone_numbers ?? phonesJson ?? []).map((p) => ({
      phone_number_id: p.phone_number_id,
      phone_number: p.phone_number,
      label: p.label,
      assigned_agent: p.assigned_agent ?? p.agent_id ?? null,
    }));

    return res.json({ success: true, agents, phone_numbers });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
