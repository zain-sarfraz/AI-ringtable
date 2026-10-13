/**
 * Re-point every restaurant Synthflow agent (webhook + live tool URLs) from the
 * old AI Restaurant backend to Ringtable's PUBLIC_API_URL, and refresh prompts
 * so the restaurant name in the agent matches the DB.
 *
 *   node scripts/sync-synthflow-to-ringtable.js
 *   node scripts/sync-synthflow-to-ringtable.js --also-stale-assistants
 */
import "dotenv/config";
import { getKnex } from "../src/db.js";
import {
  updateAgent,
  postCallWebhookUrl,
  listAssistants,
  synthflowRequest,
  updateCustomAction,
} from "../src/lib/synthflowClient.js";
import { refreshSynthflowPlaceOrderTool } from "../src/fns/restaurantCreateSynthflowAgent.js";
import { pushBranchListToAgent } from "../src/lib/syncAgentBranches.js";

const OLD_HOST_RE = /airestaurantbackend\.toolkitpro\.cloud|airestaurant\.toolkitpro\.cloud/i;
const alsoStale = process.argv.includes("--also-stale-assistants");

function liveToolUrl(endpoint) {
  const api = String(process.env.PUBLIC_API_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!api) return null;
  return `${api}/api/functions/${endpoint}`;
}

function extractUrls(obj) {
  const raw = JSON.stringify(obj || {});
  return [...new Set(raw.match(/https?:\/\/[^"\\\s]+/g) || [])];
}

/** Synthflow GET /actions/:id returns response.actions[0].parameters_hard_coded */
function actionPayloadFromGet(json) {
  const row = json?.response?.actions?.[0] || json?.actions?.[0] || null;
  if (!row) return null;
  const hard = row.parameters_hard_coded || {};
  return {
    http_mode: hard.http_mode || "POST",
    url: hard.url || "",
    run_action_before_call_start: hard.run_action_before_call_start ?? false,
    name: hard.name || row.name || "action",
    description: hard.description || row.name || "",
    speech_while_using_the_tool: hard.speech_while_using_the_tool || "",
    failure_timeout: hard.failure_timeout || 20,
    headers: hard.headers || [{ key: "Content-Type", value: "application/json" }],
    variables_during_the_call: hard.variables_during_the_call || [],
    json_body_stringified: hard.json_body_stringified || "{}",
  };
}

async function patchActionUrlIfStale(actionId, desiredUrl) {
  if (!actionId || !desiredUrl) return { skipped: true };
  let json;
  try {
    json = await synthflowRequest(`/actions/${encodeURIComponent(actionId)}`);
  } catch (e) {
    return { error: e.message };
  }
  const urls = extractUrls(json);
  const stale = urls.some((u) => OLD_HOST_RE.test(u));
  const alreadyOk = urls.some((u) => u.includes(desiredUrl) || u === desiredUrl);
  if (!stale && alreadyOk) return { ok: true, unchanged: true, urls };

  const ca = actionPayloadFromGet(json);
  if (!ca) return { error: "no action payload", urls };

  await updateCustomAction(actionId, { ...ca, url: desiredUrl });
  return { ok: true, updated: true, from: urls, to: desiredUrl };
}

async function main() {
  const webhookUrl = postCallWebhookUrl();
  const apiBase = String(process.env.PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  if (!webhookUrl || !apiBase) {
    console.error("PUBLIC_API_URL is missing. Set it in backend/.env first (https://ringtable.io/backend).");
    process.exit(1);
  }
  if (OLD_HOST_RE.test(apiBase)) {
    console.error(`PUBLIC_API_URL still points at AI Restaurant (${apiBase}). Change it to https://ringtable.io/backend`);
    process.exit(1);
  }

  console.log("Target webhook:", webhookUrl);
  console.log("Target API base:", apiBase);

  const knex = getKnex();
  const restaurants = await knex("restaurants")
    .select(
      "id",
      "name",
      "synthflow_agent_id",
      "synthflow_action_ids",
      "telnyx_phone_number",
      "twilio_phone_number",
      "agent_system_prompt",
    )
    .whereNotNull("synthflow_agent_id")
    .where("synthflow_agent_id", "!=", "");

  console.log(`DB restaurants with agents: ${restaurants.length}`);

  let ok = 0;
  let fail = 0;

  const toolMap = {
    "tool:place_order:v2": liveToolUrl("ai-place-order"),
    "tool:place_order": liveToolUrl("ai-place-order"),
    "tool:get_order_status:v2": liveToolUrl("ai-order-status"),
    "tool:get_order_status": liveToolUrl("ai-order-status"),
    "tool:reserve_table:v2": liveToolUrl("ai-reserve-table"),
    "tool:check_previous_order:v2": liveToolUrl("ai-check-previous-order"),
  };

  for (const r of restaurants) {
    try {
      await updateAgent(r.synthflow_agent_id, {
        is_recording: true,
        name: `${r.name} Order Agent`,
        external_webhook_url: webhookUrl,
      });

      // Rebuild prompt with current restaurant name + branch list
      await pushBranchListToAgent(knex, r.id);

      const liveIds = await refreshSynthflowPlaceOrderTool(r);
      const actionIds = liveIds || (Array.isArray(r.synthflow_action_ids) ? r.synthflow_action_ids : []);
      if (liveIds) {
        await knex("restaurants").where({ id: r.id }).update({
          synthflow_action_ids: knex.raw("?::jsonb", [JSON.stringify(liveIds)]),
          synthflow_synced_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }

      for (let i = 0; i < actionIds.length; i++) {
        const marker = String(actionIds[i] || "");
        if (!toolMap[marker]) continue;
        const actionId = i > 0 ? String(actionIds[i - 1] || "") : "";
        if (!actionId || actionId.startsWith("tool:")) continue;
        const patched = await patchActionUrlIfStale(actionId, toolMap[marker]);
        if (patched.updated) console.log(`  patched ${marker} -> ${toolMap[marker]}`);
        else if (patched.error) console.warn(`  patch warn ${marker}: ${patched.error}`);
      }

      ok += 1;
      console.log(`OK ${r.name} (${r.synthflow_agent_id})`);
    } catch (e) {
      fail += 1;
      console.error(`FAIL ${r.name} (${r.synthflow_agent_id}):`, e.message || e);
    }
  }

  if (alsoStale) {
    console.log("Scanning Synthflow workspace for assistants still on AI Restaurant webhook…");
    const assistants = await listAssistants({ limit: 100 });
    const stale = (assistants || []).filter((a) =>
      OLD_HOST_RE.test(String(a.external_webhook_url || "")),
    );
    for (const a of stale) {
      try {
        await updateAgent(a.model_id || a.id, {
          is_recording: true,
          external_webhook_url: webhookUrl,
        });
        console.log(`OK stale assistant ${a.name} (${a.model_id || a.id})`);
        ok += 1;
      } catch (e) {
        fail += 1;
        console.error(`FAIL stale ${a.name}:`, e.message || e);
      }
    }
    if (!stale.length) console.log("No stale airestaurant webhooks left in workspace list.");
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  await knex.destroy();
  if (fail) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
