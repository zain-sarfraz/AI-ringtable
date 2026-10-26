import { getKnex } from "../db.js";
import { updateAgent, postCallWebhookUrl, toSynthflowLanguage } from "../lib/synthflowClient.js";
import {
  buildRestaurantVoiceKnowledge,
  defaultSynthflowGreeting,
  defaultSynthflowPrompt,
  loadRestaurantVoiceCatalog,
  isMaleVoice,
} from "../lib/restaurantVoiceContext.js";
import { PromptMergeError, resolveSynthflowPromptUpdate } from "../lib/promptMerge.js";
import { refreshSynthflowPlaceOrderTool } from "./restaurantCreateSynthflowAgent.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";

/**
 * Refresh Synthflow agent prompt with current menu + coupons/promotions.
 */
export async function syncRestaurantMenuToSynthflow(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
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

    // Refuse to point a live ringtable.io agent at a local tunnel (causes phone-order loops).
    const publicApi = String(process.env.PUBLIC_API_URL || "").trim();
    if (/trycloudflare|ngrok|loca\.lt|localhost|127\.0\.0\.1/i.test(publicApi)) {
      const { getAssistant } = await import("../lib/synthflowClient.js");
      try {
        const found = await getAssistant(r.synthflow_agent_id);
        const wh = String(
          found?.assistant?.external_webhook_url ||
            found?.assistant?.inbound_call_webhook_url ||
            "",
        );
        if (/ringtable\.io/i.test(wh)) {
          return res.status(200).json({
            success: false,
            error:
              "This Synthflow agent is linked to live ringtable.io. Local tunnel sync is blocked — it breaks place_order (phone keeps asking for number). Update from Pizza Go on ringtable.io only.",
            code: "REFUSE_OVERWRITE_LIVE_AGENT",
          });
        }
      } catch {
        /* if lookup fails, continue — create path still guarded elsewhere */
      }
    }

    const catalog = await loadRestaurantVoiceCatalog(knex, restaurant_id);
    const currency = catalog.settings?.currency || r.currency || "USD";
    const agentLanguage = r.agent_language || "ur";
    const preferUrduPrices =
      !agentLanguage || String(agentLanguage).toLowerCase().startsWith("ur") || currency === "PKR";
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: r.name,
      currency,
      preferUrduPrices,
      ...catalog,
    });
    const voiceGender = isMaleVoice(r.agent_voice_id) ? "male" : "female";
    const lang = toSynthflowLanguage(agentLanguage);
    const savedGreeting = (r.agent_first_message || "").trim();
    // Refresh auto-generated / English greetings; keep only a truly custom first message.
    const greeting =
      !savedGreeting ||
      /^Hi[, ]/i.test(savedGreeting) ||
      /^Hello[, ]/i.test(savedGreeting) ||
      /^Thanks for calling/i.test(savedGreeting) ||
      /^Assalam-o-Alaikum/i.test(savedGreeting) ||
      /^Assalamualaikum/i.test(savedGreeting) ||
      /^ہیلو،/i.test(savedGreeting)
        ? defaultSynthflowGreeting(r.name, agentLanguage, voiceGender)
        : savedGreeting;
    let prompt;
    try {
      // Keep saved conversation rules and branches; refresh menu data only.
      prompt = resolveSynthflowPromptUpdate({
        incoming: null,
        saved: r.agent_system_prompt,
        replaceFull: false,
        refreshKnowledge: true,
        refreshBranches: false,
        knowledge,
        branches: catalog.branches,
        language: agentLanguage,
        defaultPromptBuilder: () =>
          defaultSynthflowPrompt(r.name, knowledge, currency, agentLanguage, voiceGender),
      });
    } catch (mergeErr) {
      if (mergeErr instanceof PromptMergeError) {
        console.warn("Menu sync prompt merge blocked:", mergeErr.code, mergeErr.message);
        return res.status(200).json({
          success: false,
          code: mergeErr.code,
          error: mergeErr.message,
        });
      }
      throw mergeErr;
    }
    const webhookUrl = postCallWebhookUrl();
    const menuKeywords = [
      r.name,
      ...(catalog.items || []).slice(0, 30).map((i) => i.name),
      "order", "burger", "pizza", "rupees", "rupee", "small", "medium", "large",
      "delivery", "pickup", "confirm", "shukriya",
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
        // Pizza Go / Urdu live voice (Sarah). Never fall back to Jessica — that mismatch is what Sir hears.
        voice_id: r.agent_voice_id || "EXAVITQu4vr4xnSDxMaL",
        voice_gender: voiceGender,
        voice_speed: 1.08,
        min_words_to_interrupt: 2,
        interruption_fade_out: 1,
        noise_cancellation: "standard",
        suppression_level: 0.3,
        patience_level: "low",
        transcriber_keywords: menuKeywords,
        send_user_idle_reminders: false,
      },
    });

    // Prevent multi-brand poisoning: unlink this synthflow_agent_id from any previous restaurant
    if (r.synthflow_agent_id) {
      await knex("restaurants")
        .where({ synthflow_agent_id: r.synthflow_agent_id })
        .whereNot({ id: restaurant_id })
        .update({ synthflow_agent_id: null });
    }

    await knex("restaurants").where({ id: restaurant_id }).update({
      agent_system_prompt: prompt,
      agent_first_message: greeting,
      agent_language: agentLanguage,
      synthflow_synced_at: knex.fn.now(),
      agent_menu_synced_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    let toolWarning = null;
    const publicApiNorm = publicApi.replace(/\/$/, "");
    try {
      const actionIds = await refreshSynthflowPlaceOrderTool(r);
      if (actionIds) {
        await knex("restaurants").where({ id: restaurant_id }).update({
          synthflow_action_ids: knex.raw("?::jsonb", [JSON.stringify(actionIds || [])]),
          updated_at: knex.fn.now(),
        });
      }
    } catch (toolErr) {
      toolWarning = toolErr.message;
      console.warn("Tool refresh error during menu sync:", toolErr.message);
    }

    const ordersLandLocal =
      String(process.env.APP_ENV || "").toLowerCase() === "development" &&
      publicApiNorm &&
      !/ringtable\.io/i.test(publicApiNorm);

    return res.json({
      success: true,
      synthflow_agent_id: r.synthflow_agent_id,
      synced_at: new Date().toISOString(),
      public_api_url: publicApiNorm || null,
      place_order_url: publicApiNorm ? `${publicApiNorm}/api/functions/ai-place-order` : null,
      post_call_webhook_url: webhookUrl || null,
      orders_land_on: ordersLandLocal ? "local" : "remote",
      warning: toolWarning,
      message: ordersLandLocal
        ? "Menu synced. Test-call orders will be saved to your LOCAL database — open http://localhost:8080 Orders (not ringtable.io)."
        : "Menu synced.",
    });
  } catch (e) {
    console.error("Sync Synthflow menu error:", e);
    return res.status(500).json({ success: false, error: e.message || "sync failed" });
  }
}
