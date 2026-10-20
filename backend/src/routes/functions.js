import { Router } from "express";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { aiPlaceOrder } from "../fns/aiPlaceOrder.js";
import { aiOrderStatus } from "../fns/aiOrderStatus.js";
import { aiReserveTable } from "../fns/aiReserveTable.js";
import { createRestaurantAgent } from "../fns/createRestaurantAgent.js";
import { attachTwilioToAgent } from "../fns/attachTwilioToAgent.js";
import { createRestaurantUser } from "../fns/createRestaurantUser.js";
import { restaurantElevenlabsList } from "../fns/restaurantElevenlabsList.js";
import { restaurantTwilioList } from "../fns/restaurantTwilioList.js";
import { restaurantCreateAgent } from "../fns/restaurantCreateAgent.js";
import { restaurantAttachTwilio } from "../fns/restaurantAttachTwilio.js";
import { sendOrderNotification } from "../fns/sendOrderNotification.js";
import { syncRestaurantMenuToAgent } from "../fns/syncRestaurantMenuToAgent.js";
import { elevenlabsConversationWebhook } from "../fns/elevenlabsConversationWebhook.js";
import { elevenlabsSyncAgents } from "../fns/elevenlabsSyncAgents.js";
import { checkIntegrationStatus } from "../fns/checkIntegrationStatus.js";
import {
  restaurantTelnyxSearch,
  restaurantTelnyxList,
  restaurantProvisionTelnyxNumber,
  restaurantUnassignTelnyxNumber,
} from "../fns/restaurantProvisionTelnyxNumber.js";
import { restaurantCreateSynthflowAgent } from "../fns/restaurantCreateSynthflowAgent.js";
import { syncRestaurantMenuToSynthflow } from "../fns/syncRestaurantMenuToSynthflow.js";
import { synthflowPostCallWebhook } from "../fns/synthflowPostCallWebhook.js";
import { synthflowSyncCalls } from "../fns/synthflowSyncCalls.js";
import { synthflowTestCall } from "../fns/synthflowTestCall.js";
import { aiCheckPreviousOrder } from "../fns/aiCheckPreviousOrder.js";

const router = Router();

/** Edge functions that do not require a logged-in user (webhooks / EL tools). */
const PUBLIC_HANDLERS = {
  "ai-place-order": aiPlaceOrder,
  "ai-order-status": aiOrderStatus,
  "ai-reserve-table": aiReserveTable,
  "elevenlabs-conversation-webhook": elevenlabsConversationWebhook,
  "synthflow-post-call-webhook": synthflowPostCallWebhook,
  "synthflow-sync-calls": synthflowSyncCalls,
  "synthflow-sync-call": synthflowSyncCalls,
  "ai-check-previous-order": aiCheckPreviousOrder,
};

const AUTH_HANDLERS = {
  "create-restaurant-agent": createRestaurantAgent,
  "attach-twilio-to-agent": attachTwilioToAgent,
  "create-restaurant-user": createRestaurantUser,
  "restaurant-elevenlabs-list": restaurantElevenlabsList,
  "restaurant-twilio-list": restaurantTwilioList,
  "restaurant-create-agent": restaurantCreateAgent,
  "restaurant-attach-twilio": restaurantAttachTwilio,
  "send-order-notification": sendOrderNotification,
  "sync-restaurant-menu-to-agent": syncRestaurantMenuToAgent,
  "elevenlabs-sync-agents": elevenlabsSyncAgents,
  "init-restaurant-agent": createRestaurantAgent,
  "check-integration-status": checkIntegrationStatus,
  "restaurant-telnyx-search": restaurantTelnyxSearch,
  "restaurant-telnyx-list": restaurantTelnyxList,
  "restaurant-provision-telnyx-number": restaurantProvisionTelnyxNumber,
  "restaurant-unassign-telnyx-number": restaurantUnassignTelnyxNumber,
  "restaurant-create-synthflow-agent": restaurantCreateSynthflowAgent,
  "sync-restaurant-menu-to-synthflow": syncRestaurantMenuToSynthflow,
  "synthflow-test-call": synthflowTestCall,
};

router.post("/:name", optionalAuth, async (req, res) => {
  const name = req.params.name;
  if (PUBLIC_HANDLERS[name]) {
    return PUBLIC_HANDLERS[name](req, res);
  }
  if (AUTH_HANDLERS[name]) {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return AUTH_HANDLERS[name](req, res);
  }
  return res.status(501).json({
    error: `Function "${name}" is not implemented in the standalone Node backend yet. Port it from supabase/functions or call the legacy host.`,
    notImplemented: true,
    function: name,
  });
});

export default router;
