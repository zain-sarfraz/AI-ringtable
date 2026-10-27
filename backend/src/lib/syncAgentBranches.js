import { updateAgent } from "./synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowPrompt,
  loadRestaurantVoiceCatalog,
  isMaleVoice,
  PAKISTANI_NAME_KEYWORDS,
} from "./restaurantVoiceContext.js";
import { PromptMergeError, resolveSynthflowPromptUpdate } from "./promptMerge.js";
import { refreshSynthflowPlaceOrderTool } from "../fns/restaurantCreateSynthflowAgent.js";

/**
 * Put the current branch list into the phone agent's prompt.
 * Runs after a branch is added, renamed, or turned off.
 * Preserves saved conversation rules; refreshes branch / menu / place_order sections only.
 */
export async function pushBranchListToAgent(knex, parentRestaurantId) {
  if (!parentRestaurantId) return;
  const restaurant = await knex("restaurants").where({ id: parentRestaurantId }).first();
  if (!restaurant?.synthflow_agent_id) return;

  const catalog = await loadRestaurantVoiceCatalog(knex, parentRestaurantId);
  const currency = catalog.settings?.currency || restaurant.currency || "USD";
  const agentLanguage = restaurant.agent_language || "ur";
  const preferUrduPrices =
    !agentLanguage || String(agentLanguage).toLowerCase().startsWith("ur") || currency === "PKR";
  const knowledge = buildRestaurantVoiceKnowledge({
    restaurantName: restaurant.name,
    currency,
    preferUrduPrices,
    ...catalog,
  });
  const voiceGender = isMaleVoice(restaurant.agent_voice_id) ? "male" : "female";

  let prompt;
  try {
    prompt = resolveSynthflowPromptUpdate({
      incoming: null,
      saved: restaurant.agent_system_prompt,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge,
      branches: catalog.branches,
      language: agentLanguage,
      defaultPromptBuilder: () =>
        defaultSynthflowPrompt(
          restaurant.name,
          knowledge,
          currency,
          agentLanguage,
          voiceGender,
        ),
    });
  } catch (mergeErr) {
    if (mergeErr instanceof PromptMergeError) {
      console.warn(
        "Branch sync prompt merge blocked:",
        parentRestaurantId,
        mergeErr.code,
        mergeErr.message,
      );
      return;
    }
    throw mergeErr;
  }

  const menuKeywords = [
    restaurant.name,
    ...(catalog.items || []).slice(0, 30).map((i) => i.name),
    "order", "burger", "pizza", "rupees", "rupee", "small", "medium", "large",
    "delivery", "pickup", "confirm", "raabta", "rabta", "shukriya",
    "ORD", "track", "tracking", "status", "soorat-e-haal", "order number",
    ...(Array.isArray(PAKISTANI_NAME_KEYWORDS) ? PAKISTANI_NAME_KEYWORDS : []),
  ].filter(Boolean);

  await updateAgent(restaurant.synthflow_agent_id, {
    agent: {
      prompt,
      transcriber_keywords: menuKeywords,
    },
  });

  const patch = {
    agent_system_prompt: prompt,
    synthflow_synced_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  };

  try {
    const actionIds = await refreshSynthflowPlaceOrderTool(restaurant);
    if (actionIds) {
      patch.synthflow_action_ids = knex.raw("?::jsonb", [JSON.stringify(actionIds)]);
    }
  } catch (e) {
    console.warn("Place-order tool refresh failed:", e.message);
  }

  await knex("restaurants").where({ id: parentRestaurantId }).update(patch);
}
