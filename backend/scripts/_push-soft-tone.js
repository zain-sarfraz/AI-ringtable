/**
 * One-shot: inject soft/gentle tone into the live Synthflow agent prompt.
 *   node --env-file=.env scripts/_push-soft-tone.js
 */
process.env.APP_ENV = "production";
process.env.PUBLIC_API_URL = "https://ringtable.io/backend";
process.env.ALLOW_VOICE_SYNC = "true";

import "../src/loadEnv.js";
process.env.APP_ENV = "production";
process.env.PUBLIC_API_URL = "https://ringtable.io/backend";

import { getKnex } from "../src/db.js";
import { pushBranchListToAgent } from "../src/lib/syncAgentBranches.js";

const knex = getKnex();
try {
  const rows = await knex("restaurants")
    .whereNotNull("synthflow_agent_id")
    .where("synthflow_agent_id", "!=", "")
    .select("id", "name", "synthflow_agent_id");
  const results = [];
  for (const row of rows) {
    await pushBranchListToAgent(knex, row.id);
    const r = await knex("restaurants")
      .where({ id: row.id })
      .first("agent_system_prompt", "synthflow_agent_id", "name");
    const prompt = String(r?.agent_system_prompt || "");
    results.push({
      restaurant: r?.name,
      agent: r?.synthflow_agent_id,
      hasSoftTone: /TONE & MANNERS \(CRITICAL/i.test(prompt),
      softMentions: (prompt.match(/soft|gentle|never rude|never sound rude/gi) || []).length,
    });
  }
  console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2));
} finally {
  await knex.destroy();
}
