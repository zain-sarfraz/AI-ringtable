/**
 * Push prompt+tools, then verify Urdu flows: delivery / track / table + soft human tone.
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
    const r = await knex("restaurants").where({ id: row.id }).first("agent_system_prompt", "name", "synthflow_agent_id");
    const t = String(r?.agent_system_prompt || "");
    results.push({
      restaurant: r?.name,
      agent: r?.synthflow_agent_id,
      softHuman: /SOFT, HUMAN, NEVER RUDE|like a real polite human/i.test(t),
      noBranch: /NO BRANCH CHOICE/i.test(t),
      deliveryNoArea: /NEVER ask city\/area\/branch after the address/i.test(t),
      trackFlow: /TRACK ORDER[\s\S]{0,200}order number/i.test(t) && /get_order_status/i.test(t),
      trackNoArea: /TRACK ORDER: ask only the order number/i.test(t) || /NEVER ask area\/branch for tracking/i.test(t),
      tableFlow: /TABLE RESERVATION/i.test(t) && /reserve_table/i.test(t),
      tableNoArea: /TABLE:[\s\S]{0,120}Do NOT ask area\/branch/i.test(t) || /NEVER ask area\/branch\/town[\s\S]{0,80}table/i.test(t),
      whichAreaAsk: /Which area would you like/i.test(t),
      politeClose: /Bohot shukriya|Allah hafiz/i.test(t),
    });
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await knex.destroy();
}
