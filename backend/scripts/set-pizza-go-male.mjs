/**
 * Switch Pizza Go agent to male persona + George voice (local DB + Synthflow).
 * From backend/: node scripts/set-pizza-go-male.mjs
 */
import "dotenv/config";
import { getKnex } from "../src/db.js";
import { updateAgent, toSynthflowLanguage } from "../src/lib/synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowGreeting,
  defaultSynthflowPrompt,
  getSynthflowVoicePrompt,
  loadRestaurantVoiceCatalog,
} from "../src/lib/restaurantVoiceContext.js";

const MALE_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George
const knex = getKnex();

const r = await knex("restaurants").whereILike("name", "%Pizza Go%").first();
if (!r) {
  console.error("Pizza Go not found");
  await knex.destroy();
  process.exit(1);
}

const catalog = await loadRestaurantVoiceCatalog(knex, r.id);
const currency = catalog.settings?.currency || r.currency || "PKR";
const language = r.agent_language || "ur";
const knowledge = buildRestaurantVoiceKnowledge({
  restaurantName: r.name,
  currency,
  preferUrduPrices: true,
  ...catalog,
});
const prompt = defaultSynthflowPrompt(r.name, knowledge, currency, language, "male");
const greeting = defaultSynthflowGreeting(r.name, language, "male");

await knex("restaurants").where({ id: r.id }).update({
  agent_voice_id: MALE_VOICE,
  agent_first_message: greeting,
  agent_system_prompt: prompt,
  updated_at: knex.fn.now(),
});

console.log("Local DB updated:", {
  id: r.id,
  voice: MALE_VOICE,
  greeting,
  prompt_chars: prompt.length,
  agent: r.synthflow_agent_id,
});

if (r.synthflow_agent_id) {
  try {
    await updateAgent(r.synthflow_agent_id, {
      agent: {
        prompt,
        greeting_message: greeting,
        voice_id: MALE_VOICE,
        voice_gender: "male",
        voice_prompt: getSynthflowVoicePrompt("male"),
        language: toSynthflowLanguage(language),
        voice_speed: 1.08,
      },
    });
    console.log("Synthflow agent updated to male:", r.synthflow_agent_id);
  } catch (e) {
    console.warn("Synthflow update failed (DB still male locally):", e.message || e);
  }
}

await knex.destroy();
