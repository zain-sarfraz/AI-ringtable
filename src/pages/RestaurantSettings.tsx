import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Store,
  Phone,
  Copy,
  ExternalLink,
  Bot,
  RefreshCw,
  Sparkles,
  Mail,
  MapPin,
  Hash,
  ImageIcon,
  Images,
  Clock,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { getCurrencySymbol } from "@/lib/restaurant";
import { syncRestaurantMenuToVoiceAgent } from "@/lib/syncRestaurantMenuToVoiceAgent";

/** Row from `restaurants` (includes fields set when the tenant was created in super admin). */
interface Restaurant {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  contact_email: string | null;
  address: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  twilio_phone_number: string | null;
  elevenlabs_agent_id: string | null;
  telnyx_phone_number: string | null;
  telnyx_phone_number_id: string | null;
  synthflow_agent_id: string | null;
  voice_provider: string | null;
  synthflow_synced_at: string | null;
  agent_language: string | null;
  agent_voice_id: string | null;
  agent_first_message: string | null;
  agent_system_prompt: string | null;
  agent_knowledge_doc_id: string | null;
  agent_menu_synced_at: string | null;
  allows_delivery?: boolean;
  allows_pickup?: boolean;
}

interface WorkingHour {
  id?: string;
  restaurant_id?: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
  [key: string]: unknown;
}

/** From `check-integration-status` — server `VOICE_ROUTING` + `PUBLIC_API_URL`. */
interface VoiceIntegrationInfo {
  synthflow_available: boolean;
  telnyx_available: boolean;
  elevenlabs_available: boolean;
  elevenlabs_configured: boolean;
  twilio_configured: boolean;
  livekit_configured: boolean;
  deepgram_configured: boolean;
  routing?: string;
  urls?: {
    twilio_inbound_webhook?: string;
    ai_place_order?: string;
    ai_order_status?: string;
    elevenlabs_post_call_webhook?: string;
    synthflow_post_call_webhook?: string;
  };
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const AGENT_LANGUAGES = [
  { code: "en", label: "English (US / UK / Global)" },
  { code: "es", label: "Spanish (Español)" },
  { code: "fr", label: "French (Français)" },
  { code: "de", label: "German (Deutsch)" },
  { code: "it", label: "Italian (Italiano)" },
  { code: "pt", label: "Portuguese (Português)" },
  { code: "nl", label: "Dutch (Nederlands)" },
  { code: "pl", label: "Polish (Polski)" },
  { code: "ru", label: "Russian (Русский)" },
  { code: "ar", label: "Arabic (العربية)" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "ur", label: "Urdu (اردو)" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
  { code: "ja", label: "Japanese (日本語)" },
  { code: "ko", label: "Korean (한국어)" },
  { code: "zh", label: "Chinese (中文)" },
  { code: "tr", label: "Turkish (Türkçe)" },
  { code: "multi", label: "Multilingual (Auto-detect)" },
];
const LANGUAGES = AGENT_LANGUAGES;

function isEmpty(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/** Prefer `restaurant_settings`; fill gaps from `restaurants` (where “Add restaurant” stores phone, email, address, images). */
function mergeDisplaySettings(
  settings: Record<string, unknown>,
  restaurant: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...settings };
  if (isEmpty(out.phone)) out.phone = restaurant.phone ?? "";
  if (isEmpty(out.email)) out.email = restaurant.contact_email ?? "";
  if (isEmpty(out.address)) out.address = restaurant.address ?? "";
  if (isEmpty(out.logo_url)) out.logo_url = restaurant.logo_url ?? "";
  if (isEmpty(out.name)) out.name = restaurant.name ?? "";
  return out;
}

const RESTAURANT_SELECT =
  "id, name, slug, phone, contact_email, address, logo_url, cover_image_url, twilio_phone_number, elevenlabs_agent_id, telnyx_phone_number, telnyx_phone_number_id, synthflow_agent_id, voice_provider, synthflow_synced_at, agent_language, agent_voice_id, agent_first_message, agent_system_prompt, agent_knowledge_doc_id, agent_menu_synced_at, allows_delivery, allows_pickup";

export default function RestaurantSettings() {
  const { t } = useTranslation(["restaurantSettings", "common"]);
  const { toast } = useToast();
  const { restaurantId, loading: activeRestaurantLoading } = useActiveRestaurant();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [r, setR] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [voiceIntegration, setVoiceIntegration] = useState<VoiceIntegrationInfo | null>(null);
  const [attachTwilioBusy, setAttachTwilioBusy] = useState(false);
  const [telnyxSearchBusy, setTelnyxSearchBusy] = useState(false);
  const [telnyxProvisionBusy, setTelnyxProvisionBusy] = useState(false);
  const [synthflowBusy, setSynthflowBusy] = useState(false);
  const [synthflowSyncBusy, setSynthflowSyncBusy] = useState(false);
  const [testCallPhone, setTestCallPhone] = useState("");
  const [testCallBusy, setTestCallBusy] = useState(false);
  const [telnyxCandidates, setTelnyxCandidates] = useState<{ phone_number: string; locality?: string }[]>([]);
  const [telnyxAreaCode, setTelnyxAreaCode] = useState("");
  const [selectedTelnyxNumber, setSelectedTelnyxNumber] = useState("");
  const [manualTelnyxNumber, setManualTelnyxNumber] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [savingFulfillment, setSavingFulfillment] = useState(false);

  /** Soft voice sync after settings changes — never blocks or looks like a failed save. */
  const quietVoiceSync = useCallback(async (rid: string) => {
    const result = await syncRestaurantMenuToVoiceAgent(rid);
    if (!result.success && result.provider !== "none") {
      toast({
        variant: "destructive",
        title: "Settings saved, voice sync failed",
        description: result.error,
      });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("check-integration-status");
      if (cancelled || error || !data) return;
      const v = (data as { voice?: VoiceIntegrationInfo }).voice;
      if (v) setVoiceIntegration(v);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRestaurantData = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    const [settingsRes, restRes, hoursRes] = await Promise.all([
      supabase.from("restaurant_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle(),
      supabase.from("restaurants").select(RESTAURANT_SELECT).eq("id", restaurantId).maybeSingle(),
      supabase.from("restaurant_hours").select("*").eq("restaurant_id", restaurantId).order("open_time", { ascending: true }),
    ]);

    if (settingsRes.error || restRes.error || hoursRes.error) {
      toast({
        variant: "destructive",
        title: "Could not load data",
        description: "Error loading settings or hours",
      });
      setLoading(false);
      return;
    }

    const restaurant = restRes.data as Restaurant | null;
    if (!restaurant?.id) {
      setS(null);
      setR(null);
      setHours([]);
      setLoading(false);
      return;
    }

    setHours((hoursRes.data as WorkingHour[]) || []);

    let settings = settingsRes.data as Record<string, unknown> | null;
    if (!settings) {
      const ins = await supabase
        .from("restaurant_settings")
        .insert({
          restaurant_id: restaurantId,
          name: restaurant.name || "My Restaurant",
          address: restaurant.address ?? null,
          phone: restaurant.phone ?? null,
          email: restaurant.contact_email ?? null,
          logo_url: restaurant.logo_url ?? null,
        })
        .select()
        .maybeSingle();
      if (ins.error) {
        toast({
          variant: "destructive",
          title: "Could not create settings",
          description: (ins.error as { message?: string })?.message ?? String(ins.error),
        });
        setS(null);
        setR(null);
        setLoading(false);
        return;
      }
      settings = ins.data as Record<string, unknown> | null;
    }

    setS(mergeDisplaySettings(settings || {}, (restaurant as any) || {}) as any);
    setR(restaurant);
    setLoading(false);
  }, [restaurantId, toast]);

  const addHourSlot = (day: number) => {
    if (!restaurantId) return;
    const newSlot: WorkingHour = {
      restaurant_id: restaurantId,
      day_of_week: day,
      open_time: "09:00",
      close_time: "22:00",
      is_closed: false,
    };
    setHours([...hours, newSlot]);
  };

  const removeHourSlot = (index: number) => {
    const newHours = [...hours];
    newHours.splice(index, 1);
    setHours(newHours);
  };

  const updateHourSlot = (index: number, updates: Partial<WorkingHour>) => {
    const newHours = [...hours];
    newHours[index] = { ...newHours[index], ...updates };
    setHours(newHours);
  };

  const saveHours = async () => {
    if (!restaurantId) return;
    setSavingHours(true);
    try {
      const invalid = hours.find(
        (h) => !h.is_closed && (!String(h.open_time || "").trim() || !String(h.close_time || "").trim()),
      );
      if (invalid) {
        toast({
          variant: "destructive",
          title: "Unable to update hours",
          description: "Open and close times are required for every open day.",
        });
        return;
      }

      const { error: delError } = await supabase
        .from("restaurant_hours")
        .delete()
        .eq("restaurant_id", restaurantId);
      if (delError) {
        toast({
          variant: "destructive",
          title: "Unable to update hours",
          description: (delError as { message?: string })?.message ?? String(delError),
        });
        return;
      }

      const payload = hours.map(({ day_of_week, open_time, close_time, is_closed }) => ({
        restaurant_id: restaurantId,
        day_of_week,
        open_time: is_closed ? open_time || "00:00" : open_time,
        close_time: is_closed ? close_time || "00:00" : close_time,
        is_closed: Boolean(is_closed),
      }));

      if (payload.length > 0) {
        const { error } = await supabase.from("restaurant_hours").insert(payload);
        if (error) {
          toast({
            variant: "destructive",
            title: "Unable to update hours",
            description: (error as { message?: string })?.message ?? String(error),
          });
          return;
        }
      }

      toast({ title: "Working hours saved" });
      const { data } = await supabase
        .from("restaurant_hours")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("open_time", { ascending: true });
      setHours((data as WorkingHour[]) || []);
      void quietVoiceSync(restaurantId);
    } finally {
      setSavingHours(false);
    }
  };

  useEffect(() => {
    if (activeRestaurantLoading) return;
    if (!restaurantId) {
      setS(null);
      setR(null);
      setLoading(false);
      return;
    }
    void loadRestaurantData();
  }, [restaurantId, activeRestaurantLoading, loadRestaurantData]);

  const saveSettings = async () => {
    if (!s || !r || !restaurantId) return;

    const name = String(s.name ?? "").trim() || r.name;
    const address = String(s.address ?? "").trim() || null;
    const phone = String(s.phone ?? "").trim() || null;
    const contactEmail = String(s.email ?? "").trim() || null;
    const logoUrl = String(s.logo_url ?? "").trim() || null;
    const coverUrl = String(r.cover_image_url ?? "").trim() || null;
    const currency = String(s.currency ?? "USD").trim().toUpperCase() || "USD";
    const taxRate = Math.min(999.99, Math.max(0, Number(s.tax_rate) || 0));
    const deliveryFee = Math.max(0, Number(s.delivery_fee) || 0);
    const minOrder = Math.max(0, Number(s.min_order_amount) || 0);
    const isOpen = Boolean(s.is_open);

    setSavingSettings(true);
    try {
      const settingsUpdate = {
        name,
        address,
        phone,
        email: contactEmail,
        currency,
        tax_rate: taxRate,
        delivery_fee: deliveryFee,
        min_order_amount: minOrder,
        is_open: isOpen,
        logo_url: logoUrl,
      };

      // Prefer restaurant_id (unique) — id-only filters silently no-op when row is missing/out of scope
      const settingsQuery = s.id
        ? supabase.from("restaurant_settings").update(settingsUpdate).eq("id", s.id).eq("restaurant_id", restaurantId)
        : supabase.from("restaurant_settings").update(settingsUpdate).eq("restaurant_id", restaurantId);

      const [settingsRes, restaurantRes] = await Promise.all([
        settingsQuery.select("id"),
        supabase
          .from("restaurants")
          .update({
            name,
            address,
            phone,
            contact_email: contactEmail,
            logo_url: logoUrl,
            cover_image_url: coverUrl,
            is_accepting_orders: isOpen,
          })
          .eq("id", r.id)
          .select("id"),
      ]);

      if (settingsRes.error || restaurantRes.error) {
        toast({
          variant: "destructive",
          title: "Unable to update restaurant settings",
          description:
            (settingsRes.error as { message?: string })?.message ||
            (restaurantRes.error as { message?: string })?.message ||
            "Save failed",
        });
        return;
      }

      const settingsRows = Array.isArray(settingsRes.data) ? settingsRes.data : settingsRes.data ? [settingsRes.data] : [];
      const restaurantRows = Array.isArray(restaurantRes.data) ? restaurantRes.data : restaurantRes.data ? [restaurantRes.data] : [];

      if (!settingsRows.length || !restaurantRows.length) {
        toast({
          variant: "destructive",
          title: "Unable to update restaurant settings",
          description: "No matching restaurant was updated. Check you have access to this restaurant.",
        });
        return;
      }

      toast({ title: "Settings saved" });
      await loadRestaurantData();
      void quietVoiceSync(restaurantId);
    } finally {
      setSavingSettings(false);
    }
  };

  const saveTelephony = async () => {
    if (!r) return;
    const { error } = await supabase
      .from("restaurants")
      .update({
        twilio_phone_number: r.twilio_phone_number?.trim() || null,
        elevenlabs_agent_id: r.elevenlabs_agent_id?.trim() || null,
        agent_language: r.agent_language || "multi",
        agent_voice_id: r.agent_voice_id?.trim() || null,
        agent_first_message: r.agent_first_message?.trim() || null,
        agent_system_prompt: r.agent_system_prompt?.trim() || null,
      })
      .eq("id", r.id);
    if (error) toast({ variant: "destructive", title: "Failed", description: (error as any)?.message });
    else {
      toast({ title: "Telephony settings saved" });
      await loadRestaurantData();
    }
  };

  const attachTwilioInElevenLabs = async () => {
    if (!r?.id) return;
    if (!r.twilio_phone_number?.trim() || !r.elevenlabs_agent_id?.trim()) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Enter and save a Twilio E.164 number and ElevenLabs agent ID before linking in ElevenLabs.",
      });
      return;
    }
    setAttachTwilioBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("attach-twilio-to-agent", {
        body: { restaurant_id: r.id },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; phone_number_id?: string };
      if (!d?.success) throw new Error(d?.error || "Failed to attach");
      toast({
        title: "Twilio linked in ElevenLabs",
        description: d.phone_number_id ? `ElevenLabs phone_number_id: ${d.phone_number_id}` : "Number assigned to your agent.",
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Attach failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAttachTwilioBusy(false);
    }
  };

  const searchTelnyxNumbers = async () => {
    setTelnyxSearchBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-telnyx-search", {
        body: {
          area_code: telnyxAreaCode.trim() || undefined,
          limit: 10,
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; numbers?: { phone_number: string; locality?: string }[] };
      if (!d?.success) throw new Error(d?.error || "Search failed");
      setTelnyxCandidates(d.numbers || []);
      if (!(d.numbers || []).length) {
        toast({ title: "No numbers found", description: "Try another area code or locality." });
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Telnyx search failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTelnyxSearchBusy(false);
    }
  };

  const provisionTelnyxNumber = async (opts?: { skipPurchase?: boolean; phone?: string }) => {
    if (!r?.id) return;
    const phone = (opts?.phone || selectedTelnyxNumber || manualTelnyxNumber).trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      toast({
        variant: "destructive",
        title: "Invalid number",
        description: "Use E.164 format, e.g. +15551234567",
      });
      return;
    }
    setTelnyxProvisionBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-provision-telnyx-number", {
        body: {
          restaurant_id: r.id,
          phone_number: phone,
          skip_purchase: !!opts?.skipPurchase,
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; telnyx_phone_number?: string; warning?: string };
      if (!d?.success) throw new Error(d?.error || "Provision failed");
      toast({
        title: "Telnyx number ready",
        description: d.warning
          ? `${d.telnyx_phone_number} saved. Note: ${d.warning}`
          : `${d.telnyx_phone_number} provisioned and imported to Synthflow.`,
      });
      await loadRestaurantData();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Provision failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTelnyxProvisionBusy(false);
    }
  };

  const createOrUpdateSynthflowAgent = async () => {
    if (!r?.id) return;
    setSynthflowBusy(true);
    try {
      await supabase
        .from("restaurants")
        .update({
          agent_language: r.agent_language || "multi",
          agent_voice_id: r.agent_voice_id?.trim() || null,
          agent_first_message: r.agent_first_message?.trim() || null,
          agent_system_prompt: r.agent_system_prompt?.trim() || null,
        })
        .eq("id", r.id);

      const { data, error } = await supabase.functions.invoke("restaurant-create-synthflow-agent", {
        body: {
          restaurant_id: r.id,
          synthflow_agent_id: r.synthflow_agent_id || undefined,
          language: r.agent_language || "multi",
          voice_id: r.agent_voice_id?.trim() || undefined,
          first_message: r.agent_first_message?.trim() || undefined,
          system_prompt: r.agent_system_prompt?.trim() || undefined,
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; synthflow_agent_id?: string; action?: string };
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({
        title: d.action === "updated" ? "Synthflow agent updated" : "Synthflow agent created",
        description: d.synthflow_agent_id
          ? `Agent ID: ${d.synthflow_agent_id}. Post-call orders will be created automatically.`
          : "Agent configured.",
      });
      await loadRestaurantData();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Synthflow agent error",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSynthflowBusy(false);
    }
  };

  const syncMenuToSynthflow = async () => {
    if (!r?.id) return;
    setSynthflowSyncBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-restaurant-menu-to-synthflow", {
        body: { restaurant_id: r.id },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string };
      if (!d?.success) throw new Error(d?.error || "Sync failed");
      toast({ title: "Menu & coupons synced to Synthflow" });
      await loadRestaurantData();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Synthflow sync failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSynthflowSyncBusy(false);
    }
  };

  const placeTestCall = async () => {
    if (!r?.id) return;
    const phone = testCallPhone.trim();
    if (phone.replace(/\D/g, "").length < 10) {
      toast({
        variant: "destructive",
        title: "Phone number needed",
        description: "Enter the number the agent should call, with country code. Example: +923001234567",
      });
      return;
    }
    setTestCallBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("synthflow-test-call", {
        body: { restaurant_id: r.id, phone, name: "Test call" },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; message?: string; phone?: string };
      if (!d?.success) throw new Error(d?.error || "Test call failed");
      toast({
        title: "Test call started",
        description: d.message || `The agent is calling ${d.phone || phone}. Answer to test the order flow.`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Test call failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestCallBusy(false);
    }
  };

  const createOrUpdateAgent = async () => {
    if (!r) return;
    setAgentBusy(true);
    try {
      await supabase
        .from("restaurants")
        .update({
          agent_language: r.agent_language || "multi",
          agent_voice_id: r.agent_voice_id?.trim() || null,
          agent_first_message: r.agent_first_message?.trim() || null,
          agent_system_prompt: r.agent_system_prompt?.trim() || null,
        })
        .eq("id", r.id);

      const { data, error } = await supabase.functions.invoke("create-restaurant-agent", {
        body: { restaurant_id: r.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      const agentId = (data as { elevenlabs_agent_id?: string | null }).elevenlabs_agent_id ?? r.elevenlabs_agent_id;
      setR({ ...r, elevenlabs_agent_id: agentId ?? null });
      const w = (data as { warning?: string }).warning;
      if (w) {
        toast({
          title: "AI agent",
          description: w,
        });
      } else {
        toast({
          title: data.action === "created" ? "AI agent created" : "AI agent updated",
          description: agentId ? `ElevenLabs agent ID: ${agentId}` : "Configuration updated.",
        });
      }
      await loadRestaurantData();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Agent error", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setAgentBusy(false);
    }
  };

  const syncMenu = async () => {
    if (!r) return;
    setSyncBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-restaurant-menu-to-agent", {
        body: { restaurant_id: r.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      setR({ ...r, agent_menu_synced_at: new Date().toISOString(), agent_knowledge_doc_id: data.doc_id });
      toast({
        title: "Menu synced to agent",
        description: `${data.doc_chars} characters uploaded to ElevenLabs knowledge base`,
      });
      await loadRestaurantData();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Sync error", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncBusy(false);
    }
  };

  const apiBase = getApiBase();
  const integUrls = voiceIntegration?.urls;
  const inboundWebhookUrl = integUrls?.twilio_inbound_webhook ?? `${apiBase}/api/functions/twilio-inbound-webhook`;
  const placeOrderToolUrl = integUrls?.ai_place_order ?? `${apiBase}/api/functions/ai-place-order`;
  const orderStatusToolUrl = integUrls?.ai_order_status ?? `${apiBase}/api/functions/ai-order-status`;
  const postCallWebhookUrl =
    integUrls?.elevenlabs_post_call_webhook ?? `${apiBase}/api/functions/elevenlabs-conversation-webhook`;
  const synthflowWebhookUrl =
    integUrls?.synthflow_post_call_webhook ?? `${apiBase}/api/functions/synthflow-post-call-webhook`;
  const voiceRouting = voiceIntegration?.routing ?? "twilio_webhook";
  const isSynthflowMode = voiceRouting === "synthflow_telnyx" || r?.voice_provider === "synthflow_telnyx";

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  if (activeRestaurantLoading || loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-6 pb-16">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!restaurantId || !s || !r) {
    return (
      <p className="text-muted-foreground p-6 max-w-4xl mx-auto">
        No restaurant is linked to your account. Ask a super admin to add you as the restaurant owner.
      </p>
    );
  }

  const logoPreview = resolveMediaUrl(String(s.logo_url ?? "")) ?? undefined;
  const coverPreview = resolveMediaUrl(String(r.cover_image_url ?? "")) ?? undefined;

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 pb-16">
      <header className="space-y-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("restaurantSettings:title", "Restaurant settings")}</h1>
              <p className="text-muted-foreground text-sm">
                {t("restaurantSettings:subtitle", "Public-facing details, pricing, and phone AI — kept in sync with your live restaurant record.")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Hash className="h-4 w-4 shrink-0" />
            <span className="font-mono text-xs sm:text-sm">{r.slug}</span>
          </div>
        </div>
      </header>

      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="text-lg">{t("restaurantSettings:general", "General")}</CardTitle>
          <CardDescription>
            {t("restaurantSettings:generalDesc", "Name, location, and contact info. Values you entered when the restaurant was created appear here automatically (we merge them from your main restaurant record if a field was left empty in storefront settings).")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rs-name">{t("restaurantSettings:restaurantName", "Restaurant name")}</Label>
              <Input
                id="rs-name"
                value={String(s.name ?? "")}
                onChange={(e) => setS({ ...s, name: e.target.value })}
                className="max-w-xl"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rs-address" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {t("restaurantSettings:address", "Address")}
              </Label>
              <Textarea
                id="rs-address"
                rows={3}
                value={String(s.address ?? "")}
                onChange={(e) => setS({ ...s, address: e.target.value })}
                placeholder={t("restaurantSettings:addressPlaceholder", "Street, city, postal code…")}
                className="resize-y min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                {t("restaurantSettings:phone", "Phone")}
              </Label>
              <Input
                id="rs-phone"
                value={String(s.phone ?? "")}
                onChange={(e) => setS({ ...s, phone: e.target.value })}
                placeholder="+1…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {t("restaurantSettings:contactEmail", "Contact email")}
              </Label>
              <Input
                id="rs-email"
                type="email"
                value={String(s.email ?? "")}
                onChange={(e) => setS({ ...s, email: e.target.value })}
                placeholder="hello@restaurant.com"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              {t("restaurantSettings:branding", "Branding")}
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rs-logo">{t("restaurantSettings:logoUrl", "Logo URL")}</Label>
                <Input
                  id="rs-logo"
                  value={String(s.logo_url ?? "")}
                  onChange={(e) => setS({ ...s, logo_url: e.target.value })}
                  placeholder={t("restaurantSettings:logoUrlPlaceholder", "https://… or path from upload")}
                  className="font-mono text-xs sm:text-sm"
                />
                {logoPreview ? (
                  <div className="mt-2 overflow-hidden rounded-lg border bg-muted/30 p-2 w-fit">
                    <img src={logoPreview} alt={t("restaurantSettings:logoPreview", "Logo preview")} className="h-20 w-20 rounded-md object-cover" />
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-cover" className="flex items-center gap-1.5">
                  <Images className="h-3.5 w-3.5" />
                  {t("restaurantSettings:coverImageUrl", "Cover image URL")}
                </Label>
                <Input
                  id="rs-cover"
                  value={String(r.cover_image_url ?? "")}
                  onChange={(e) => setR({ ...r, cover_image_url: e.target.value })}
                  placeholder={t("restaurantSettings:coverImagePlaceholder", "Banner image URL")}
                  className="font-mono text-xs sm:text-sm"
                />
                {coverPreview ? (
                  <div className="mt-2 overflow-hidden rounded-lg border bg-muted/30 p-2 max-w-xs">
                    <img src={coverPreview} alt={t("restaurantSettings:coverPreview", "Cover preview")} className="h-20 w-full max-w-xs rounded-md object-cover" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-3">
              <Switch id="rs-open" checked={Boolean(s.is_open)} onCheckedChange={(v) => setS({ ...s, is_open: v })} />
              <div>
                <Label htmlFor="rs-open" className="text-base font-medium cursor-pointer">
                  {t("restaurantSettings:acceptingOrders", "Accepting orders")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("restaurantSettings:acceptingOrdersDesc", "When off, customers may see you as closed.")}</p>
              </div>
            </div>
            <Button onClick={() => void saveSettings()} disabled={savingSettings} className="shrink-0 sm:w-auto w-full">
              {savingSettings ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("restaurantSettings:saveGeneral", "Save general")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="text-lg">{t("restaurantSettings:pricing", "Pricing")}</CardTitle>
          <CardDescription>{t("restaurantSettings:pricingDesc", "Currency, tax, delivery fee, and minimum order for quotes and checkout.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rs-currency">{t("restaurantSettings:currencyIso", "Currency (ISO)")}</Label>
              <Input
                id="rs-currency"
                value={String(s.currency || "USD")}
                onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })}
                maxLength={8}
                placeholder="USD"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-tax">{t("restaurantSettings:taxRate", "Tax rate (%)")}</Label>
              <div className="relative">
                <Input
                  id="rs-tax"
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number(s.tax_rate) || 0}
                  onChange={(e) => setS({ ...s, tax_rate: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                  placeholder="0.00"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground select-none">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-delivery-fee">
                {t("restaurantSettings:deliveryFee", "Delivery fee")} ({getCurrencySymbol(String(s.currency || "USD"))})
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground select-none">
                  {getCurrencySymbol(String(s.currency || "USD"))}
                </span>
                <Input
                  id="rs-delivery-fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number(s.delivery_fee) || 0}
                  onChange={(e) => setS({ ...s, delivery_fee: parseFloat(e.target.value) || 0 })}
                  className="pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-min-order">
                {t("restaurantSettings:minimumOrder", "Minimum order amount")} ({getCurrencySymbol(String(s.currency || "USD"))})
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground select-none">
                  {getCurrencySymbol(String(s.currency || "USD"))}
                </span>
                <Input
                  id="rs-min-order"
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number(s.min_order_amount) || 0}
                  onChange={(e) => setS({ ...s, min_order_amount: parseFloat(e.target.value) || 0 })}
                  className="pl-8"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("restaurantSettings:minimumOrderDesc", "Orders below this amount cannot be placed by customers.")}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => void saveSettings()} disabled={savingSettings}>
            {savingSettings ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            {t("restaurantSettings:savePricing", "Save pricing")}
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="text-lg">{t("restaurantSettings:fulfillmentOptions", "Fulfillment Options")}</CardTitle>
          <CardDescription>{t("restaurantSettings:fulfillmentDesc", "Choose how you want to serve your customers.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-4 p-4 rounded-lg border bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">{t("restaurantSettings:allowsDelivery", "Allows Delivery")}</Label>
                  <p className="text-xs text-muted-foreground">{t("restaurantSettings:allowsDeliveryDesc", "Customers can request delivery to their address.")}</p>
                </div>
                <Switch 
                  checked={r.allows_delivery} 
                  onCheckedChange={(v) => setR({ ...r, allows_delivery: v })} 
                />
              </div>
            </div>
            <div className="flex flex-col gap-4 p-4 rounded-lg border bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">{t("restaurantSettings:allowsPickup", "Allows Self Pickup")}</Label>
                  <p className="text-xs text-muted-foreground">{t("restaurantSettings:allowsPickupDesc", "Customers can come and collect their order.")}</p>
                </div>
                <Switch 
                  checked={r.allows_pickup} 
                  onCheckedChange={(v) => setR({ ...r, allows_pickup: v })} 
                />
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={savingFulfillment}
            onClick={async () => {
              setSavingFulfillment(true);
              try {
                const { data, error } = await supabase
                  .from("restaurants")
                  .update({
                    allows_delivery: r.allows_delivery,
                    allows_pickup: r.allows_pickup,
                  })
                  .eq("id", r.id)
                  .select("id");
                if (error) {
                  toast({
                    variant: "destructive",
                    title: "Unable to update fulfillment",
                    description: (error as { message?: string })?.message,
                  });
                  return;
                }
                const rows = Array.isArray(data) ? data : data ? [data] : [];
                if (!rows.length) {
                  toast({
                    variant: "destructive",
                    title: "Unable to update fulfillment",
                    description: "No matching restaurant was updated.",
                  });
                  return;
                }
                toast({ title: t("restaurantSettings:fulfillmentSaved", "Fulfillment options saved") });
                if (restaurantId) void quietVoiceSync(restaurantId);
              } finally {
                setSavingFulfillment(false);
              }
            }}
          >
            {savingFulfillment ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            {t("restaurantSettings:saveFulfillment", "Save fulfillment")}
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" /> {t("restaurantSettings:operatingHours", "Operating Hours")}
            </CardTitle>
            <CardDescription>{t("restaurantSettings:operatingHoursDesc", "Set when your restaurant is open for orders.")}</CardDescription>
          </div>
          <Button onClick={() => void saveHours()} disabled={savingHours || loading} size="sm">
            {savingHours ? <RefreshCw className="h-4 w-4 animate-spin" /> : t("restaurantSettings:saveHours", "Save Hours")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {DAY_KEYS.map((dayKey, dayIdx) => {
            const daySlots = hours.filter(h => h.day_of_week === dayIdx);
            return (
              <div key={dayIdx} className="space-y-3 pb-4 border-b last:border-0">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-bold">{t(`restaurantSettings:days.${dayKey}`, DAYS[dayIdx])}</Label>
                  <Button variant="outline" size="sm" onClick={() => addHourSlot(dayIdx)} className="h-8">
                    <Plus className="h-4 w-4 mr-1" /> {t("restaurantSettings:addSlot", "Add Slot")}
                  </Button>
                </div>
                
                {daySlots.length === 0 ? (
                  <div className="p-3 rounded-lg border border-dashed text-center bg-muted/5">
                    <p className="text-xs text-muted-foreground italic">{t("restaurantSettings:closedAllDay", "Closed all day")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {hours.map((h, globalIdx) => {
                      if (h.day_of_week !== dayIdx) return null;
                      return (
                        <div key={globalIdx} className="flex items-center gap-3 bg-muted/20 p-2 rounded-lg border">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase font-bold opacity-50 block ml-1">{t("restaurantSettings:openTimeLabel", "Open")}</span>
                              <Input 
                                type="time" 
                                value={h.open_time} 
                                onChange={(e) => updateHourSlot(globalIdx, { open_time: e.target.value })}
                                className="h-9 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase font-bold opacity-50 block ml-1">{t("restaurantSettings:closeTimeLabel", "Close")}</span>
                              <Input 
                                type="time" 
                                value={h.close_time} 
                                onChange={(e) => updateHourSlot(globalIdx, { close_time: e.target.value })}
                                className="h-9 text-xs"
                              />
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 text-destructive hover:bg-destructive/10"
                            onClick={() => removeHourSlot(globalIdx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border shadow-sm border-primary/20">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" />
            {t("restaurantSettings:telnyxTitle", "Telnyx + Synthflow (recommended)")}
          </CardTitle>
          <CardDescription className="space-y-2">
            <span className="block">
              {t("restaurantSettings:telnyxDesc", "Dedicated Telnyx number per restaurant. Synthflow AI answers calls, explains menu and coupons, takes the order, then posts results to our webhook so the order is created automatically.")}
            </span>
            <span className="block text-muted-foreground">
              {t("restaurantSettings:serverMode", "Server mode:")}{" "}
              <span className="font-mono text-foreground">{voiceRouting}</span>
              {isSynthflowMode ? t("restaurantSettings:usesSynthflow", " — this restaurant uses Synthflow.") : null}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-lg border bg-muted/15 px-4 py-3 text-xs text-muted-foreground space-y-1">
            <div>
              {t("restaurantSettings:telnyxNumber", "Telnyx number:")}{" "}
              <span className="font-mono text-foreground">{r.telnyx_phone_number || t("restaurantSettings:notAssigned", "not assigned")}</span>
            </div>
            <div>
              {t("restaurantSettings:synthflowAgent", "Synthflow agent:")}{" "}
              <span className="font-mono text-foreground">{r.synthflow_agent_id || t("restaurantSettings:notCreated", "not created")}</span>
            </div>
            {r.synthflow_synced_at ? (
              <div>{t("restaurantSettings:lastSynced", "Last synced:")} {new Date(r.synthflow_synced_at).toLocaleString()}</div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("restaurantSettings:step1Title", "1. Search & assign a Telnyx number")}</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">{t("restaurantSettings:areaCode", "Area code (optional)")}</Label>
                <Input
                  value={telnyxAreaCode}
                  onChange={(e) => setTelnyxAreaCode(e.target.value)}
                  placeholder="415"
                  className="w-28"
                />
              </div>
              <Button type="button" variant="secondary" disabled={telnyxSearchBusy} onClick={() => void searchTelnyxNumbers()}>
                {telnyxSearchBusy ? t("restaurantSettings:searching", "Searching…") : t("restaurantSettings:searchTelnyx", "Search Telnyx")}
              </Button>
            </div>

            {telnyxCandidates.length > 0 ? (
              <div className="space-y-2">
                <Label>{t("restaurantSettings:availableNumbers", "Available numbers")}</Label>
                <Select value={selectedTelnyxNumber} onValueChange={setSelectedTelnyxNumber}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("restaurantSettings:selectNumberPlaceholder", "Select a number to purchase")} />
                  </SelectTrigger>
                  <SelectContent>
                    {telnyxCandidates.map((n) => (
                      <SelectItem key={n.phone_number} value={n.phone_number}>
                        {n.phone_number}
                        {n.locality ? ` — ${n.locality}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={telnyxProvisionBusy || !selectedTelnyxNumber}
                  onClick={() => void provisionTelnyxNumber({ phone: selectedTelnyxNumber })}
                >
                  {telnyxProvisionBusy ? t("restaurantSettings:provisioning", "Provisioning…") : t("restaurantSettings:purchaseAssign", "Purchase & assign number")}
                </Button>
              </div>
            ) : null}

            <div className="space-y-2 pt-2 border-t">
              <Label>{t("restaurantSettings:attachExistingTelnyx", "Or attach an existing Telnyx number (E.164)")}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={manualTelnyxNumber}
                  onChange={(e) => setManualTelnyxNumber(e.target.value)}
                  placeholder="+15551234567"
                  className="max-w-xs font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={telnyxProvisionBusy}
                  onClick={() => void provisionTelnyxNumber({ skipPurchase: true, phone: manualTelnyxNumber })}
                >
                  {t("restaurantSettings:assignExisting", "Assign existing")}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("restaurantSettings:step2Title", "2. Create / update Synthflow AI agent")}</p>
            <p className="text-xs text-muted-foreground">
              {t("restaurantSettings:step2Desc", "Uses greeting and system prompt from the AI agent section below (menu + active coupons are injected automatically).")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={synthflowBusy || !r.telnyx_phone_number} onClick={() => void createOrUpdateSynthflowAgent()}>
                <Sparkles className="h-4 w-4 mr-2" />
                {r.synthflow_agent_id
                  ? synthflowBusy
                    ? t("restaurantSettings:updating", "Updating…")
                    : t("restaurantSettings:updateSynthflowAgent", "Update Synthflow agent")
                  : synthflowBusy
                    ? t("restaurantSettings:creating", "Creating…")
                    : t("restaurantSettings:createSynthflowAgent", "Create Synthflow agent")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={synthflowSyncBusy || !r.synthflow_agent_id}
                onClick={() => void syncMenuToSynthflow()}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${synthflowSyncBusy ? "animate-spin" : ""}`} />
                {synthflowSyncBusy ? t("restaurantSettings:syncing", "Syncing…") : t("restaurantSettings:syncMenuCoupons", "Sync menu & coupons")}
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/15 p-4">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("restaurantSettings:postCallWebhook", "Post-call webhook (configured on the agent automatically)")}
            </Label>
            <div className="flex gap-2">
              <Input value={synthflowWebhookUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => copy(synthflowWebhookUrl)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("restaurantSettings:postCallWebhookDesc", "Requires PUBLIC_API_URL to be a public HTTPS URL Synthflow can reach. After each call, order details are extracted and the order is created here.")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Legacy Twilio UI — hidden while Synthflow/Telnyx is primary */}
      {false && (
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" />
            Telephony (legacy Twilio)
          </CardTitle>
          <CardDescription className="space-y-2">
            <span className="block">
              Voice mode from API:{" "}
              <span className="font-mono text-foreground">
                {voiceRouting}
              </span>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label>Twilio phone number (E.164)</Label>
            <Input
              value={r.twilio_phone_number || ""}
              onChange={(e) => setR({ ...r, twilio_phone_number: e.target.value })}
              placeholder="+15551234567"
            />
          </div>

          <div className="space-y-2">
            <Label>ElevenLabs agent ID (optional)</Label>
            <Input
              value={r.elevenlabs_agent_id || ""}
              onChange={(e) => setR({ ...r, elevenlabs_agent_id: e.target.value })}
              placeholder="agent_…"
            />
          </div>

          <Button onClick={saveTelephony}>Save telephony</Button>
        </CardContent>
      </Card>
      )}

      {/* AI Voice Agent Configuration (Prompt, Language, Greeting) */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5" />
            {t("restaurantSettings:aiAgentTitle", "AI agent (Synthflow)")}
          </CardTitle>
          <CardDescription>
            {t("restaurantSettings:aiAgentDesc", "Configure language, voice greeting, and custom system prompt for your AI phone agent.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("restaurantSettings:language", "Agent Language")}</Label>
              <Select value={r.agent_language || "multi"} onValueChange={(v) => setR({ ...r, agent_language: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("restaurantSettings:voiceId", "Voice ID (optional)")}</Label>
              <Input
                value={r.agent_voice_id || ""}
                onChange={(e) => setR({ ...r, agent_voice_id: e.target.value })}
                placeholder="EXAVITQu4vr4xnSDxMaL"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("restaurantSettings:firstMessage", "First message / Greeting (optional)")}</Label>
            <Input
              value={r.agent_first_message || ""}
              onChange={(e) => setR({ ...r, agent_first_message: e.target.value })}
              placeholder={`Hi, thanks for calling ${r.name}!`}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("restaurantSettings:systemPrompt", "System prompt (optional)")}</Label>
            <Textarea
              rows={5}
              value={r.agent_system_prompt || ""}
              onChange={(e) => setR({ ...r, agent_system_prompt: e.target.value })}
              placeholder="You are the friendly AI phone assistant…"
              className="resize-y min-h-[120px]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={synthflowBusy || !r.telnyx_phone_number}
              onClick={() => void createOrUpdateSynthflowAgent()}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {synthflowBusy ? t("restaurantSettings:updating", "Updating…") : t("restaurantSettings:updateSynthflowAgent", "Update Synthflow Agent")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={synthflowSyncBusy || !r.synthflow_agent_id}
              onClick={() => void syncMenuToSynthflow()}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${synthflowSyncBusy ? "animate-spin" : ""}`} />
              {synthflowSyncBusy ? t("restaurantSettings:syncing", "Syncing…") : t("restaurantSettings:syncMenuCoupons", "Sync Menu & Coupons")}
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("restaurantSettings:testCallTitle", "Test call")}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                "restaurantSettings:testCallDesc",
                "The Synthflow agent calls this number so you can try the menu, branch question, and order flow.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={testCallPhone}
                onChange={(e) => setTestCallPhone(e.target.value)}
                placeholder="+923001234567"
                className="max-w-xs font-mono"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={testCallBusy || !r.synthflow_agent_id}
                onClick={() => void placeTestCall()}
              >
                <Phone className="h-4 w-4 mr-2" />
                {testCallBusy
                  ? t("restaurantSettings:testCallBusy", "Calling…")
                  : t("restaurantSettings:testCallButton", "Place test call")}
              </Button>
            </div>
          </div>

          {r.synthflow_agent_id ? (
            <div className="rounded-lg border bg-muted/15 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <div>
                Synthflow Agent ID: <span className="font-mono text-foreground">{r.synthflow_agent_id}</span>
              </div>
              {r.synthflow_synced_at ? (
                <div>Last synced: {new Date(r.synthflow_synced_at).toLocaleString()}</div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
