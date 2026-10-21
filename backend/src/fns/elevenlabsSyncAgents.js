import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

export async function elevenlabsSyncAgents(req, res) {
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const knex = getKnex();

    // Page through ElevenLabs agents list
    const fetched = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = new URL("https://api.elevenlabs.io/v1/convai/agents");
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      const resFetch = await fetch(url.toString(), {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      });
      if (!resFetch.ok) {
        const text = await resFetch.text();
        throw new Error(`ElevenLabs list agents failed [${resFetch.status}]: ${text}`);
      }
      const json = await resFetch.json();
      const agents = json.agents ?? [];
      for (const a of agents) {
        fetched.push({
          agent_id: a.agent_id,
          name: a.name ?? "Unnamed Agent",
        });
      }
      cursor = json.has_more && json.next_cursor ? json.next_cursor : null;
      pages++;
      if (pages > 20) break; // safety
    } while (cursor);

    // For each agent, fetch detail
    const detailed = await Promise.all(
      fetched.map(async (a) => {
        try {
          const resFetch = await fetch(
            `https://api.elevenlabs.io/v1/convai/agents/${a.agent_id}`,
            { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
          );
          if (!resFetch.ok) return a;
          const d = await resFetch.json();
          return {
            ...a,
            name: d.name ?? a.name,
            description: d.conversation_config?.agent?.first_message ?? null,
            voice_id: d.conversation_config?.tts?.voice_id ?? null,
            system_prompt: d.conversation_config?.agent?.prompt?.prompt ?? null,
          };
        } catch {
          return a;
        }
      }),
    );

    // Check if there's already an ACTIVE real default
    const existingDefault = await knex("ai_agents")
      .select("id", "elevenlabs_agent_id", "is_active")
      .where("is_default", true)
      .first();
    const hasRealDefault =
      !!existingDefault &&
      existingDefault.is_active &&
      existingDefault.elevenlabs_agent_id !== "__USE_ENV__";

    let inserted = 0;
    let updated = 0;
    for (const a of detailed) {
      const existing = await knex("ai_agents")
        .select("id")
        .where("elevenlabs_agent_id", a.agent_id)
        .first();

      if (existing) {
        await knex("ai_agents")
          .update({
            name: a.name,
            description: a.description ?? null,
            voice_id: a.voice_id ?? null,
            system_prompt_template: a.system_prompt ?? null,
            is_active: true,
          })
          .where("id", existing.id);
        updated++;
      } else {
        await knex("ai_agents").insert({
          elevenlabs_agent_id: a.agent_id,
          name: a.name,
          description: a.description ?? null,
          voice_id: a.voice_id ?? null,
          system_prompt_template: a.system_prompt ?? null,
          is_active: true,
          is_default: !hasRealDefault && inserted === 0,
        });
        inserted++;
      }
    }

    // Mark agents not present in ElevenLabs as inactive
    const ids = detailed.map((a) => a.agent_id);
    if (ids.length > 0) {
      await knex("ai_agents")
        .update({ is_active: false })
        .whereNotIn("elevenlabs_agent_id", ids);
    }

    // Sanity check for default
    const currentDefault = await knex("ai_agents")
      .select("id", "is_active", "elevenlabs_agent_id")
      .where("is_default", true)
      .first();
    const defaultIsValid =
      currentDefault &&
      currentDefault.is_active &&
      currentDefault.elevenlabs_agent_id !== "__USE_ENV__";

    if (!defaultIsValid) {
      await knex("ai_agents").update({ is_default: false }).where("is_default", true);
      const firstActive = await knex("ai_agents")
        .select("id")
        .where("is_active", true)
        .orderBy("created_at", "asc")
        .first();
      if (firstActive) {
        await knex("ai_agents").update({ is_default: true }).where("id", firstActive.id);
      }
    }

    return res.json({
      success: true,
      total: detailed.length,
      inserted,
      updated,
    });
  } catch (e) {
    console.error("sync-agents error:", e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
