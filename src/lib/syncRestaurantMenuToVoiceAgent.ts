import { supabase } from "@/integrations/supabase/client";

export type MenuVoiceSyncResult = {
  success: boolean;
  provider: "synthflow" | "elevenlabs" | "none";
  skipped?: boolean;
  error?: string;
};

type VoiceFnPayload = {
  success?: boolean;
  skipped?: boolean;
  code?: string;
  error?: string;
  warning?: string;
  message?: string;
};

function isVoiceSyncSkipped(data: VoiceFnPayload | null | undefined): boolean {
  return Boolean(
    data?.skipped ||
      data?.code === "VOICE_SYNC_DISABLED" ||
      /voice sync disabled/i.test(String(data?.error || data?.warning || data?.message || "")),
  );
}

/**
 * Push current menu/inventory to the restaurant's voice agent.
 * Prefers Synthflow when configured; otherwise ElevenLabs.
 * In development (voice sync gated), returns success + skipped — menu save still works.
 */
export async function syncRestaurantMenuToVoiceAgent(
  restaurantId: string,
): Promise<MenuVoiceSyncResult> {
  if (!restaurantId) {
    return { success: false, provider: "none", error: "restaurant_id is required" };
  }

  const { data: restaurant, error: fetchErr } = await supabase
    .from("restaurants")
    .select("synthflow_agent_id, voice_provider, elevenlabs_agent_id")
    .eq("id", restaurantId)
    .maybeSingle();

  if (fetchErr) {
    return { success: false, provider: "none", error: fetchErr.message };
  }

  // If the restaurant has a Synthflow agent, sync to Synthflow
  if (restaurant?.synthflow_agent_id) {
    const { data, error } = await supabase.functions.invoke("sync-restaurant-menu-to-synthflow", {
      body: { restaurant_id: restaurantId },
    });
    const payload = data as VoiceFnPayload | null;
    if (isVoiceSyncSkipped(payload)) {
      return {
        success: true,
        skipped: true,
        provider: "synthflow",
        error: payload?.warning || payload?.message || payload?.error,
      };
    }
    if (error || payload?.success === false) {
      return {
        success: false,
        provider: "synthflow",
        error:
          error?.message ||
          payload?.error ||
          "Synthflow sync failed",
      };
    }
    return { success: true, provider: "synthflow" };
  }

  // Only sync to ElevenLabs if the restaurant explicitly uses ElevenLabs as voice provider
  if (restaurant?.voice_provider === "elevenlabs" && restaurant?.elevenlabs_agent_id) {
    const { data, error } = await supabase.functions.invoke("sync-restaurant-menu-to-agent", {
      body: { restaurant_id: restaurantId },
    });
    const payload = data as VoiceFnPayload | null;
    if (isVoiceSyncSkipped(payload)) {
      return {
        success: true,
        skipped: true,
        provider: "elevenlabs",
        error: payload?.warning || payload?.message || payload?.error,
      };
    }
    if (error || payload?.success === false) {
      return {
        success: false,
        provider: "elevenlabs",
        error:
          error?.message ||
          payload?.error ||
          "ElevenLabs sync failed",
      };
    }
    return { success: true, provider: "elevenlabs" };
  }

  // No active voice agent created yet for this restaurant
  return { success: true, provider: "none" };
}
