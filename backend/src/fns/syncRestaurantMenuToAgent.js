import { getKnex } from "../db.js";
import {
  buildRestaurantVoiceKnowledge,
  loadRestaurantVoiceCatalog,
} from "../lib/restaurantVoiceContext.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

const EL_API = "https://api.elevenlabs.io";

export async function syncRestaurantMenuToAgent(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    // Support both direct body or nested body
    const body = req.body || {};
    const restaurant_id = body.restaurant_id || body.body?.restaurant_id;

    if (!restaurant_id) {
      console.log("❌ Missing restaurant_id in request body:", body);
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }

    console.log("🔄 Starting Menu Sync for restaurant:", restaurant_id);
    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error(`Restaurant ${restaurant_id} not found in database`);
    if (!r.elevenlabs_agent_id) throw new Error("This restaurant doesn't have an ElevenLabs Agent ID yet.");
    
    const ELEVENLABS_API_KEY = r.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) throw new Error("ElevenLabs API key is missing. Please connect ElevenLabs first.");

    const catalog = await loadRestaurantVoiceCatalog(knex, restaurant_id);
    const currency = catalog.settings?.currency || r.currency || "USD";
    const preferUrduPrices =
      !r.agent_language ||
      String(r.agent_language).toLowerCase().startsWith("ur") ||
      currency === "PKR";
    const doc = buildRestaurantVoiceKnowledge({
      restaurantName: r.name,
      currency,
      preferUrduPrices,
      ...catalog,
    });

    if (r.agent_knowledge_doc_id) {
      await fetch(`${EL_API}/v1/convai/knowledge-base/${r.agent_knowledge_doc_id}?force=true`, {
        method: "DELETE",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      }).catch(() => {});
    }

    console.log("📤 Uploading new Menu to ElevenLabs KB (JSON)...");
    const upload = await fetch(`${EL_API}/v1/convai/knowledge-base/text`, {
      method: "POST",
      headers: { 
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: `${r.name} — Menu`,
        text: doc
      }),
    });
    
    if (!upload.ok) {
      const err = await upload.text();
      let errMsg = err;
      try {
        const parsed = JSON.parse(err);
        if (parsed?.detail?.status === "missing_permissions" || parsed?.detail?.code === "unauthorized") {
          errMsg = parsed.detail.message || "ElevenLabs API key is missing 'convai_write' permission.";
          console.warn("⚠️ ElevenLabs permission warning:", errMsg);
          return res.status(200).json({ success: false, warning: errMsg, error: errMsg });
        }
      } catch {}
      throw new Error(`ElevenLabs KB Upload Failed: ${errMsg}`);
    }
    
    const { id: docId } = await upload.json();

    const patch = await fetch(`${EL_API}/v1/convai/agents/${r.elevenlabs_agent_id}`, {
      method: "PATCH",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              knowledge_base: [{ type: "text", id: docId, name: `${r.name} — Menu`, usage_mode: "auto" }],
            },
          },
        },
      }),
    });

    if (!patch.ok) {
      const patchErr = await patch.text();
      console.warn("⚠️ ElevenLabs Agent Patch warning:", patchErr);
      return res.status(200).json({ success: false, warning: patchErr, error: patchErr });
    }

    await knex("restaurants")
      .where({ id: r.id })
      .update({ agent_knowledge_doc_id: docId, agent_menu_synced_at: new Date().toISOString() });

    console.log("✅ Sync complete for", r.name);
    return res.json({ success: true, doc_id: docId });
  } catch (e) {
    console.error("❌ Sync Error:", e.message);
    return res.status(200).json({ success: false, error: e.message });
  }
}
