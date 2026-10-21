import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  PhoneCall,
  Mic,
  Bot,
  User,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  Copy,
  Check,
  FileAudio,
  MessageSquare,
  Sparkles,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  Search,
  ArrowDown,
  ArrowUp,
  Maximize2,
  Minimize2,
  Languages,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { useToast } from "@/hooks/use-toast";
import { cleanUrduText, toUrduScript } from "@/lib/devanagariTransliterator";
import { cn } from "@/lib/utils";

export interface CallData {
  id: string;
  phone_number?: string | null;
  duration_seconds?: number | null;
  status?: string | null;
  recording_url?: string | null;
  transcript?: string | null;
  notes?: string | null;
  provider?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  metadata?: any;
  synthflow_call_id?: string | null;
  elevenlabs_conversation_id?: string | null;
}

export interface ConversationTurn {
  id?: string;
  speaker: string; // 'agent' | 'ai' | 'customer' | 'user'
  message: string;
  timestamp?: string | null;
  sentiment?: string | null;
}

interface OrderCallRecordingProps {
  call: CallData | null;
  conversations?: ConversationTurn[];
  orderSource?: string;
  aiExtractedData?: any;
  loading?: boolean;
  onRefresh?: () => void;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTimeOnly(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

/**
 * Parses a plain text transcript into structured turns if not already provided as an array.
 */
function parseTranscriptText(text?: string | null): ConversationTurn[] {
  if (!text || !text.trim()) return [];

  // Try parsing JSON if stored as JSON string
  if (text.trim().startsWith("[") || text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((p, idx) => ({
          id: String(idx),
          speaker: p.role || p.speaker || (p.agent ? "agent" : "customer"),
          message: p.message || p.text || p.content || "",
          timestamp: p.timestamp ? String(p.timestamp) : null,
          sentiment: p.sentiment || null,
        }));
      }
    } catch {
      // Not JSON, continue with text parsing
    }
  }

  // Regex pattern matching lines like:
  // "bot: Hello...", "human: ...", "Agent: Hello...", "Customer: ...", "User: ...", "[00:12] Agent: ..."
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const turns: ConversationTurn[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const speakerMatch = line.match(/^(?:\[([^\]]+)\]\s*)?(agent|ai|bot|customer|user|human|lead|caller|assistant|system)[:\-]\s*(.*)$/i);

    if (speakerMatch) {
      const rawTimestamp = speakerMatch[1];
      const rawSpeaker = speakerMatch[2].toLowerCase();
      const rawMsg = speakerMatch[3];

      let speaker: "agent" | "customer" = "customer";
      if (["agent", "ai", "bot", "assistant", "system"].includes(rawSpeaker)) {
        speaker = "agent";
      }

      turns.push({
        id: String(i),
        speaker,
        message: rawMsg,
        timestamp: rawTimestamp || null,
      });
    } else if (turns.length > 0) {
      // Append multi-line message to last turn
      turns[turns.length - 1].message += `\n${line}`;
    } else {
      // Default initial line
      turns.push({
        id: String(i),
        speaker: "customer",
        message: line,
      });
    }
  }

  return turns;
}

export function OrderCallRecording({
  call,
  conversations = [],
  orderSource,
  aiExtractedData,
  loading = false,
  onRefresh,
}: OrderCallRecordingProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [transcriptLanguageView, setTranscriptLanguageView] = useState<"roman" | "urdu">("roman");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  const rawRecordingUrl = call?.recording_url || aiExtractedData?.recording_url || aiExtractedData?.audio_url;

  // Resolve audio URL (proxied for ElevenLabs, direct for Synthflow/Twilio/S3)
  useEffect(() => {
    let active = true;
    if (!rawRecordingUrl) {
      setAudioUrl(null);
      setAudioLoading(false);
      setAudioError(null);
      return;
    }

    const loadAudioSource = async () => {
      setAudioLoading(true);
      setAudioError(null);

      try {
        if (rawRecordingUrl.includes("api.elevenlabs.io")) {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          const t = getToken();
          if (t) headers.Authorization = `Bearer ${t}`;

          const res = await fetch(`${getApiBase()}/api/functions/elevenlabs-conversation-audio`, {
            method: "POST",
            headers,
            body: JSON.stringify({ recording_url: rawRecordingUrl }),
          });

          if (!res.ok) throw new Error(`Audio load error (HTTP ${res.status})`);

          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const body = await res.json().catch(() => ({}));
            const reason =
              body?.error === "RECORDING_NOT_AVAILABLE"
                ? "Recording is processing by voice provider. Try refreshing in a moment."
                : body?.error || "Audio recording is unavailable.";
            throw new Error(reason);
          }

          const blob = await res.blob();
          if (blob.size === 0) throw new Error("Empty audio recording returned.");
          if (active) {
            setAudioUrl(URL.createObjectURL(blob));
          }
        } else {
          // Direct public/presigned audio URL
          if (active) {
            setAudioUrl(rawRecordingUrl);
          }
        }
      } catch (err: any) {
        if (active) {
          console.error("Order audio load failed:", err);
          setAudioError(err.message || "Failed to load audio");
        }
      } finally {
        if (active) {
          setAudioLoading(false);
        }
      }
    };

    void loadAudioSource();

    return () => {
      active = false;
    };
  }, [rawRecordingUrl]);

  // Audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((e) => console.error("Play error:", e));
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const changeSpeed = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    audio.playbackRate = nextSpeed;
    setPlaybackRate(nextSpeed);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Number(e.target.value);
    audio.currentTime = target;
    setCurrentTime(target);
  };

  // Resolve chat transcript turns
  const parsedTurns = useMemo(() => {
    if (conversations && conversations.length > 0) return conversations;
    const text = call?.transcript || aiExtractedData?.transcript || aiExtractedData?.raw?.transcript;
    return parseTranscriptText(text);
  }, [conversations, call?.transcript, aiExtractedData]);

  const filteredTurns = useMemo(() => {
    if (!searchQuery.trim()) return parsedTurns;
    const q = searchQuery.toLowerCase().trim();
    return parsedTurns.filter(
      (t) =>
        t.message.toLowerCase().includes(q) ||
        t.speaker.toLowerCase().includes(q)
    );
  }, [parsedTurns, searchQuery]);

  const scrollToTop = () => {
    transcriptContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTo({
        top: transcriptContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const fullTranscriptString = useMemo(() => {
    let raw = "";
    if (call?.transcript) {
      raw = call.transcript;
    } else if (parsedTurns.length > 0) {
      raw = parsedTurns
        .map((t) => `${t.speaker === "agent" || t.speaker === "ai" ? "AI Agent" : "Customer"}: ${t.message}`)
        .join("\n\n");
    }
    if (!raw) return "";
    return transcriptLanguageView === "urdu" ? toUrduScript(raw) : cleanUrduText(raw);
  }, [call?.transcript, parsedTurns, transcriptLanguageView]);

  const copyTranscript = () => {
    if (!fullTranscriptString) return;
    navigator.clipboard.writeText(fullTranscriptString);
    setCopied(true);
    toast({ title: "Transcript copied to clipboard!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const isPhoneOrder =
    orderSource === "phone" ||
    orderSource === "call" ||
    orderSource === "ai" ||
    orderSource === "synthflow" ||
    orderSource === "elevenlabs" ||
    Boolean(call);

  const providerLabel = useMemo(() => {
    const p = (call?.provider || aiExtractedData?.provider || "").toLowerCase();
    if (p.includes("synthflow")) return "Synthflow AI";
    if (p.includes("elevenlabs")) return "ElevenLabs AI";
    if (p.includes("telnyx")) return "Telnyx Voice";
    if (p.includes("twilio")) return "Twilio Voice";
    if (call?.synthflow_call_id) return "Synthflow AI";
    if (call?.elevenlabs_conversation_id) return "ElevenLabs AI";
    return isPhoneOrder ? "Voice AI Order" : "Online / Manual";
  }, [call, aiExtractedData, isPhoneOrder]);

  const rawCallNotes = call?.notes || aiExtractedData?.call_summary || aiExtractedData?.fields?.special_notes;
  const callNotes = useMemo(() => {
    if (!rawCallNotes) return null;
    return transcriptLanguageView === "urdu" ? toUrduScript(rawCallNotes) : cleanUrduText(rawCallNotes);
  }, [rawCallNotes, transcriptLanguageView]);

  // If loading call data
  if (loading) {
    return (
      <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-orange-500 animate-pulse" />
            <CardTitle className="text-sm font-bold">AI Call Recording & Transcript</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading call data and audio transcript...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="order-call-recording-section" className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden animate-fade-in scroll-mt-6">
      {/* 1. Header with Status & Provider Badges */}
      <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-orange-100 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
            <PhoneCall className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-bold text-foreground">
                AI Call Recording & Transcript
              </CardTitle>
              <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20 text-[10px] font-bold px-2 py-0.5 rounded-md">
                <Sparkles className="h-3 w-3 mr-1 inline" /> {providerLabel}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Listen to the customer's phone order conversation and review full AI dialogue.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {call?.duration_seconds ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-muted/60 text-foreground px-2.5 py-1 rounded-lg border border-border/40">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {formatDuration(call.duration_seconds)}
            </span>
          ) : null}

          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-7 text-xs px-2 gap-1 font-semibold hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" /> Sync
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Hidden native audio element */}
        {audioUrl && (
          <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
        )}

        {/* 2. Audio Player Section */}
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileAudio className="h-4 w-4 text-orange-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Call Audio Recording
              </span>
            </div>

            {call?.phone_number && (
              <span className="text-xs font-semibold text-muted-foreground">
                Caller: <span className="text-foreground">{call.phone_number}</span>
              </span>
            )}
          </div>

          {/* Audio Player Controls */}
          {audioLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Fetching and buffering call audio recording...</span>
            </div>
          ) : audioError ? (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Audio currently not available</p>
                <p className="text-[11px] opacity-90 mt-0.5">{audioError}</p>
              </div>
            </div>
          ) : audioUrl ? (
            <div className="space-y-3 pt-1">
              {/* Progress Slider */}
              <div className="space-y-1">
                <input
                  type="range"
                  min={0}
                  max={duration || call?.duration_seconds || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Audio seeker"
                  className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>{formatDuration(currentTime)}</span>
                  <span>{formatDuration(duration || call?.duration_seconds || 0)}</span>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={togglePlay}
                    className="h-9 px-4 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs gap-2"
                  >
                    {isPlaying ? <Pause className="h-4 w-4 fill-white" /> : <Play className="h-4 w-4 fill-white" />}
                    {isPlaying ? "Pause" : "Play Recording"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleMute}
                    className="h-9 w-9 p-0 rounded-xl"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="h-4 w-4 text-destructive" /> : <Volume2 className="h-4 w-4" />}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={changeSpeed}
                    className="h-9 px-2.5 rounded-xl text-xs font-mono font-bold"
                    title="Toggle playback speed"
                  >
                    {playbackRate}x
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-9 text-xs font-semibold text-muted-foreground hover:text-foreground gap-1.5"
                >
                  <a href={audioUrl} target="_blank" rel="noreferrer" download={`call-order-${call?.id || "rec"}.mp3`}>
                    <Download className="h-3.5 w-3.5" /> Download Audio
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              <FileAudio className="h-8 w-8 mx-auto text-muted-foreground/50 mb-1.5" />
              <p className="font-medium">No audio recording attached to this call record.</p>
              <p className="text-[10px] opacity-75 mt-0.5">
                Voice provider recording may still be generating or was disabled.
              </p>
            </div>
          )}
        </div>

        {/* 3. AI Summary / Notes (If available) */}
        {callNotes && (
          <div className="p-3.5 rounded-xl bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200/60 dark:border-orange-900/50 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> AI Call Summary / Notes
            </p>
            <p className="text-xs text-foreground font-medium leading-relaxed">
              {callNotes}
            </p>
          </div>
        )}

        {/* 4. Interactive Dialogue Transcript Section */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Conversation Transcript
              </h4>
              <Badge variant="secondary" className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20">
                {parsedTurns.length} turns
              </Badge>

              {/* Language / Script Toggle (Roman Urdu / Urdu script) */}
              <div className="inline-flex items-center rounded-lg border border-border/70 p-0.5 bg-muted/40 ml-1">
                <button
                  type="button"
                  onClick={() => setTranscriptLanguageView("roman")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1",
                    transcriptLanguageView === "roman"
                      ? "bg-background text-orange-600 dark:text-orange-400 shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Show transcript in Roman Urdu / English"
                >
                  <Languages className="h-3 w-3" />
                  <span>Roman</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTranscriptLanguageView("urdu")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1",
                    transcriptLanguageView === "urdu"
                      ? "bg-background text-orange-600 dark:text-orange-400 shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Show transcript in Urdu script (اردو)"
                >
                  <span className="font-medium">اردو</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {parsedTurns.length > 3 && (
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search in transcript..."
                    className="h-7 w-36 sm:w-44 pl-8 pr-2 text-xs rounded-lg border border-border/70 bg-background focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {parsedTurns.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={scrollToTop}
                    title="Scroll to top"
                    className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={scrollToBottom}
                    title="Scroll to bottom"
                    className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? "Collapse height" : "Expand full transcript"}
                    className="h-7 px-2 text-xs gap-1 font-semibold rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                    <span className="hidden sm:inline">{isExpanded ? "Collapse" : "Expand All"}</span>
                  </Button>
                </>
              )}

              {fullTranscriptString && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyTranscript}
                  className="h-7 text-xs px-2.5 gap-1.5 font-semibold rounded-lg"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </Button>
              )}
            </div>
          </div>

          {filteredTurns.length > 0 ? (
            <div className="space-y-2">
              <div
                ref={transcriptContainerRef}
                className={cn(
                  "rounded-xl border border-border/70 bg-background/60 p-4 space-y-3.5 pr-3 transition-all overflow-y-auto select-text",
                  isExpanded ? "h-auto max-h-none" : "h-[480px] max-h-[500px]",
                  "[scrollbar-width:thin] [scrollbar-color:#ea580c_rgba(0,0,0,0.05)]",
                  "[&::-webkit-scrollbar]:w-2.5",
                  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-orange-500 hover:[&::-webkit-scrollbar-thumb]:bg-orange-600",
                  "[&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full"
                )}
              >
                {filteredTurns.map((turn, idx) => {
                  const isAgent =
                    turn.speaker === "agent" ||
                    turn.speaker === "ai" ||
                    turn.speaker === "bot" ||
                    turn.speaker === "assistant";

                  return (
                    <div
                      key={turn.id || idx}
                      className={cn(
                        "flex gap-3 p-3.5 rounded-2xl max-w-[94%] transition-all",
                        isAgent
                          ? "mr-auto bg-orange-50/90 dark:bg-orange-950/40 border border-orange-200/60 dark:border-orange-900/40 rounded-tl-sm shadow-2xs"
                          : "ml-auto bg-muted/60 dark:bg-muted/40 border border-border/60 rounded-tr-sm shadow-2xs"
                      )}
                    >
                      <div
                        className={cn(
                          "h-7 w-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs",
                          isAgent
                            ? "bg-orange-500 text-white"
                            : "bg-muted-foreground/20 text-foreground"
                        )}
                      >
                        {isAgent ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                      </div>

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-xs font-bold",
                              isAgent ? "text-orange-700 dark:text-orange-400" : "text-foreground"
                            )}
                          >
                            {isAgent ? "AI Voice Agent" : "Customer"}
                          </span>

                          {turn.timestamp && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {turn.timestamp.includes(":") ? turn.timestamp : formatTimeOnly(turn.timestamp)}
                            </span>
                          )}
                        </div>

                        <p
                          dir={transcriptLanguageView === "urdu" ? "rtl" : "ltr"}
                          className={cn(
                            "text-xs leading-relaxed whitespace-pre-wrap",
                            transcriptLanguageView === "urdu"
                              ? "text-foreground font-medium text-[13px] leading-loose"
                              : "text-foreground"
                          )}
                        >
                          {transcriptLanguageView === "urdu"
                            ? toUrduScript(turn.message)
                            : cleanUrduText(turn.message)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground font-medium">
                <span>
                  Showing {filteredTurns.length} of {parsedTurns.length} dialogue turns
                </span>
                {!isExpanded && parsedTurns.length > 5 && (
                  <span className="text-orange-600 dark:text-orange-400 font-semibold cursor-pointer hover:underline" onClick={() => setIsExpanded(true)}>
                    Scroll to view all ↓ or click Expand
                  </span>
                )}
              </div>
            </div>
          ) : call?.transcript ? (
            <div
              ref={transcriptContainerRef}
              className={cn(
                "rounded-xl border border-border/70 bg-background/60 p-4 overflow-y-auto select-text",
                isExpanded ? "h-auto max-h-none" : "h-[350px] max-h-[400px]",
                "[scrollbar-width:thin] [scrollbar-color:#ea580c_rgba(0,0,0,0.05)]",
                "[&::-webkit-scrollbar]:w-2.5",
                "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-orange-500 hover:[&::-webkit-scrollbar-thumb]:bg-orange-600",
                "[&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full"
              )}
            >
              <pre
                dir={transcriptLanguageView === "urdu" ? "rtl" : "ltr"}
                className={cn(
                  "text-xs whitespace-pre-wrap leading-relaxed",
                  transcriptLanguageView === "urdu"
                    ? "text-foreground font-sans text-sm leading-loose"
                    : "font-mono text-foreground"
                )}
              >
                {transcriptLanguageView === "urdu"
                  ? toUrduScript(call.transcript)
                  : cleanUrduText(call.transcript)}
              </pre>
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-dashed border-border/60 text-center text-xs text-muted-foreground space-y-1">
              <MessageSquare className="h-6 w-6 mx-auto opacity-40 mb-1" />
              <p className="font-semibold">No transcript recorded for this call.</p>
              <p className="text-[11px] opacity-75">
                The conversation text was not captured or is still processing.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default OrderCallRecording;
