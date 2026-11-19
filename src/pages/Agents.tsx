import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  RefreshCw,
  Star,
  CheckCircle2,
  ExternalLink,
  PhoneCall,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AgentEditDialog, type AgentEditorValue } from "@/components/agents/AgentEditDialog";
import { AgentDetailsPanel } from "@/components/agents/AgentDetailsPanel";
import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";

type AgentRow = {
  id: string;
  name: string;
  elevenlabs_agent_id: string;
  description?: string | null;
  voice_id?: string | null;
  system_prompt_template?: string | null;
  is_default?: boolean;
  is_active?: boolean;
};

export default function Agents() {
  const { t } = useTranslation(["calls", "common"]);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [testAgent, setTestAgent] = useState<AgentRow | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testFirstMessage, setTestFirstMessage] = useState("");
  const [calling, setCalling] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; initial: AgentEditorValue | null }>({
    open: false,
    initial: null,
  });
  const [confirmDelete, setConfirmDelete] = useState<AgentRow | null>(null);

  const handleTestCall = async () => {
    if (!testAgent) return;
    const phone = testPhone.trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      toast.error("Enter phone in E.164 format, e.g. +14155551234");
      return;
    }
    setCalling(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent-test-call", {
        body: {
          agentId: testAgent.id,
          to: phone,
          firstMessage: testFirstMessage.trim() || undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Call failed");
      toast.success(`Calling ${phone} with ${testAgent.name}…`);
      setTestAgent(null);
      setTestPhone("");
      setTestFirstMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start test call");
    } finally {
      setCalling(false);
    }
  };

  const { data: agents, isLoading } = useQuery({
    queryKey: ["ai-agents-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return data as AgentRow[];
    },
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("ai_agents").update({ is_default: false }).neq("id", id);
      const { error } = await supabase.from("ai_agents").update({ is_default: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default agent updated");
      qc.invalidateQueries({ queryKey: ["ai-agents-full"] });
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAgent = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("elevenlabs-agent-crud", {
        body: { action: "delete", id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Delete failed");
    },
    onSuccess: () => {
      toast.success("Agent deleted from ElevenLabs");
      qc.invalidateQueries({ queryKey: ["ai-agents-full"] });
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      setConfirmDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-sync-agents");
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sync failed");
      toast.success(
        `Synced ${data.total} agent(s) — ${data.inserted} new, ${data.updated} updated`,
      );
      qc.invalidateQueries({ queryKey: ["ai-agents-full"] });
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const openEdit = (a: AgentRow) =>
    setEditor({
      open: true,
      initial: {
        id: a.id,
        name: a.name,
        description: a.description ?? "",
        voice_id: a.voice_id ?? null,
        system_prompt: a.system_prompt_template ?? "",
        first_message: "",
      },
    });

  const openCreate = () =>
    setEditor({
      open: true,
      initial: { name: "", description: "", voice_id: null, system_prompt: "", first_message: "" },
    });

  const activeAgents = agents?.filter((a) => a.is_active) ?? [];
  const inactiveAgents = agents?.filter((a) => !a.is_active) ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("calls:agents", "AI Agents")}
        description="Sync, edit, create, and delete ElevenLabs agents directly from your dashboard"
        icon={<Bot className="h-5 w-5" />}
        actions={
          <>
            <Button onClick={openCreate} variant="outline" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" /> {t("common:add", "New agent")}
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="gradient-primary text-primary-foreground w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? t("calls:syncing", "Syncing...") : t("calls:syncElevenLabs", "Sync from ElevenLabs")}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("common:loading", "Loading agents...")}
          </CardContent>
        </Card>
      ) : activeAgents.length === 0 ? (
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="space-y-3 py-12 text-center">
            <Bot className="mx-auto h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-medium">No agents synced yet</p>
              <p className="text-sm text-muted-foreground">
                Click "Sync from ElevenLabs" to import agents, or "New agent" to create one
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeAgents.map((agent) => (
            <Card
              key={agent.id}
              className={cn(
                "overflow-hidden rounded-2xl border border-border/80 shadow-xs",
                agent.is_default && "border-primary ring-1 ring-primary/30",
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot className="h-5 w-5 text-primary shrink-0" />
                    <CardTitle className="text-base truncate">{agent.name}</CardTitle>
                  </div>
                  {agent.is_default && (
                    <Badge className="gap-1 shrink-0">
                      <Star className="h-3 w-3" /> Default
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs font-mono truncate">
                  {agent.elevenlabs_agent_id}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {agent.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {agent.description}
                  </p>
                )}
                {agent.elevenlabs_agent_id !== "__USE_ENV__" && (
                  <AgentDetailsPanel agentId={agent.id} />
                )}

                <div className="flex items-center gap-1 pt-2">
                  {agent.is_default ? (
                    <Button variant="outline" size="sm" disabled className="flex-1">
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Default
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setDefault.mutate(agent.id)}
                      disabled={setDefault.isPending}
                    >
                      <Star className="h-4 w-4 mr-1" /> Set default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(agent)} title={t("common:edit", "Edit")}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(agent)}
                    title={t("common:delete", "Delete")}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                  <Button asChild size="sm" variant="ghost" title="Open in ElevenLabs">
                    <a
                      href={`https://elevenlabs.io/app/conversational-ai/agents/${agent.elevenlabs_agent_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    setTestAgent({
                      id: agent.id,
                      name: agent.name,
                      elevenlabs_agent_id: agent.elevenlabs_agent_id,
                    })
                  }
                  disabled={agent.elevenlabs_agent_id === "__USE_ENV__"}
                >
                  <PhoneCall className="h-4 w-4 mr-1" /> Test call
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {inactiveAgents.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Inactive ({inactiveAgents.length}) — no longer in ElevenLabs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {inactiveAgents.map((a) => (
              <div key={a.id} className="text-xs p-2 bg-muted rounded flex justify-between">
                <span>{a.name}</span>
                <button
                  className="text-destructive hover:underline"
                  onClick={() => setConfirmDelete(a)}
                >
                  {t("common:delete", "Remove")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How agent management works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            • <strong>Edit</strong> changes name, voice, system prompt &amp; first message — pushed
            to ElevenLabs and synced locally.
          </p>
          <p>
            • <strong>New agent</strong> creates a fresh agent in your ElevenLabs workspace.
          </p>
          <p>
            • <strong>Delete</strong> removes the agent from both your dashboard and ElevenLabs
            (irreversible).
          </p>
          <p>
            • <strong>Sync</strong> pulls the latest from ElevenLabs and marks deleted agents
            inactive.
          </p>
        </CardContent>
      </Card>

      {/* Edit / Create dialog */}
      <AgentEditDialog
        open={editor.open}
        initial={editor.initial}
        onOpenChange={(o) => setEditor({ open: o, initial: o ? editor.initial : null })}
      />

      {/* Delete confirm */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent?</DialogTitle>
            <DialogDescription>
              This permanently deletes <strong>{confirmDelete?.name}</strong> from ElevenLabs and
              your dashboard. Calls already in progress are unaffected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t("common:cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteAgent.mutate(confirmDelete.id)}
              disabled={deleteAgent.isPending}
            >
              {deleteAgent.isPending ? "Deleting…" : t("common:delete", "Delete permanently")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test call dialog */}
      <Dialog
        open={!!testAgent}
        onOpenChange={(o) => {
          if (!o) {
            setTestAgent(null);
            setTestPhone("");
            setTestFirstMessage("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test call with {testAgent?.name}</DialogTitle>
            <DialogDescription>
              Place a one-off outbound call from your Twilio number using this specific agent.
              Enter the destination phone in E.164 format (e.g. +14155551234).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="test-phone">{t("common:phone", "Phone number")}</Label>
              <Input
                id="test-phone"
                placeholder="+14155551234"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-first">First message (optional)</Label>
              <Input
                id="test-first"
                placeholder="Override the agent's opening line…"
                value={testFirstMessage}
                onChange={(e) => setTestFirstMessage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestAgent(null)} disabled={calling}>
              {t("common:cancel", "Cancel")}
            </Button>
            <Button onClick={handleTestCall} disabled={calling}>
              <PhoneCall className="h-4 w-4 mr-1" />
              {calling ? "Calling…" : "Call now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

