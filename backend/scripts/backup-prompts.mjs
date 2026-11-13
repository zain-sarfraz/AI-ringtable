/**
 * Backup voice prompts from DB + source templates.
 * Usage (from backend/): node scripts/backup-prompts.mjs
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getKnex } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(root, "backups", "prompts", stamp);

fs.mkdirSync(outDir, { recursive: true });

const knex = getKnex();
const rows = await knex("restaurants")
  .select(
    "id",
    "name",
    "agent_system_prompt",
    "agent_first_message",
    "agent_language",
    "agent_voice_id",
    "synthflow_agent_id",
    "synthflow_synced_at",
  )
  .whereNotNull("agent_system_prompt");

const index = [];
for (const r of rows) {
  const slug = String(r.name || r.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = `${slug}_${String(r.id).slice(0, 8)}`;
  const promptPath = path.join(outDir, `${base}_system_prompt.txt`);
  const metaPath = path.join(outDir, `${base}_meta.json`);
  fs.writeFileSync(promptPath, r.agent_system_prompt || "", "utf8");
  const meta = {
    id: r.id,
    name: r.name,
    agent_language: r.agent_language,
    agent_voice_id: r.agent_voice_id,
    agent_first_message: r.agent_first_message,
    synthflow_agent_id: r.synthflow_agent_id,
    synthflow_synced_at: r.synthflow_synced_at,
    prompt_chars: (r.agent_system_prompt || "").length,
    backed_up_at: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  if (r.agent_first_message) {
    fs.writeFileSync(path.join(outDir, `${base}_greeting.txt`), r.agent_first_message, "utf8");
  }
  index.push({ ...meta, files: { prompt: path.basename(promptPath), meta: path.basename(metaPath) } });
}

// Source templates that generate prompts
const sources = [
  "backend/src/lib/restaurantVoiceContext.js",
  "backend/src/lib/promptMerge.js",
  "backend/src/fns/restaurantCreateSynthflowAgent.js",
];
const srcDir = path.join(outDir, "source");
fs.mkdirSync(srcDir, { recursive: true });
for (const rel of sources) {
  const from = path.join(root, rel);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(srcDir, path.basename(from)));
  }
}

fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ stamp, outDir, restaurants: index }, null, 2), "utf8");
fs.writeFileSync(
  path.join(outDir, "README.txt"),
  [
    "Voice prompt backup",
    `Created: ${new Date().toISOString()}`,
    "",
    "How this works:",
    "1) Live/synced prompt lives in DB column restaurants.agent_system_prompt",
    "2) Settings UI shows/edits that same field",
    "3) Code templates that rebuild prompts are in source/",
    "",
    "Restore tip:",
    "- Paste *_system_prompt.txt back into Restaurant Settings → system prompt, then Update agent",
    "- Or UPDATE restaurants SET agent_system_prompt = <file contents> WHERE id = ...",
    "",
  ].join("\n"),
  "utf8",
);

await knex.destroy();
console.log(`Backup written to: ${outDir}`);
console.log(`Restaurants: ${index.length}`);
for (const i of index) console.log(` - ${i.name} (${i.prompt_chars} chars)`);
