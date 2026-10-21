import { getKnex } from "../db.js";
import { startOutboundCall } from "../lib/synthflowClient.js";
import { normalizeE164 } from "../lib/voiceWebhookUtils.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

function canPlaceTestCall(user, restaurantId) {
  if (!user?.id) return false;
  if (user.roles?.includes("super_admin")) return true;
  const onRestaurant = (user.memberships || []).some(
    (m) =>
      m.restaurant_id === restaurantId &&
      ["owner", "admin", "manager"].includes(m.member_role),
  );
  if (onRestaurant) return true;
  return Boolean(user.ownedParentIds?.length && user.restaurantIds?.includes(restaurantId));
}

export async function synthflowTestCall(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const restaurantId = req.body?.restaurant_id;
    const phone = normalizeE164(req.body?.phone);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      return res.status(400).json({
        success: false,
        error: "Enter a phone number with country code, for example +923001234567.",
      });
    }
    if (!canPlaceTestCall(req.user, restaurantId)) {
      return res.status(403).json({ success: false, error: "You cannot place a test call for this restaurant." });
    }

    const restaurant = await knex("restaurants").where({ id: restaurantId }).first();
    if (!restaurant) return res.status(404).json({ success: false, error: "Restaurant not found" });
    if (!restaurant.synthflow_agent_id) {
      return res.status(400).json({ success: false, error: "Create the Synthflow agent first, then place a test call." });
    }

    const result = await startOutboundCall({
      modelId: restaurant.synthflow_agent_id,
      phone,
      name: String(req.body?.name || "Test call").slice(0, 80),
    });

    return res.json({
      success: true,
      call_id: result.call_id,
      phone,
      message: `The agent is calling ${phone}. Answer the phone to test the order flow.`,
    });
  } catch (e) {
    console.error("Synthflow test call error:", e);
    return res.status(500).json({ success: false, error: e.message || "Test call failed" });
  }
}
