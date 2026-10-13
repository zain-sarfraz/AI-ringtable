import { updateAgent } from "./synthflowClient.js";
import {
  applyBranchOrdering,
  buildRestaurantVoiceKnowledge,
  defaultSynthflowPrompt,
  loadRestaurantVoiceCatalog,
} from "./restaurantVoiceContext.js";
import { refreshSynthflowPlaceOrderTool } from "../fns/restaurantCreateSynthflowAgent.js";

/**
 * Put the current branch list into the phone agent's prompt.
 * Runs after a branch is added, renamed, or turned off.
 */
export async function pushBranchListToAgent(knex, parentRestaurantId) {
  if (!parentRestaurantId) return;
  const restaurant = await knex("restaurants").where({ id: parentRestaurantId }).first();
  if (!restaurant?.synthflow_agent_id) return;

  const catalog = await loadRestaurantVoiceCatalog(knex, parentRestaurantId);
  const knowledge = buildRestaurantVoiceKnowledge({
    restaurantName: restaurant.name,
    ...catalog,
  });
  const saved = String(restaurant.agent_system_prompt || "").trim();
  // Our generated templates must rebuild from code so language/branch fixes ship on sync.
  const looksLikeOurTemplate =
    /PRIMARY MISSION|CRITICAL RULES|LANGUAGE MATCHING|## Branch ordering/i.test(saved);
  const base =
    saved && !looksLikeOurTemplate
      ? saved
      : defaultSynthflowPrompt(restaurant.name, knowledge);
  const prompt = applyBranchOrdering(
    base.includes("## Menu") || base.includes("# ") ? base : `${base}\n\n${knowledge}`,
    catalog.branches,
  );

  await updateAgent(restaurant.synthflow_agent_id, {
    agent: { prompt },
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
