/**
 * Push PUBLIC_API_URL post-call webhook onto every restaurant Synthflow agent.
 *
 *   APP_ENV=production node scripts/sync-synthflow-webhooks.js
 *
 * Outside production, the script refuses unless you pass --confirm-production
 * and type CONFIRM (still subject to assertVoiceSyncAllowed).
 *
 * Prefer `npm run sync:synthflow-ringtable` when migrating off AI Restaurant —
 * that also rewrites place_order / order-status tool URLs and any stale assistants.
 */
import "../src/loadEnv.js";
import { getKnex } from "../src/db.js";
import { updateAgent, postCallWebhookUrl } from "../src/lib/synthflowClient.js";
import { assertBulkVoiceScriptAllowed } from "../src/lib/voiceSyncGuard.js";

async function main() {
  await assertBulkVoiceScriptAllowed(process.argv);

  const webhookUrl = postCallWebhookUrl();
  if (!webhookUrl) {
    console.error("PUBLIC_API_URL is missing. Set it in backend/.env first.");
    process.exit(1);
  }

  console.log("Webhook URL:", webhookUrl);

  const knex = getKnex();
  const restaurants = await knex("restaurants")
    .select("id", "name", "synthflow_agent_id")
    .whereNotNull("synthflow_agent_id")
    .where("synthflow_agent_id", "!=", "");

  if (!restaurants.length) {
    console.log("No restaurants with synthflow_agent_id found.");
    await knex.destroy();
    return;
  }

  console.log(`Updating ${restaurants.length} agent(s)…`);
  let ok = 0;
  let fail = 0;

  for (const r of restaurants) {
    try {
      await updateAgent(r.synthflow_agent_id, {
        is_recording: true,
        external_webhook_url: webhookUrl,
        inbound_call_webhook_url: webhookUrl,
      });
      await knex("restaurants").where({ id: r.id }).update({
        synthflow_synced_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
      ok += 1;
      console.log(`✓ ${r.name} (${r.synthflow_agent_id})`);
    } catch (e) {
      fail += 1;
      console.error(`✗ ${r.name} (${r.synthflow_agent_id}):`, e.message || e);
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  await knex.destroy();
  if (fail) process.exit(1);
}

main().catch(async (e) => {
  console.error(e.message || e);
  process.exit(1);
});
