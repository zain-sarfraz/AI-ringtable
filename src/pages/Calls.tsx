import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, Search, Filter, CheckCircle, XCircle, FileText, PlayCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CallDetailDialog } from "@/components/calls/CallDetailDialog";
import { formatDate, formatTime } from "@/i18n/formatters";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

type Call = Tables<"calls">;

export default function Calls() {
  const { t } = useTranslation(["calls", "common"]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [relevanceFilter, setRelevanceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const queryClient = useQueryClient();

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    queued: { label: t("calls:statusQueued", "Queued"), variant: "secondary" },
    in_progress: { label: t("calls:statusInProgress", "In Progress"), variant: "default" },
    completed: { label: t("calls:statusCompleted", "Completed"), variant: "outline" },
    missed: { label: t("calls:statusMissed", "Missed"), variant: "destructive" },
    transferred: { label: t("calls:statusTransferred", "Transferred"), variant: "secondary" },
  };

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("elevenlabs-sync-conversations");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Synced ${data.synced_calls} calls and ${data.synced_leads} leads from ElevenLabs`);
      queryClient.invalidateQueries({ queryKey: ["calls"] });
    },
    onError: (error) => {
      console.error("Sync error:", error);
      toast.error("Failed to sync from ElevenLabs");
    },
  });

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ["calls", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("calls")
        .select("*, leads(id, full_name, services_interested)")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as Call["status"]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as (Call & { leads: { id: string; full_name: string | null; services_interested: string[] | null } | null })[];
    },
  });

  // Filter by relevance (has lead = relevant, no lead = irrelevant)
  const filteredByRelevance = calls.filter((call) => {
    if (relevanceFilter === "all") return true;
    if (relevanceFilter === "relevant") return !!call.lead_id;
    if (relevanceFilter === "irrelevant") return !call.lead_id;
    return true;
  });

  const filteredCalls = filteredByRelevance.filter((call) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return call.phone_number?.toLowerCase().includes(query);
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCalls = calls.filter(
    (c) => c.created_at && new Date(c.created_at) >= todayStart
  );

  const inboundCount = todayCalls.filter((c) => c.direction === "inbound").length;
  const outboundCount = todayCalls.filter((c) => c.direction === "outbound").length;
  const avgDuration = todayCalls.length > 0
    ? Math.round(
        todayCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) /
          todayCalls.filter((c) => c.duration_seconds).length || 1
      )
    : 0;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <PageShell>
      <PageHeader
        title={t("calls:title", "Calls")}
        description={t("calls:subtitle", "View and manage all call activity")}
        icon={<Phone className="h-5 w-5" />}
        actions={
          <>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? t("calls:syncing", "Syncing...") : t("calls:syncElevenLabs", "Sync from ElevenLabs")}
            </Button>
            <Button className="gradient-primary text-primary-foreground w-full sm:w-auto">
              <Phone className="h-4 w-4 mr-2" />
              {t("calls:newCall", "New Call")}
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:todayCalls", "Today's Calls")}</p>
                <p className="text-2xl font-bold">{todayCalls.length}</p>
              </div>
              <Phone className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:inbound", "Inbound")}</p>
                <p className="text-2xl font-bold">{inboundCount}</p>
              </div>
              <PhoneIncoming className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:outbound", "Outbound")}</p>
                <p className="text-2xl font-bold">{outboundCount}</p>
              </div>
              <PhoneOutgoing className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:averageDuration", "Avg Duration")}</p>
                <p className="text-2xl font-bold">{formatDuration(avgDuration)}</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Calls Tabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle>{t("calls:callLogs", "Call Logs")}</CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("calls:searchCallsPlaceholder", "Search calls...")}
                  className="pl-10 w-[220px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={relevanceFilter} onValueChange={setRelevanceFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t("calls:relevance", "Relevance")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("calls:allCalls", "All Calls")}</SelectItem>
                  <SelectItem value="relevant">{t("calls:relevant", "Relevant")}</SelectItem>
                  <SelectItem value="irrelevant">{t("calls:irrelevant", "Irrelevant")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("common:status", "Status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common:all", "All Status")}</SelectItem>
                  <SelectItem value="queued">{t("calls:statusQueued", "Queued")}</SelectItem>
                  <SelectItem value="in_progress">{t("calls:statusInProgress", "In Progress")}</SelectItem>
                  <SelectItem value="completed">{t("calls:statusCompleted", "Completed")}</SelectItem>
                  <SelectItem value="missed">{t("calls:statusMissed", "Missed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("calls:noCalls", "No calls found")}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("calls:colPhone", "Phone Number")}</TableHead>
                  <TableHead>{t("calls:colDirection", "Direction")}</TableHead>
                  <TableHead>{t("calls:colRelevance", "Relevance")}</TableHead>
                  <TableHead>{t("common:status", "Status")}</TableHead>
                  <TableHead>{t("calls:duration", "Duration")}</TableHead>
                  <TableHead>{t("calls:recording", "Recording")}</TableHead>
                  <TableHead>{t("calls:transcript", "Transcript")}</TableHead>
                  <TableHead>{t("calls:colTime", "Time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCalls.map((call) => (
                  <TableRow
                    key={call.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCall(call)}
                  >
                    <TableCell className="font-medium">{call.phone_number}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {call.direction === "inbound" ? (
                          <PhoneIncoming className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <PhoneOutgoing className="h-4 w-4 text-primary" />
                        )}
                        <span className="capitalize">{call.direction === "inbound" ? t("calls:inbound", "Inbound") : t("calls:outbound", "Outbound")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {call.lead_id ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-green-600 text-sm">{t("calls:relevant", "Relevant")}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground text-sm">{t("calls:irrelevant", "Irrelevant")}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusConfig[call.status || "queued"]?.variant || "outline"}>
                        {statusConfig[call.status || "queued"]?.label || call.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {call.duration_seconds ? formatDuration(call.duration_seconds) : "-"}
                    </TableCell>
                    <TableCell>
                      {call.recording_url ? (
                        <div className="flex items-center gap-1.5">
                          <PlayCircle className="h-4 w-4 text-primary" />
                          <span className="text-primary text-sm">{t("common:available", "Available")}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t("common:none", "None")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {call.transcript ? (
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-4 w-4 text-primary" />
                          <span className="text-primary text-sm">{t("common:view", "View")}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t("common:none", "None")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {call.created_at
                        ? `${formatDate(call.created_at)} ${formatTime(call.created_at)}`
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Call Detail Dialog */}
      <CallDetailDialog
        call={selectedCall}
        open={!!selectedCall}
        onOpenChange={(open) => !open && setSelectedCall(null)}
      />
    </PageShell>
  );
}

