import "../src/loadEnv.js";
import { getKnex } from "../src/db.js";

const parent = "a48b018e-1625-485c-92f7-7b9ebe8ab9a2";
const knex = getKnex();
const r = await knex("restaurants").where({ id: parent }).first("id", "name", "is_branch", "parent_restaurant_id");
const branches = await knex("restaurants")
  .where({ parent_restaurant_id: parent })
  .select("id", "name", "area", "city", "is_active", "is_accepting_orders", "is_branch");
const active = await knex("restaurants")
  .where({ parent_restaurant_id: parent, is_branch: true, is_active: true, is_accepting_orders: true })
  .select("id", "name", "area", "city");
const p = await knex("restaurants").where({ id: parent }).first("agent_system_prompt");
const t = String(p?.agent_system_prompt || "");
const re = /.{0,100}(Johar|Iqbal|Jhajhar|Branch ordering|NO branches|area chahiye|kaunsa area|branch_name).{0,100}/gi;
const hits = [...t.matchAll(re)].slice(0, 30).map((m) => m[0].replace(/\s+/g, " "));
console.log(JSON.stringify({ restaurant: r, allBranches: branches.length, branches, activeCount: active.length, active }, null, 2));
console.log("---PROMPT HITS---");
for (const h of hits) console.log(h + "\n---");
const idx = t.search(/## Branch ordering/i);
if (idx >= 0) console.log("---BRANCH SECTION---\n" + t.slice(idx, idx + 1200));
await knex.destroy();
