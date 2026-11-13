import "dotenv/config";
import { getAssistant, updateAgent } from "../src/lib/synthflowClient.js";
import { getKnex } from "../src/db.js";
import { defaultSynthflowGreeting, getSynthflowVoicePrompt, isMaleVoice } from "../src/lib/restaurantVoiceContext.js";

const MALE_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const knex = getKnex();
const r = await knex("restaurants").whereILike("name", "%Pizza Go%").first();
const modelId = r?.synthflow_agent_id;
if (!modelId) {
  console.error("No synthflow agent");
  process.exit(1);
}

const greeting = defaultSynthflowGreeting(r.name, r.agent_language || "ur", "male");
console.log("Target greeting:", greeting);

const before = await getAssistant(modelId);
const asst = before?.assistant || before?.raw?.response || before?.raw || before;
const flat = asst?.assistants?.[0] || asst;
console.log(
  "BEFORE greeting:",
  flat?.greeting_message || flat?.agent?.greeting_message || flat?.greeting,
  "voice:",
  flat?.voice_id || flat?.agent?.voice_id,
);

// Synthflow updateAgent flattens agent.* — send BOTH nested and ensure greeting sticks.
await updateAgent(modelId, {
  agent: {
    greeting_message: greeting,
    voice_id: MALE_VOICE,
    voice_gender: "male",
    voice_prompt: getSynthflowVoicePrompt("male"),
  },
  greeting_message: greeting,
});

const after = await getAssistant(modelId);
const asst2 = after?.assistant || after?.raw?.response || after?.raw || after;
const flat2 = asst2?.assistants?.[0] || asst2;
const g =
  flat2?.greeting_message ||
  flat2?.agent?.greeting_message ||
  flat2?.greeting ||
  JSON.stringify(flat2)?.slice(0, 500);
console.log("AFTER raw keys sample:", Object.keys(flat2 || {}).slice(0, 25));
console.log("AFTER greeting field:", g);

await knex("restaurants").where({ id: r.id }).update({
  agent_first_message: greeting,
  agent_voice_id: MALE_VOICE,
  updated_at: knex.fn.now(),
});
console.log("Local DB greeting saved.");
console.log("isMaleVoice?", isMaleVoice(MALE_VOICE));

await knex.destroy();
