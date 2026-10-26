import "../src/loadEnv.js";
import { getKnex } from "../src/db.js";

const knex = getKnex();
const r = await knex("restaurants")
  .whereNotNull("synthflow_agent_id")
  .first("name", "synthflow_agent_id", "agent_system_prompt");
const t = String(r?.agent_system_prompt || "");
const branches = await knex("restaurants")
  .where({ parent_restaurant_id: "a48b018e-1625-485c-92f7-7b9ebe8ab9a2", is_branch: true, is_active: true })
  .count("* as c")
  .first();
console.log(
  JSON.stringify(
    {
      restaurant: r?.name,
      agent: r?.synthflow_agent_id,
      activeBranches: Number(branches?.c || 0),
      hasNoBranchChoice: /NO BRANCH CHOICE/i.test(t),
      hasForbiddenJohar: /FORBIDDEN spoken words\/areas[\s\S]*Johar Town/i.test(t),
      hasWhichAreaAsk: /Which area would you like/i.test(t),
      hasAfterHaanNoArea: /NEVER ask (?:city, area, branch|area after haan)/i.test(t),
      softTone: /TONE & MANNERS \(CRITICAL/i.test(t),
    },
    null,
    2,
  ),
);
await knex.destroy();
