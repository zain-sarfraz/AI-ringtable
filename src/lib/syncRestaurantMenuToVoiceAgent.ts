import { supabase } from "@/integrations/supabase/client";

export type MenuVoiceSyncResult = {
  success: boolean;
  provider: "synthflow" | "elevenlabs" | "none";
  error?: string;
};

/**
 * Push current menu/inventory to the restaurant's voice agent.
 * Prefers Synthflow when configured; otherwise ElevenLabs.
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
    if (error || (data as { success?: boolean })?.success === false) {
      return {
        success: false,
        provider: "synthflow",
        error:
          error?.message ||
          (data as { error?: string })?.error ||
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
    if (error || (data as { success?: boolean })?.success === false) {
      return {
        success: false,
        provider: "elevenlabs",
        error:
          error?.message ||
          (data as { error?: string })?.error ||
          "ElevenLabs sync failed",
      };
    }
    return { success: true, provider: "elevenlabs" };
  }

  // No active voice agent created yet for this restaurant
  return { success: true, provider: "none" };
}
