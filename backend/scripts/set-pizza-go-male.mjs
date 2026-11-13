/**
 * Switch Pizza Go to male grammar (sakta / Ahmed) but KEEP existing voice_id (wdXhc…).
 * From backend/: node scripts/set-pizza-go-male.mjs
 */
import "dotenv/config";
import { getKnex } from "../src/db.js";
import { updateAgent, toSynthflowLanguage, getAssistant } from "../src/lib/synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowGreeting,
  defaultSynthflowPrompt,
  getSynthflowVoicePrompt,
  loadRestaurantVoiceCatalog,
} from "../src/lib/restaurantVoiceContext.js";

const KEEP_VOICE = "wdXhcCmAYpPsryFWCtn2";
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
const voiceId = r.agent_voice_id || KEEP_VOICE;

await knex("restaurants").where({ id: r.id }).update({
  agent_voice_id: voiceId,
  agent_first_message: greeting,
  agent_system_prompt: prompt,
  updated_at: knex.fn.now(),
});

console.log("Local DB updated:", {
  id: r.id,
  voice: voiceId,
  greeting,
  prompt_chars: prompt.length,
  agent: r.synthflow_agent_id,
});

if (r.synthflow_agent_id) {
  await updateAgent(r.synthflow_agent_id, {
    agent: {
      prompt,
      greeting_message: greeting,
      voice_id: voiceId,
      voice_gender: "male",
      voice_prompt: getSynthflowVoicePrompt("male"),
      language: toSynthflowLanguage(language),
      voice_speed: 1.08,
    },
    greeting_message: greeting,
    voice_id: voiceId,
    voice_gender: "male",
  });
  const after = await getAssistant(r.synthflow_agent_id);
  const a = (after?.assistant || after)?.agent || {};
  console.log("Synthflow AFTER:", {
    greeting: a.greeting_message,
    voice_id: a.voice_id,
    voice_gender: a.voice_gender,
    prompt_has_sakta: /sakta hoon/i.test(a.prompt || ""),
    prompt_has_sakti: /sakti hoon/i.test(a.prompt || ""),
  });
}

await knex.destroy();
