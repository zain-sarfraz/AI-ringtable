import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Bot, Check, Link2, Loader2, Mic, Phone, Plus, RefreshCw, Sparkles, X, Clock, Trash2 } from "lucide-react";
import { AIChatTest } from "@/components/agents/AIChatTest";
import { getApiBase } from "@/lib/apiBase";

interface Restaurant {
  id: string;
  name: string;
  twilio_phone_number: string | null;
  elevenlabs_agent_id: string | null;
  elevenlabs_api_key: string | null;
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  elevenlabs_connected_at: string | null;
  twilio_connected_at: string | null;
  telnyx_phone_number: string | null;
  telnyx_phone_number_id: string | null;
  synthflow_agent_id: string | null;
  voice_provider: string | null;
  synthflow_synced_at: string | null;
  agent_language: string | null;
  agent_voice_id: string | null;
  agent_first_message: string | null;
  agent_system_prompt: string | null;
  allows_delivery: boolean;
  allows_pickup: boolean;
}

interface ELAgent { agent_id: string; name: string }
interface ELPhone { phone_number_id: string; phone_number: string; label?: string; assigned_agent?: string | null }
interface TwilioNumber { sid: string; phone_number: string; friendly_name?: string }
interface WorkingHour { id?: string; restaurant_id: string; day_of_week: number; open_time: string; close_time: string; is_closed: boolean }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const LANGUAGES = [
  { code: "en", label: "English" }, { code: "es", label: "Spanish" },
  { code: "fr", label: "French" }, { code: "de", label: "German" },
  { code: "it", label: "Italian" }, { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" }, { code: "hi", label: "Hindi" },
  { code: "multi", label: "Multilingual (Auto-detect)" },
];

export default function RestaurantConfiguration() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { toast } = useToast();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);

  // EL connect form
  const [elKey, setElKey] = useState("");
  const [savingEL, setSavingEL] = useState(false);

  // Twilio connect form
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [savingTwilio, setSavingTwilio] = useState(false);

  // Fetched lists
  const [elAgents, setElAgents] = useState<ELAgent[]>([]);
  const [elPhones, setElPhones] = useState<ELPhone[]>([]);
  const [twilioNumbers, setTwilioNumbers] = useState<TwilioNumber[]>([]);
  const [loadingEL, setLoadingEL] = useState(false);
  const [loadingTw, setLoadingTw] = useState(false);

  // Agent selection / creation
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "", language: "en", voice_id: "", first_message: "", system_prompt: "",
  });

  // Twilio number assignment
  const [selectedTwilio, setSelectedTwilio] = useState("");
  const [attaching, setAttaching] = useState(false);

  // Telnyx + Synthflow
  const [telnyxAreaCode, setTelnyxAreaCode] = useState("");
  const [telnyxCandidates, setTelnyxCandidates] = useState<{ phone_number: string; locality?: string }[]>([]);
  const [selectedTelnyxNumber, setSelectedTelnyxNumber] = useState("");
  const [manualTelnyxNumber, setManualTelnyxNumber] = useState("");
  const [telnyxSearchBusy, setTelnyxSearchBusy] = useState(false);
  const [telnyxProvisionBusy, setTelnyxProvisionBusy] = useState(false);
  const [unassigningNumberBusy, setUnassigningNumberBusy] = useState(false);
  const [synthflowBusy, setSynthflowBusy] = useState(false);
  const [synthflowSyncBusy, setSynthflowSyncBusy] = useState(false);

  // Hours
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [savingHours, setSavingHours] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase.from("restaurants").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      toast({ variant: "destructive", title: "Could not load restaurant", description: error?.message });
      setLoading(false);
      return;
    }
    setRestaurant(data as any);
    setSelectedAgentId((data as any).elevenlabs_agent_id ?? "");
    setSelectedTwilio((data as any).twilio_phone_number ?? "");
    setNewAgent((p) => ({
      ...p,
      name: `${(data as any).name} (Order Taker)`,
      language: (data as any).agent_language ?? "en",
    }));
    
    const hRes = await supabase.from("restaurant_hours").select("*").eq("restaurant_id", id).order("open_time", { ascending: true });
    setHours(hRes.data as WorkingHour[] || []);
    
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const fetchEL = useCallback(async () => {
    if (!restaurant?.id) return;
    setLoadingEL(true);
    const { data, error } = await supabase.functions.invoke("restaurant-elevenlabs-list", {
      body: { restaurant_id: restaurant.id },
    });
    setLoadingEL(false);
    if (error || (data as any)?.success === false) {
      toast({ variant: "destructive", title: "ElevenLabs fetch failed", description: error?.message ?? (data as any)?.error });
      return;
    }
    setElAgents((data as any).agents ?? []);
    setElPhones((data as any).phone_numbers ?? []);
  }, [restaurant?.elevenlabs_api_key, restaurant?.id, toast]);

  const fetchTwilio = useCallback(async () => {
    if (!restaurant?.twilio_account_sid) return;
    setLoadingTw(true);
    const { data, error } = await supabase.functions.invoke("restaurant-twilio-list", {
      body: { restaurant_id: restaurant.id },
    });
    setLoadingTw(false);
    if (error || (data as any)?.success === false) {
      toast({ variant: "destructive", title: "Twilio fetch failed", description: error?.message ?? (data as any)?.error });
      return;
    }
    setTwilioNumbers((data as any).numbers ?? []);
  }, [restaurant?.twilio_account_sid, restaurant?.id, toast]);

  // Note: listing agents/phones can use server env ELEVENLABS_API_KEY (global),
  // so we don't hard-require restaurant.elevenlabs_api_key here.
  // Legacy ElevenLabs/Twilio UI is hidden — skip list fetches for now.
  // useEffect(() => { if (restaurant?.id) fetchEL(); }, [restaurant?.id, fetchEL]);
  // useEffect(() => { if (restaurant?.twilio_account_sid) fetchTwilio(); }, [restaurant?.twilio_account_sid, fetchTwilio]);

  if (role !== "super_admin") {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold">Super admin only</h1>
      </div>
    );
  }
  if (loading || !restaurant) {
    return <div className="p-8 text-muted-foreground text-sm">Loading…</div>;
  }

  const elConnected = !!restaurant.elevenlabs_api_key;
  const twilioConnected = !!(restaurant.twilio_account_sid && restaurant.twilio_auth_token);

  const saveAgentIdOnly = async () => {
    if (!selectedAgentId.trim()) return toast({ variant: "destructive", title: "Agent ID required" });
    const { error } = await supabase
      .from("restaurants")
      .update({ elevenlabs_agent_id: selectedAgentId.trim() })
      .eq("id", restaurant.id);
    if (error) return toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    toast({ title: "Agent ID saved" });
    load();
  };

  const saveEL = async () => {
    if (!elKey.trim()) return toast({ variant: "destructive", title: "API key required" });
    setSavingEL(true);
    const { error } = await supabase.from("restaurants").update({
      elevenlabs_api_key: elKey.trim(),
      elevenlabs_connected_at: new Date().toISOString(),
    }).eq("id", restaurant.id);
    setSavingEL(false);
    if (error) return toast({ variant: "destructive", title: "Save failed", description: (error as any).message });
    setElKey("");
    toast({ title: "ElevenLabs connected" });
    load();
  };

  const disconnectEL = async () => {
    if (!confirm("Disconnect ElevenLabs? Agent and number bindings will remain on the restaurant row but lookups will stop working.")) return;
    await supabase.from("restaurants").update({
      elevenlabs_api_key: null,
      elevenlabs_connected_at: null,
    }).eq("id", restaurant.id);
    setElAgents([]); setElPhones([]);
    load();
  };

  const saveTwilio = async () => {
    if (!twilioSid.trim() || !twilioToken.trim()) {
      return toast({ variant: "destructive", title: "Account SID and Auth Token required" });
    }
    setSavingTwilio(true);
    const { error } = await supabase.from("restaurants").update({
      twilio_account_sid: twilioSid.trim(),
      twilio_auth_token: twilioToken.trim(),
      twilio_connected_at: new Date().toISOString(),
    }).eq("id", restaurant.id);
    setSavingTwilio(false);
    if (error) return toast({ variant: "destructive", title: "Save failed", description: (error as any).message });
    setTwilioSid(""); setTwilioToken("");
    toast({ title: "Twilio connected" });
    load();
  };

  const disconnectTwilio = async () => {
    if (!confirm("Disconnect Twilio?")) return;
    await supabase.from("restaurants").update({
      twilio_account_sid: null,
      twilio_auth_token: null,
      twilio_connected_at: null,
    }).eq("id", restaurant.id);
    setTwilioNumbers([]);
    load();
  };

  const useExistingAgent = async () => {
    if (!selectedAgentId) return;
    const { error } = await supabase.from("restaurants").update({
      elevenlabs_agent_id: selectedAgentId,
    }).eq("id", restaurant.id);
    if (error) return toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    toast({ title: "Agent assigned to restaurant" });
    load();
  };

  const createNewAgent = async () => {
    setCreatingAgent(true);
    const { data, error } = await supabase.functions.invoke("restaurant-create-agent", {
      body: { restaurant_id: restaurant.id, ...newAgent },
    });
    setCreatingAgent(false);
    if (error || (data as any)?.success === false) {
      return toast({ variant: "destructive", title: "Agent creation failed", description: error?.message ?? (data as any)?.error });
    }
    toast({ title: "Agent created", description: (data as any).name });
    setShowCreate(false);
    await load();
    fetchEL();
  };

  const attachTwilioNumber = async () => {
    if (!selectedTwilio) return toast({ variant: "destructive", title: "Pick a Twilio number" });
    if (!restaurant.elevenlabs_agent_id) {
      return toast({ variant: "destructive", title: "Create or select an agent first" });
    }
    setAttaching(true);
    const { data, error } = await supabase.functions.invoke("restaurant-attach-twilio", {
      body: { restaurant_id: restaurant.id, twilio_phone_number: selectedTwilio },
    });
    setAttaching(false);
    if (error || (data as any)?.success === false) {
      return toast({ variant: "destructive", title: "Attach failed", description: error?.message ?? (data as any)?.error });
    }
    toast({ title: "Number attached to agent" });
    load();
    fetchEL();
  };

  const addHourSlot = (day: number) => {
    if (!id) return;
    const newSlot: WorkingHour = {
      restaurant_id: id,
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
    if (!id) return;
    setSavingHours(true);
    await supabase.from("restaurant_hours").delete().eq("restaurant_id", id);
    const { error } = await supabase.from("restaurant_hours").insert(hours as any);
    setSavingHours(false);
    if (error) toast({ variant: "destructive", title: "Failed to save hours", description: (error as any).message });
    else toast({ title: "Working hours saved" });
  };

  const StatusBadge = ({ ok }: { ok: boolean }) => (
    <Badge variant={ok ? "default" : "secondary"} className="gap-1">
      {ok ? <><Check className="h-3 w-3" />Connected</> : <><X className="h-3 w-3" />Not connected</>}
    </Badge>
  );

  const synthflowWebhookUrl = `${getApiBase()}/api/functions/synthflow-post-call-webhook`;
  const telnyxReady = !!restaurant.telnyx_phone_number;
  const synthflowReady = !!restaurant.synthflow_agent_id;

  const searchTelnyxNumbers = async () => {
    setTelnyxSearchBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-telnyx-search", {
        body: { area_code: telnyxAreaCode.trim() || undefined, limit: 10 },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; numbers?: { phone_number: string; locality?: string }[] };
      if (!d?.success) throw new Error(d?.error || "Search failed");
      setTelnyxCandidates(d.numbers || []);
      if (!(d.numbers || []).length) {
        toast({ title: "No numbers found", description: "Try another area code." });
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
    const phone = (opts?.phone || selectedTelnyxNumber || manualTelnyxNumber).trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      return toast({
        variant: "destructive",
        title: "Invalid number",
        description: "Use E.164 format, e.g. +15551234567",
      });
    }
    setTelnyxProvisionBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-provision-telnyx-number", {
        body: {
          restaurant_id: restaurant.id,
          phone_number: phone,
          skip_purchase: !!opts?.skipPurchase,
          reassign: true,
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; telnyx_phone_number?: string; warning?: string };
      if (!d?.success) throw new Error(d?.error || "Provision failed");
      toast({
        title: "Telnyx number ready",
        description: d.warning
          ? `${d.telnyx_phone_number} saved. Note: ${d.warning}`
          : `${d.telnyx_phone_number} provisioned.`,
      });
      await load();
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

  const unassignTelnyxNumber = async () => {
    if (!restaurant?.id || !restaurant.telnyx_phone_number) return;
    const confirmed = window.confirm(
      `Remove phone number ${restaurant.telnyx_phone_number} from ${restaurant.name}? You can re-assign it to another restaurant anytime.`,
    );
    if (!confirmed) return;
    setUnassigningNumberBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-unassign-telnyx-number", {
        body: { restaurant_id: restaurant.id },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; message?: string };
      if (!d?.success) throw new Error(d?.error || "Failed to remove number");
      toast({
        title: "Number removed",
        description: d.message || "Phone number removed successfully.",
      });
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Remove failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setUnassigningNumberBusy(false);
    }
  };

  const createOrUpdateSynthflowAgent = async () => {
    setSynthflowBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("restaurant-create-synthflow-agent", {
        body: {
          restaurant_id: restaurant.id,
          language: newAgent.language || restaurant.agent_language || "en",
          voice_id: newAgent.voice_id || restaurant.agent_voice_id || undefined,
          first_message: newAgent.first_message || restaurant.agent_first_message || undefined,
          system_prompt: newAgent.system_prompt || restaurant.agent_system_prompt || undefined,
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; synthflow_agent_id?: string; action?: string };
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({
        title: d.action === "updated" ? "Synthflow agent updated" : "Synthflow agent created",
        description: [
          d.synthflow_agent_id ? `Agent: ${d.synthflow_agent_id}` : null,
          d.attached_phone_number ? `Phone: ${d.attached_phone_number}` : null,
          d.warning || null,
        ]
          .filter(Boolean)
          .join(" — "),
      });
      await load();
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
    setSynthflowSyncBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-restaurant-menu-to-synthflow", {
        body: { restaurant_id: restaurant.id },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string };
      if (!d?.success) throw new Error(d?.error || "Sync failed");
      toast({ title: "Menu & coupons synced to Synthflow" });
      await load();
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

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/restaurants")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">
            Configure Telnyx + Synthflow phone AI for this restaurant
          </p>
        </div>
      </div>

      {/* Telnyx + Synthflow (recommended) */}
      <Card className="border-primary/25">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Telnyx + Synthflow
            </CardTitle>
            <div className="flex gap-2">
              <StatusBadge ok={telnyxReady} />
              <Badge variant={synthflowReady ? "default" : "secondary"} className="gap-1">
                {synthflowReady ? <><Bot className="h-3 w-3" />Agent ready</> : <><Bot className="h-3 w-3" />No agent</>}
              </Badge>
            </div>
          </div>
          <CardDescription>
            Dedicated Telnyx number per restaurant. Synthflow AI answers calls, explains menu and coupons, takes the order,
            then posts to our webhook so the order is created automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/15 px-4 py-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div>
                Telnyx number:{" "}
                <code className="text-foreground font-semibold">{restaurant.telnyx_phone_number || "not assigned"}</code>
              </div>
              {restaurant.telnyx_phone_number ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                  disabled={unassigningNumberBusy}
                  onClick={() => void unassignTelnyxNumber()}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {unassigningNumberBusy ? "Removing…" : "Remove number"}
                </Button>
              ) : null}
            </div>
            <div>
              Synthflow agent:{" "}
              <code className="text-foreground">{restaurant.synthflow_agent_id || "not created"}</code>
            </div>
            {restaurant.synthflow_synced_at ? (
              <div>Last synced: {new Date(restaurant.synthflow_synced_at).toLocaleString()}</div>
            ) : null}
            {restaurant.voice_provider ? (
              <div>
                Voice provider: <code className="text-foreground">{restaurant.voice_provider}</code>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">1. Search &amp; assign a Telnyx number</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Area code (optional)</Label>
                <Input
                  value={telnyxAreaCode}
                  onChange={(e) => setTelnyxAreaCode(e.target.value)}
                  placeholder="415"
                  className="w-28"
                />
              </div>
              <Button type="button" variant="secondary" disabled={telnyxSearchBusy} onClick={() => void searchTelnyxNumbers()}>
                {telnyxSearchBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Search Telnyx
              </Button>
            </div>

            {telnyxCandidates.length > 0 ? (
              <div className="space-y-2">
                <Label>Available numbers</Label>
                <Select value={selectedTelnyxNumber} onValueChange={setSelectedTelnyxNumber}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a number to purchase" />
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
                  {telnyxProvisionBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Purchase &amp; assign number
                </Button>
              </div>
            ) : null}

            <div className="space-y-2 pt-2 border-t">
              <Label>Or attach an existing Telnyx number (E.164)</Label>
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
                  Assign existing
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">2. Create / update Synthflow AI agent</p>
            <p className="text-xs text-muted-foreground">
              Menu items and active coupons are injected into the agent prompt. Requires{" "}
              <code>PUBLIC_API_URL</code>, <code>SYNTHFLOW_API_KEY</code>, and Telnyx SIP env vars on the API.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={synthflowBusy || !restaurant.telnyx_phone_number}
                onClick={() => void createOrUpdateSynthflowAgent()}
              >
                {synthflowBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                {restaurant.synthflow_agent_id ? "Update Synthflow agent" : "Create Synthflow agent"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={synthflowSyncBusy || !restaurant.synthflow_agent_id}
                onClick={() => void syncMenuToSynthflow()}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${synthflowSyncBusy ? "animate-spin" : ""}`} />
                Sync menu &amp; coupons
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/15 p-4">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Post-call webhook (set on the agent automatically)
            </Label>
            <Input value={synthflowWebhookUrl} readOnly className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              After each call, Synthflow posts order details here and the system creates the order.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Legacy ElevenLabs + Twilio UI — hidden while Synthflow/Telnyx is primary */}
      {false && (
      <>
      {/* ElevenLabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Mic className="h-5 w-5" />ElevenLabs (legacy)</CardTitle>
            <StatusBadge ok={elConnected} />
          </div>
          <CardDescription>
            Optional. If you don’t connect per-restaurant, the server can still use the global <code>ELEVENLABS_API_KEY</code> /{" "}
            <code>ELEVENLABS_AGENT_ID</code> from <code>backend/.env</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {elConnected ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground flex-1">
                Connected{restaurant.elevenlabs_connected_at && ` on ${new Date(restaurant.elevenlabs_connected_at).toLocaleString()}`}.
              </p>
              <Button variant="outline" size="sm" onClick={fetchEL} disabled={loadingEL}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loadingEL ? "animate-spin" : ""}`} />Refresh
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={disconnectEL}>Disconnect</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>ElevenLabs API key</Label>
              <div className="flex gap-2">
                <Input type="password" value={elKey} onChange={(e) => setElKey(e.target.value)} placeholder="sk_..." />
                <Button onClick={saveEL} disabled={savingEL}>
                  {savingEL ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Find it in your ElevenLabs dashboard → Profile → API Keys.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Twilio */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5" />Twilio (legacy)</CardTitle>
            <StatusBadge ok={twilioConnected} />
          </div>
          <CardDescription>Connect this restaurant's own Twilio account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {twilioConnected ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground flex-1">
                Connected{restaurant.twilio_connected_at && ` on ${new Date(restaurant.twilio_connected_at).toLocaleString()}`}.
              </p>
              <Button variant="outline" size="sm" onClick={fetchTwilio} disabled={loadingTw}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loadingTw ? "animate-spin" : ""}`} />Refresh
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={disconnectTwilio}>Disconnect</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Account SID</Label>
              <Input value={twilioSid} onChange={(e) => setTwilioSid(e.target.value)} placeholder="AC..." />
              <Label>Auth Token</Label>
              <Input type="password" value={twilioToken} onChange={(e) => setTwilioToken(e.target.value)} placeholder="••••••••" />
              <Button onClick={saveTwilio} disabled={savingTwilio}>
                {savingTwilio ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Order-taking Agent</CardTitle>
          <CardDescription>
            {restaurant.elevenlabs_agent_id
              ? <>Current agent: <code className="text-xs">{restaurant.elevenlabs_agent_id}</code></>
              : "No agent assigned yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Agent ID</Label>
            <div className="flex gap-2">
              <Input
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                placeholder="agent_..."
              />
              <Button onClick={saveAgentIdOnly} disabled={!selectedAgentId.trim() || selectedAgentId.trim() === (restaurant.elevenlabs_agent_id || "")}>
                <Link2 className="h-4 w-4 mr-1" />Save
              </Button>
              {restaurant.elevenlabs_agent_id && (
                <AIChatTest agentId={restaurant.elevenlabs_agent_id} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              If you don’t have ConvAI permissions on the key, just paste the agent id from ElevenLabs (starts with <code>agent_</code>).
            </p>
          </div>

          {elAgents.length > 0 ? (
            <div className="space-y-2 border-t pt-4">
              <Label>Pick an existing agent (from ElevenLabs)</Label>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {elAgents.map((a) => (
                    <SelectItem key={a.agent_id} value={a.agent_id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {elConnected ? (
            <div className="border-t pt-4">
              {!showCreate ? (
                <Button variant="outline" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4 mr-1" />Create new agent
                </Button>
              ) : (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Create new agent</h4>
                  <div><Label>Name</Label>
                    <Input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Language</Label>
                      <Select value={newAgent.language} onValueChange={(v) => setNewAgent({ ...newAgent, language: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Voice ID (optional)</Label>
                      <Input value={newAgent.voice_id} onChange={(e) => setNewAgent({ ...newAgent, voice_id: e.target.value })} placeholder="EXAVITQu4vr4xnSDxMaL" />
                    </div>
                  </div>
                  <div><Label>First message</Label>
                    <Input value={newAgent.first_message} onChange={(e) => setNewAgent({ ...newAgent, first_message: e.target.value })} placeholder="Leave blank for default" /></div>
                  <div><Label>System prompt</Label>
                    <Textarea rows={4} value={newAgent.system_prompt} onChange={(e) => setNewAgent({ ...newAgent, system_prompt: e.target.value })} placeholder="Leave blank for default" /></div>
                  <div className="flex gap-2">
                    <Button onClick={createNewAgent} disabled={creatingAgent}>
                      {creatingAgent ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                      Create agent
                    </Button>
                    <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Agent creation requires a per-restaurant key with ConvAI permissions. For now you can still use chat by saving an Agent ID above.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Phone number assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5" />Phone Number</CardTitle>
          <CardDescription>
            Pick a Twilio number to import into ElevenLabs and bind to this restaurant's agent.
            {restaurant.twilio_phone_number && <> Current: <code className="text-xs">{restaurant.twilio_phone_number}</code></>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!twilioConnected ? (
            <p className="text-sm text-muted-foreground">Connect Twilio first.</p>
          ) : !restaurant.elevenlabs_agent_id ? (
            <p className="text-sm text-muted-foreground">Create or select an agent first.</p>
          ) : (
            <div className="flex gap-2">
              <Select value={selectedTwilio} onValueChange={setSelectedTwilio}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={twilioNumbers.length ? "Select a number" : "No numbers found"} />
                </SelectTrigger>
                <SelectContent>
                  {twilioNumbers.map((n) => (
                    <SelectItem key={n.sid} value={n.phone_number}>
                      {n.phone_number}{n.friendly_name ? ` — ${n.friendly_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={attachTwilioNumber} disabled={attaching || !selectedTwilio}>
                {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Link2 className="h-4 w-4 mr-1" />Attach</>}
              </Button>
            </div>
          )}
          {elPhones.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p className="font-medium">Already imported in ElevenLabs:</p>
              {elPhones.map((p) => (
                <p key={p.phone_number_id}>
                  {p.phone_number} {p.assigned_agent && <Badge variant="outline" className="ml-1">assigned</Badge>}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* Fulfillment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Fulfillment Options</CardTitle>
          <CardDescription>Choose how this restaurant serves its customers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/20">
              <input 
                type="checkbox" 
                id="conf-delivery" 
                className="h-4 w-4"
                checked={restaurant.allows_delivery} 
                onChange={async (e) => {
                  const val = e.target.checked;
                  setRestaurant({ ...restaurant, allows_delivery: val });
                  const { error } = await supabase.from("restaurants").update({ allows_delivery: val }).eq("id", restaurant.id);
                  if (error) toast({ variant: "destructive", title: "Save failed", description: (error as any).message });
                  else toast({ title: "Delivery option updated" });
                }} 
              />
              <Label htmlFor="conf-delivery" className="cursor-pointer">Allows Delivery</Label>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/20">
              <input 
                type="checkbox" 
                id="conf-pickup" 
                className="h-4 w-4"
                checked={restaurant.allows_pickup} 
                onChange={async (e) => {
                  const val = e.target.checked;
                  setRestaurant({ ...restaurant, allows_pickup: val });
                  const { error } = await supabase.from("restaurants").update({ allows_pickup: val }).eq("id", restaurant.id);
                  if (error) toast({ variant: "destructive", title: "Save failed", description: (error as any).message });
                  else toast({ title: "Pickup option updated" });
                }} 
              />
              <Label htmlFor="conf-pickup" className="cursor-pointer">Allows Self Pickup</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />Operating Hours</CardTitle>
            <CardDescription>Set when this restaurant is open for orders.</CardDescription>
          </div>
          <Button onClick={saveHours} disabled={savingHours} size="sm">
            {savingHours ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Hours"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {DAYS.map((dayName, dayIdx) => {
            const daySlots = hours.filter(h => h.day_of_week === dayIdx);
            return (
              <div key={dayIdx} className="space-y-3 pb-4 border-b last:border-0">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-bold">{dayName}</Label>
                  <Button variant="outline" size="sm" onClick={() => addHourSlot(dayIdx)} className="h-8">
                    <Plus className="h-4 w-4 mr-1" /> Add Slot
                  </Button>
                </div>
                {daySlots.length === 0 ? (
                  <div className="p-3 rounded-lg border border-dashed text-center bg-muted/5">
                    <p className="text-xs text-muted-foreground italic">Closed all day</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {hours.map((h, globalIdx) => {
                      if (h.day_of_week !== dayIdx) return null;
                      return (
                        <div key={globalIdx} className="flex items-center gap-3 bg-muted/20 p-2 rounded-lg border">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <div><Label className="text-[10px] uppercase opacity-50 block mb-1">Open</Label>
                              <Input type="time" value={h.open_time} onChange={(e) => updateHourSlot(globalIdx, { open_time: e.target.value })} className="h-8 text-xs" />
                            </div>
                            <div><Label className="text-[10px] uppercase opacity-50 block mb-1">Close</Label>
                              <Input type="time" value={h.close_time} onChange={(e) => updateHourSlot(globalIdx, { close_time: e.target.value })} className="h-8 text-xs" />
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeHourSlot(globalIdx)}><Trash2 className="h-4 w-4" /></Button>
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
    </div>
  );
}