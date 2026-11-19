import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PhoneIncoming, PhoneOutgoing, Loader2, Activity } from "lucide-react";
import { CallDetailDialog } from "@/components/calls/CallDetailDialog";
import { formatTime } from "@/i18n/formatters";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

function formatElapsed(start: string | null): string {
  if (!start) return "—";
  const sec = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
  if (sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Calls older than 15 min with no terminal status are considered stale
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
function isStale(start: string | null): boolean {
  if (!start) return false;
  return Date.now() - new Date(start).getTime() > STALE_THRESHOLD_MS;
}

export default function LiveQueue() {
  const { t } = useTranslation(["calls", "common"]);
  const [tick, setTick] = useState(0);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);

  // Force re-render every second so elapsed timers update
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: activeCalls, refetch: refetchActive } = useQuery({
    queryKey: ["live-queue-calls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select("*")
        .in("status", ["queued", "in_progress"])
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
  });

  const { data: pendingDialer, refetch: refetchPending } = useQuery({
    queryKey: ["live-queue-pending"],
    queryFn: async () => {
      const { count } = await supabase
        .from("auto_dialer_leads")
        .select("id", { count: "exact", head: true })
        .eq("call_status", "pending");
      return count || 0;
    },
    refetchInterval: 10000,
  });

  const { data: completedToday } = useQuery({
    queryKey: ["live-queue-today", tick > 0 ? Math.floor(tick / 60) : 0],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("calls")
        .select("direction")
        .gte("ended_at", start.toISOString())
        .eq("status", "completed");
      if (error) throw error;
      const inb = (data || []).filter((c) => c.direction === "inbound").length;
      const outb = (data || []).filter((c) => c.direction === "outbound").length;
      return { inb, outb };
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("live-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => {
        refetchActive();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_dialer_leads" }, () => {
        refetchPending();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchActive, refetchPending]);

  // Best-effort frontend sweep: if any visible call is stale (>15 min in_progress),
  // ping the active-conversations sync function so it cleans them up. The sweep
  // logic already exists server-side; this just nudges it on every page load.
  useEffect(() => {
    if (!activeCalls || activeCalls.length === 0) return;
    const hasStale = activeCalls.some((c) => isStale(c.started_at));
    if (!hasStale) return;
    supabase.functions
      .invoke("elevenlabs-sync-active-conversations", { body: {} })
      .catch(() => {});
  }, [activeCalls]);

  // Hide stale calls (>15 min stuck) from the active counts so the dashboard
  // doesn't show ghost activity from crashed/dropped calls.
  const liveCalls = (activeCalls || []).filter((c) => !isStale(c.started_at));
  const inboundActive = liveCalls.filter((c) => c.direction === "inbound");
  const outboundActive = liveCalls.filter((c) => c.direction === "outbound");

  return (
    <PageShell>
      <PageHeader
        title={t("calls:liveQueue", "Live Call Queue")}
        description="Real-time view of every active call across inbound and outbound channels."
        icon={<Activity className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Active Inbound</p>
                <p className="text-2xl font-bold">{inboundActive.length}</p>
              </div>
              <PhoneIncoming className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Active Outbound</p>
                <p className="text-2xl font-bold">{outboundActive.length}</p>
              </div>
              <PhoneOutgoing className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Auto-Dialer Queue</p>
                <p className="text-2xl font-bold">{pendingDialer ?? 0}</p>
              </div>
              <Loader2 className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="pt-6">
            <div>
              <p className="text-xs text-muted-foreground">{t("calls:todayCalls", "Completed Today")}</p>
              <p className="text-2xl font-bold">{(completedToday?.inb || 0) + (completedToday?.outb || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {completedToday?.inb || 0} in · {completedToday?.outb || 0} out
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <CardTitle>Currently In-Flight ({(activeCalls || []).length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {(!activeCalls || activeCalls.length === 0) ? (
            <p className="text-center text-muted-foreground py-8">{t("calls:noCalls", "No active calls right now.")}</p>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("calls:colDirection", "Direction")}</TableHead>
                  <TableHead>{t("calls:colPhone", "Phone")}</TableHead>
                  <TableHead>{t("common:status", "Status")}</TableHead>
                  <TableHead>{t("calls:duration", "Elapsed")}</TableHead>
                  <TableHead>{t("calls:colTime", "Started")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeCalls.map((c) => {
                  const stale = isStale(c.started_at);
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedCall(c)}>
                      <TableCell>
                        {c.direction === "inbound" ? (
                          <Badge variant="outline" className="gap-1"><PhoneIncoming className="h-3 w-3" /> In</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><PhoneOutgoing className="h-3 w-3" /> Out</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.phone_number}</TableCell>
                      <TableCell>
                        {stale ? (
                          <Badge variant="destructive">stale (auto-closing)</Badge>
                        ) : (
                          <Badge>{c.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {stale ? <span className="text-muted-foreground">—</span> : formatElapsed(c.started_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.started_at ? formatTime(c.started_at) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CallDetailDialog
        call={selectedCall}
        open={!!selectedCall}
        onOpenChange={(open) => !open && setSelectedCall(null)}
      />
    </PageShell>
  );
}

