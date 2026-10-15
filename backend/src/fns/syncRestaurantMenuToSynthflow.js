import { getKnex } from "../db.js";
import { updateAgent, postCallWebhookUrl, toSynthflowLanguage } from "../lib/synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowGreeting,
  defaultSynthflowPrompt,
  loadRestaurantVoiceCatalog,
  applyBranchOrdering,
} from "../lib/restaurantVoiceContext.js";
import { refreshSynthflowPlaceOrderTool } from "./restaurantCreateSynthflowAgent.js";

/**
 * Refresh Synthflow agent prompt with current menu + coupons/promotions.
 */
export async function syncRestaurantMenuToSynthflow(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    const body = req.body || {};
    const restaurant_id = body.restaurant_id || body.body?.restaurant_id;
    if (!restaurant_id) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) throw new Error("Restaurant not found");
    if (!r.synthflow_agent_id) {
      throw new Error("Create a Synthflow agent for this restaurant first");
    }

    const catalog = await loadRestaurantVoiceCatalog(knex, restaurant_id);
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: r.name,
      ...catalog,
    });
    // Prefer multilingual auto-detect so STT/TTS follow the caller's language after the English greeting.
    const agentLanguage = r.agent_language && r.agent_language !== "en" ? r.agent_language : "multi";
    const lang = toSynthflowLanguage(agentLanguage);
    const savedGreeting = (r.agent_first_message || "").trim();
    // Refresh auto-generated greetings; keep only a truly custom first message.
    const greeting =
      !savedGreeting ||
      /^Hi, thanks for calling/i.test(savedGreeting) ||
      /^Hi, I am calling from /i.test(savedGreeting)
        ? defaultSynthflowGreeting(r.name)
        : savedGreeting;
    const prompt = applyBranchOrdering(defaultSynthflowPrompt(r.name, knowledge), catalog.branches);
    const webhookUrl = postCallWebhookUrl();

    await updateAgent(r.synthflow_agent_id, {
      // Do not re-send phone_number — number is already attached; re-sending can fail.
      is_recording: true,
      ...(webhookUrl ? { external_webhook_url: webhookUrl } : {}),
      agent: {
        prompt,
        greeting_message: greeting,
        language: lang,
        voice_speed: 0.85,
        min_words_to_interrupt: 1,
        interruption_fade_out: 1,
        send_user_idle_reminders: false,
      },
    });

    await knex("restaurants").where({ id: restaurant_id }).update({
      agent_system_prompt: prompt,
      agent_first_message: greeting,
      agent_language: agentLanguage,
      synthflow_synced_at: knex.fn.now(),
      agent_menu_synced_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    try {
      await refreshSynthflowPlaceOrderTool(r);
    } catch (toolErr) {
      console.warn("Tool refresh error during menu sync:", toolErr.message);
    }

    return res.json({
      success: true,
      synthflow_agent_id: r.synthflow_agent_id,
      synced_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Sync Synthflow menu error:", e);
    return res.status(500).json({ success: false, error: e.message || "sync failed" });
  }
}
