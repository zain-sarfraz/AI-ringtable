import { getKnex } from "../db.js";
import { updateAgent, postCallWebhookUrl, toSynthflowLanguage } from "../lib/synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowGreeting,
  defaultSynthflowPrompt,
  loadRestaurantVoiceCatalog,
  applyBranchOrdering,
  isMaleVoice,
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
    const currency = catalog.settings?.currency || r.currency || "USD";
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: r.name,
      currency,
      ...catalog,
    });
    const agentLanguage = r.agent_language || "ur";
    const voiceGender = isMaleVoice(r.agent_voice_id) ? "male" : "female";
    const lang = toSynthflowLanguage(agentLanguage);
    const savedGreeting = (r.agent_first_message || "").trim();
    // Refresh auto-generated greetings; keep only a truly custom first message.
    const greeting =
      !savedGreeting ||
      /^Hi, thanks for calling/i.test(savedGreeting) ||
      /^Hi, I am calling from /i.test(savedGreeting) ||
      /^Thanks for calling/i.test(savedGreeting) ||
      /^Hello, main /i.test(savedGreeting) ||
      /^ہیلو،/i.test(savedGreeting)
        ? defaultSynthflowGreeting(r.name, agentLanguage, voiceGender)
        : savedGreeting;
    const prompt = applyBranchOrdering(
      defaultSynthflowPrompt(r.name, knowledge, currency, agentLanguage, voiceGender),
      catalog.branches
    );
    const webhookUrl = postCallWebhookUrl();
    const menuKeywords = [
      r.name,
      ...(catalog.items || []).slice(0, 30).map((i) => i.name),
      "order", "burger", "pizza", "rupay", "chota", "darmiyana", "bara", "delivery", "pickup"
    ].filter(Boolean);

    await updateAgent(r.synthflow_agent_id, {
      name: `${r.name} Order Agent`,
      is_recording: true,
      ...(webhookUrl
        ? { external_webhook_url: webhookUrl, inbound_call_webhook_url: webhookUrl }
        : {}),
      agent: {
        name: `${r.name} Order Agent`,
        prompt,
        greeting_message: greeting,
        language: lang,
        voice_id: r.agent_voice_id || "cgSgspJ2msm6clMCkdW9",
        voice_gender: voiceGender,
        voice_speed: 0.85,
        min_words_to_interrupt: 2,
        interruption_fade_out: 1,
        noise_cancellation: "standard",
        suppression_level: 0.3,
        patience_level: "medium",
        transcriber_keywords: menuKeywords,
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
