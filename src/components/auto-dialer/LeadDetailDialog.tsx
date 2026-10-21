import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { StatusBadge, InterestBadge } from "./StatusBadge";
import { Loader2, Phone, Mail, Building2, ExternalLink, RefreshCw } from "lucide-react";
import { cleanUrduText } from "@/lib/devanagariTransliterator";

interface Props {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetailDialog({ leadId, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["auto-dialer-lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data: lead } = await supabase
        .from("auto_dialer_leads")
        .select("*")
        .eq("id", leadId)
        .single();

      let call: any = null;
      let conversations: any[] = [];

      // 1. Try by linked call_id first
      if (lead?.call_id) {
        const { data: callData } = await supabase
          .from("calls").select("*").eq("id", lead.call_id).maybeSingle();
        call = callData;
      }
      // 2. Fallback: look up by elevenlabs_conversation_id (works even if call_id never got set)
      if (!call && lead?.elevenlabs_conversation_id) {
        const { data: callData } = await supabase
          .from("calls").select("*").eq("elevenlabs_conversation_id", lead.elevenlabs_conversation_id).maybeSingle();
        call = callData;
      }
      // 3. Last resort: by twilio_call_sid
      if (!call && lead?.twilio_call_sid) {
        const { data: callData } = await supabase
          .from("calls").select("*").eq("twilio_call_sid", lead.twilio_call_sid).maybeSingle();
        call = callData;
      }

      if (call?.id) {
        const { data: conv } = await supabase
          .from("conversations").select("*").eq("call_id", call.id).order("timestamp", { ascending: true });
        conversations = conv || [];
      }

      return { lead, call, conversations };
    },
    enabled: !!leadId && open,
    refetchInterval: 5000, // Auto-refresh while dialog is open so user sees real-time updates
  });

  const lead = data?.lead;
  const call = data?.call;
  const playbook = lead?.ai_talking_points as any;
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!leadId) return;
    setSyncing(true);
    try {
      const { data: r, error } = await supabase.functions.invoke("sync-auto-dialer-call", { body: { leadId } });
      if (error) throw error;
      if ((r as any)?.ok) toast({ title: "Synced from ElevenLabs", description: `Transcript: ${(r as any).hasTranscript ? "yes" : "no"}, recording: ${(r as any).hasRecording ? "yes" : "no"}` });
      else toast({ variant: "destructive", title: "Sync failed", description: (r as any)?.reason || "unknown" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e.message });
    } finally {
      setSyncing(false);
    }
  };

  // Stream the recording through our authenticated edge proxy (ElevenLabs URLs require xi-api-key).
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const conversationId = call?.elevenlabs_conversation_id || lead?.elevenlabs_conversation_id;

  // Auto-pull fresh data from ElevenLabs the first time we open a lead that has a
  // conversation_id but no transcript / recording yet. This guarantees stats and
  // playback come straight from the source, not stale local cache.
  useEffect(() => {
    if (!open || !leadId || !conversationId) return;
    const needsSync = !call?.transcript || !call?.recording_url || lead?.call_status === "calling";
    if (!needsSync) return;
    supabase.functions.invoke("sync-auto-dialer-call", { body: { leadId } })
      .catch((e) => console.error("auto-sync on open failed:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId, conversationId, call?.transcript, call?.recording_url, lead?.call_status]);

  const loadAudio = async () => {
    if (!conversationId) return;
    setAudioLoading(true);
    setAudioError(null);
    setAudioUrl(null);
    try {
      // Force a fresh sync first so ElevenLabs has time to finalize the recording
      await supabase.functions.invoke("sync-auto-dialer-call", { body: { leadId } }).catch(() => {});
      const { data: blob, error } = await supabase.functions.invoke("elevenlabs-conversation-audio", {
        body: { conversation_id: conversationId },
      });
      if (error) throw error;

      if (blob instanceof Blob) {
        if (blob.type.includes("application/json")) {
          const txt = await blob.text();
          try {
            const parsed = JSON.parse(txt);
            if (parsed?.fallback) {
              setAudioError("Recording not available yet. ElevenLabs is still processing it — try the Sync button in 30s.");
              return;
            }
          } catch (_) { /* ignore */ }
          setAudioError("Recording not available.");
          return;
        }
        setAudioUrl(URL.createObjectURL(blob));
      } else {
        const audioBlob = new Blob([blob as ArrayBuffer], { type: "audio/mpeg" });
        setAudioUrl(URL.createObjectURL(audioBlob));
      }
    } catch (e: any) {
      setAudioError(e?.message || "Failed to load recording");
    } finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    setAudioUrl(null);
    setAudioError(null);
    if (!open || !conversationId) return;
    loadAudio();
    return () => {
      setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{lead?.client_name || "Lead Detail"}</DialogTitle>
          <DialogDescription className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={lead?.call_status || "pending"} />
            <InterestBadge level={lead?.interest_level || null} lead={lead} />
            {(lead as any)?.gatekeeper_encountered && <Badge variant="outline" className="text-xs">Gatekeeper</Badge>}
            {(lead as any)?.callback_requested && <Badge variant="secondary" className="text-xs">Needs callback</Badge>}
            {lead?.converted_lead_id && (
              <a href="/leads" className="text-xs text-primary underline inline-flex items-center gap-1">
                Converted to Lead <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {conversationId && (
              <Button variant="outline" size="sm" className="ml-auto h-7" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Sync from ElevenLabs
              </Button>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !lead ? (
          <p className="text-muted-foreground">Lead not found.</p>
        ) : (
          <ScrollArea className="max-h-[65vh] pr-4">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="playbook">AI Playbook</TabsTrigger>
                <TabsTrigger value="transcript" disabled={!call}>Transcript</TabsTrigger>
                <TabsTrigger value="recording" disabled={!conversationId}>Recording</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3">
                <Card><CardContent className="pt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{lead.phone_number}{(lead as any).extension && <span className="text-muted-foreground"> ext {(lead as any).extension}</span>}</div>
                  {lead.email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{lead.email}</div>}
                  {lead.company && <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{lead.company}</div>}
                  {lead.pitched_for && <p><span className="font-medium">Pitched for:</span> {lead.pitched_for}</p>}
                  {lead.services_done && <p><span className="font-medium">Services done:</span> {lead.services_done}</p>}
                  {lead.additional_notes && <p><span className="font-medium">Notes:</span> {lead.additional_notes}</p>}
                  {(lead as any).callback_reason && <p className="text-warning"><span className="font-medium">Callback:</span> {(lead as any).callback_reason}</p>}
                  {lead.called_at && <p className="text-xs text-muted-foreground">Called: {new Date(lead.called_at).toLocaleString()}</p>}
                  {call?.duration_seconds ? <p className="text-xs text-muted-foreground">Duration: {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s</p> : null}
                </CardContent></Card>

                {lead.ai_summary && (
                  <Card><CardContent className="pt-4">
                    <p className="text-sm font-medium mb-1">AI Summary</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.ai_summary}</p>
                  </CardContent></Card>
                )}
              </TabsContent>

              <TabsContent value="playbook" className="space-y-3">
                {!playbook ? (
                  <p className="text-sm text-muted-foreground">No AI playbook generated yet.</p>
                ) : (
                  <>
                    {playbook.opening_hook && (
                      <Card><CardContent className="pt-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Opening Hook</p>
                        <p className="text-sm">{playbook.opening_hook}</p>
                      </CardContent></Card>
                    )}
                    {playbook.pitch_script && (
                      <Card><CardContent className="pt-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Pitch Script</p>
                        <p className="text-sm whitespace-pre-wrap">{playbook.pitch_script}</p>
                      </CardContent></Card>
                    )}
                    {playbook.talking_points && (
                      <Card><CardContent className="pt-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Talking Points</p>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {playbook.talking_points.map((tp: string, i: number) => <li key={i}>{tp}</li>)}
                        </ul>
                      </CardContent></Card>
                    )}
                    {playbook.objection_handlers && (
                      <Card><CardContent className="pt-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-2">Objection Handlers</p>
                        {playbook.objection_handlers.map((o: any, i: number) => (
                          <div key={i} className="mb-2 text-sm">
                            <p className="font-medium">"{o.objection}"</p>
                            <p className="text-muted-foreground pl-2">→ {o.response}</p>
                          </div>
                        ))}
                      </CardContent></Card>
                    )}
                    {playbook.next_step_ask && (
                      <Card><CardContent className="pt-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Next Step</p>
                        <p className="text-sm">{playbook.next_step_ask}</p>
                      </CardContent></Card>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="transcript">
                {data?.conversations && data.conversations.length > 0 ? (
                  <div className="space-y-2">
                    {data.conversations.map((c) => (
                      <div key={c.id} className={`p-3 rounded-lg ${c.speaker === "ai" ? "bg-primary/5" : "bg-muted/50"}`}>
                        <p className="text-xs font-medium mb-1 text-muted-foreground">
                          {c.speaker === "ai" ? "AI Agent" : "Customer"}
                        </p>
                        <p className="text-sm">{cleanUrduText(c.message)}</p>
                      </div>
                    ))}
                  </div>
                ) : call?.transcript ? (
                  <pre className="text-sm whitespace-pre-wrap">{cleanUrduText(call.transcript)}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No transcript yet.</p>
                )}
              </TabsContent>

              <TabsContent value="recording">
                {audioLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading recording…</div>
                ) : audioUrl ? (
                  <audio src={audioUrl} controls className="w-full" />
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{audioError || "No recording available."}</p>
                    <Button size="sm" variant="outline" onClick={loadAudio} disabled={audioLoading}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Retry fetch from ElevenLabs
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
