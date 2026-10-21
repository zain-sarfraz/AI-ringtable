import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Bot,
  FileAudio,
  MessageSquare,
  ExternalLink,
  Loader2,
  Building2,
  Mail,
  MessageCircle,
  Mic,
  Brain,
  CheckCircle,
  XCircle,
  Info,
  Languages,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { cleanUrduText, toUrduScript } from "@/lib/devanagariTransliterator";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type Call = Tables<"calls">;
type Conversation = Tables<"conversations">;

interface CallMetadata {
  agent?: { id?: string; name?: string; language?: string; first_message?: string };
  voice?: { id?: string; name?: string; labels?: Record<string, string> } | null;
  call?: { status?: string; has_audio?: boolean; cost?: number; call_successful?: boolean; duration_secs?: number };
  customer?: { name?: string; email?: string; phone?: string; whatsapp?: string; company?: string };
  analysis?: {
    summary?: string;
    call_successful?: boolean;
    data_collection?: Record<string, string | null>;
    evaluation?: Record<string, { result?: string; rationale?: string }>;
  };
  dynamic_variables?: Record<string, string> | null;
}

interface CallDetailDialogProps {
  call: Call | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  queued: { label: "Queued", variant: "secondary" },
  in_progress: { label: "In Progress", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  missed: { label: "Missed", variant: "destructive" },
  transferred: { label: "Transferred", variant: "secondary" },
};

const sentimentColors: Record<string, string> = {
  positive: "text-green-500",
  neutral: "text-muted-foreground",
  negative: "text-destructive",
};

function RecordingPlayer({ recordingUrl }: { recordingUrl: string | null }) {
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAudio = async () => {
    if (!recordingUrl) return;
    setIsLoading(true);
    setError(null);
    try {
      if (recordingUrl.includes("api.elevenlabs.io")) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const t = getToken();
        if (t) headers.Authorization = `Bearer ${t}`;
        const response = await fetch(`${getApiBase()}/api/functions/elevenlabs-conversation-audio`, {
          method: "POST",
          headers,
          body: JSON.stringify({ recording_url: recordingUrl }),
        });
        if (!response.ok) throw new Error(`Failed to fetch audio (HTTP ${response.status})`);
        // Edge function returns 200 with JSON {fallback:true,error} when the
        // recording isn't ready yet — detect that before piping to <audio>.
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const body = await response.json().catch(() => ({}));
          const reason = body?.error === "RECORDING_NOT_AVAILABLE"
            ? "Recording is not ready yet — ElevenLabs is still processing it. Try again in a minute."
            : body?.error || "Recording is unavailable.";
          throw new Error(reason);
        }
        const audioBlob = await response.blob();
        if (audioBlob.size === 0) throw new Error("Empty audio response from ElevenLabs.");
        setAudioUrl(URL.createObjectURL(audioBlob));
      } else {
        setAudioUrl(recordingUrl);
      }
    } catch (err) {
      console.error("Audio load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load recording");
    } finally {
      setIsLoading(false);
    }
  };

  if (!recordingUrl) {
    return (
      <div className="text-center py-8">
        <FileAudio className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
        <p className="text-muted-foreground mt-2">No recording available</p>
      </div>
    );
  }

  return (
    <div className="text-center py-8 space-y-4">
      <FileAudio className="h-16 w-16 mx-auto text-primary" />
      <p className="text-muted-foreground">Call recording available</p>
      {!audioUrl && !isLoading && !error && (
        <Button onClick={loadAudio}>Load Recording</Button>
      )}
      {isLoading && (
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading audio...</span>
        </div>
      )}
      {error && <div className="text-destructive">{error}</div>}
      {audioUrl && (
        <>
          <audio controls className="mx-auto">
            <source src={audioUrl} type="audio/mpeg" />
          </audio>
          <Button variant="outline" asChild>
            <a href={audioUrl} target="_blank" rel="noopener noreferrer" download="call-recording.mp3">
              <ExternalLink className="h-4 w-4 mr-2" />
              Download
            </a>
          </Button>
        </>
      )}
    </div>
  );
}

function MetadataSection({ metadata }: { metadata: CallMetadata | null }) {
  if (!metadata) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Info className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No detailed metadata available. Try syncing from ElevenLabs.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Agent Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4" /> Agent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{metadata.agent?.name || "Unknown"}</span></div>
            <div><span className="text-muted-foreground">Language:</span> {metadata.agent?.language || "N/A"}</div>
            {metadata.agent?.first_message && (
              <div><span className="text-muted-foreground">Greeting:</span> <span className="italic text-xs">{metadata.agent.first_message.substring(0, 100)}...</span></div>
            )}
          </CardContent>
        </Card>

        {/* Voice Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Mic className="h-4 w-4" /> Voice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Voice:</span> <span className="font-medium">{metadata.voice?.name || "Default"}</span></div>
            {metadata.voice?.labels && Object.entries(metadata.voice.labels).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(metadata.voice.labels).map(([key, val]) => (
                  <Badge key={key} variant="secondary" className="text-xs">{key}: {val}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Details */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <User className="h-4 w-4" /> Customer Details (from conversation)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">{metadata.customer?.name || "Not provided"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Email:</span>
                <span className="font-medium">{metadata.customer?.email || "Not provided"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Phone:</span>
                <span className="font-medium">{metadata.customer?.phone || "Not provided"}</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">WhatsApp:</span>
                <span className="font-medium">{metadata.customer?.whatsapp || "Not provided"}</span>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Business:</span>
                <span className="font-medium">{metadata.customer?.company || "Not provided"}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Analysis / Summary */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Brain className="h-4 w-4" /> AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Call Successful:</span>
              {metadata.analysis?.call_successful === true ? (
                <Badge variant="outline" className="text-green-600 border-green-300"><CheckCircle className="h-3 w-3 mr-1" /> Yes</Badge>
              ) : metadata.analysis?.call_successful === false ? (
                <Badge variant="outline" className="text-destructive border-destructive/30"><XCircle className="h-3 w-3 mr-1" /> No</Badge>
              ) : (
                <span className="text-muted-foreground">N/A</span>
              )}
            </div>
            {metadata.analysis?.summary && (
              <div>
                <p className="text-muted-foreground mb-1">Summary:</p>
                <p className="bg-muted/50 p-3 rounded-lg">{metadata.analysis.summary}</p>
              </div>
            )}
            {metadata.call?.cost != null && (
              <div><span className="text-muted-foreground">Cost:</span> ${metadata.call.cost.toFixed(4)}</div>
            )}
          </CardContent>
        </Card>

        {/* Data Collected */}
        {metadata.analysis?.data_collection && Object.keys(metadata.analysis.data_collection).length > 0 && (
          <Card className="col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Data Collected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(metadata.analysis.data_collection).map(([key, val]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}:</span>
                    <span className="font-medium">{val || "—"}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Evaluation Results */}
        {metadata.analysis?.evaluation && Object.keys(metadata.analysis.evaluation).length > 0 && (
          <Card className="col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Evaluation Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {Object.entries(metadata.analysis.evaluation).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2">
                    {val?.result === "success" ? (
                      <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                    )}
                    <div>
                      <span className="font-medium capitalize">{key.replace(/_/g, " ")}</span>
                      {val?.rationale && <p className="text-muted-foreground text-xs">{val.rationale}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

export function CallDetailDialog({ call, open, onOpenChange }: CallDetailDialogProps) {
  const { data: conversations = [] } = useQuery({
    queryKey: ["call-conversations", call?.id],
    queryFn: async () => {
      if (!call?.id) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("call_id", call.id)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data as Conversation[];
    },
    enabled: !!call?.id,
  });

  const { data: customer } = useQuery({
    queryKey: ["call-customer", call?.customer_id],
    queryFn: async () => {
      if (!call?.customer_id) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", call.customer_id)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!call?.customer_id,
  });

  const [transcriptLanguageView, setTranscriptLanguageView] = useState<"roman" | "urdu">("roman");

  if (!call) return null;

  const metadata = (call as Call & { metadata?: CallMetadata }).metadata as CallMetadata | null;

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {call.direction === "inbound" ? (
              <PhoneIncoming className="h-5 w-5 text-status-available" />
            ) : (
              <PhoneOutgoing className="h-5 w-5 text-status-on-call" />
            )}
            <span>{call.direction === "inbound" ? "Inbound" : "Outbound"} Call</span>
            <Badge variant={statusConfig[call.status || "queued"]?.variant || "outline"}>
              {statusConfig[call.status || "queued"]?.label || call.status}
            </Badge>
            {metadata?.agent?.name && (
              <Badge variant="secondary" className="text-xs">
                <Bot className="h-3 w-3 mr-1" />{metadata.agent.name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transcript">Transcript ({conversations.length})</TabsTrigger>
            <TabsTrigger value="recording">Recording</TabsTrigger>
            <TabsTrigger value="details">Call Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <MetadataSection metadata={metadata} />
          </TabsContent>

          <TabsContent value="transcript" className="mt-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                Transcript View:
              </span>
              <div className="inline-flex items-center rounded-lg border border-border/70 p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setTranscriptLanguageView("roman")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5",
                    transcriptLanguageView === "roman"
                      ? "bg-background text-primary shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Show in Roman Urdu / English"
                >
                  <Languages className="h-3.5 w-3.5" />
                  <span>Roman Urdu / English</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTranscriptLanguageView("urdu")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 font-medium",
                    transcriptLanguageView === "urdu"
                      ? "bg-background text-primary shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Show in Urdu script (اردو)"
                >
                  <span>اردو</span>
                </button>
              </div>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              {conversations.length > 0 ? (
                <div className="space-y-4">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "flex gap-3 p-3 rounded-lg",
                        conv.speaker === "agent" || conv.speaker === "ai"
                          ? "bg-primary/10 ml-8"
                          : "bg-muted mr-8"
                      )}
                    >
                      <div className="flex-shrink-0">
                        {conv.speaker === "ai" ? (
                          <Bot className="h-5 w-5 text-primary" />
                        ) : conv.speaker === "agent" ? (
                          <User className="h-5 w-5 text-primary" />
                        ) : (
                          <User className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium capitalize">{conv.speaker}</span>
                          {conv.sentiment && (
                            <span className={cn("text-xs", sentimentColors[conv.sentiment] || sentimentColors.neutral)}>
                              ({conv.sentiment})
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {conv.timestamp ? format(new Date(conv.timestamp), "p") : ""}
                          </span>
                        </div>
                        <p
                          dir={transcriptLanguageView === "urdu" ? "rtl" : "ltr"}
                          className={cn(
                            "text-sm leading-relaxed",
                            transcriptLanguageView === "urdu" ? "font-medium text-[15px] leading-loose" : ""
                          )}
                        >
                          {transcriptLanguageView === "urdu"
                            ? toUrduScript(conv.message)
                            : cleanUrduText(conv.message)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : call.transcript ? (
                <Card className="border-dashed">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground mb-3">Full Call Transcript:</p>
                    <div
                      dir={transcriptLanguageView === "urdu" ? "rtl" : "ltr"}
                      className={cn(
                        "whitespace-pre-wrap text-sm p-4 rounded-lg",
                        transcriptLanguageView === "urdu"
                          ? "bg-muted/50 font-medium text-[15px] leading-loose"
                          : "font-mono bg-muted/50"
                      )}
                    >
                      {transcriptLanguageView === "urdu"
                        ? toUrduScript(call.transcript)
                        : cleanUrduText(call.transcript)}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No transcript available for this call</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="recording" className="mt-4">
            <RecordingPlayer recordingUrl={call.recording_url} />
          </TabsContent>

          <TabsContent value="details" className="mt-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Call Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{call.phone_number}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>Duration: {formatDuration(call.duration_seconds)}</span>
                  </div>
                  {call.started_at && (
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Started: {format(new Date(call.started_at), "PPP p")}</span>
                    </div>
                  )}
                  {call.ended_at && (
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Ended: {format(new Date(call.ended_at), "PPP p")}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Customer</CardTitle>
                </CardHeader>
                <CardContent>
                  {customer ? (
                    <div className="space-y-2">
                      <p className="font-medium">{customer.full_name || "Unknown"}</p>
                      <p className="text-sm text-muted-foreground">{customer.email}</p>
                      <p className="text-sm text-muted-foreground">{customer.company}</p>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No customer linked</span>
                  )}
                </CardContent>
              </Card>

              <Card className="col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Notes / Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{call.notes || "No notes available"}</p>
                </CardContent>
              </Card>

              {(call.twilio_call_sid || call.elevenlabs_conversation_id) && (
                <Card className="col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Technical Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {call.twilio_call_sid && (
                      <p className="text-sm font-mono text-muted-foreground">Twilio SID: {call.twilio_call_sid}</p>
                    )}
                    {call.elevenlabs_conversation_id && (
                      <p className="text-sm font-mono text-muted-foreground">ElevenLabs ID: {call.elevenlabs_conversation_id}</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
