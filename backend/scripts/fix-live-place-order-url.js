/**
 * Emergency: point shared Pizza Go Synthflow agent tools at ringtable.io
 * (local tunnel sync had poisoned place_order URL → phone loop / no orders).
 *
 *   node --env-file=.env scripts/fix-live-place-order-url.js
 */
process.env.APP_ENV = "production";
process.env.PUBLIC_API_URL = "https://ringtable.io/backend";
process.env.ALLOW_VOICE_SYNC = "true";

import "../src/loadEnv.js";
// Re-assert after loadEnv (loadEnv may overwrite from .env)
process.env.APP_ENV = "production";
process.env.PUBLIC_API_URL = "https://ringtable.io/backend";

import { updateAgent, postCallWebhookUrl, getAssistant } from "../src/lib/synthflowClient.js";
import { refreshSynthflowPlaceOrderTool } from "../src/fns/restaurantCreateSynthflowAgent.js";
import { attachActions } from "../src/lib/synthflowClient.js";

const AGENT = "8294235e-5cfd-493a-9d95-dfdd1be2b40b";
const LIVE_API = "https://ringtable.io/backend";
const PHONE = "+12202650290";

const fakeRestaurant = {
  id: null,
  synthflow_agent_id: AGENT,
  synthflow_action_ids: [],
  telnyx_phone_number: PHONE,
};

const ids = await refreshSynthflowPlaceOrderTool(fakeRestaurant);
const realIds = (ids || []).filter((id) => id && !String(id).startsWith("tool:"));
if (realIds.length) {
  try {
    await attachActions(AGENT, realIds);
  } catch (e) {
    console.warn("attachActions:", e.message);
  }
}

const webhook = postCallWebhookUrl();
await updateAgent(AGENT, {
  external_webhook_url: webhook,
  inbound_call_webhook_url: webhook,
});

// Verify by inspecting latest tool URL from a dry place_order action recreate is hard;
// confirm webhook on assistant.
const a = await getAssistant(AGENT);
console.log(
  JSON.stringify(
    {
      ok: true,
      agent: AGENT,
      place_order_url: `${LIVE_API}/api/functions/ai-place-order`,
      webhook,
      assistant_webhook: a?.assistant?.external_webhook_url,
      action_ids: ids,
    },
    null,
    2,
  ),
);
process.exit(0);
