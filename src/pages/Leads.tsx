import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Search,
  Filter,
  Phone,
  Mail,
  Building2,
  MessageSquare,
  UserPlus,
  CheckCircle2,
  PhoneCall,
  UserCheck,
} from "lucide-react";
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
import { LeadDetailDialog } from "@/components/leads/LeadDetailDialog";
import { formatDistanceToNow } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { formatDate } from "@/i18n/formatters";

type Lead = Tables<"leads">;

type LeadEnrichment = {
  agent_name: string | null;
  last_called_at: string | null;
  callback_requested: boolean;
  callback_at: string | null;
  call_status: string | null;
  interest_level: string | null;
  callback_reason: string | null;
  ai_summary: string | null;
};

const statusColors: Record<string, string> = {
  new: "bg-blue-500 text-white",
  contacted: "bg-yellow-500 text-white",
  qualified: "bg-green-500 text-white",
  proposal: "bg-purple-500 text-white",
  negotiation: "bg-orange-500 text-white",
  won: "bg-status-available text-white",
  lost: "bg-destructive text-white",
};

export default function Leads() {
  const { t } = useTranslation(["calls", "common"]);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [interestFilter, setInterestFilter] = useState<string>("all");
  const [relevanceFilter, setRelevanceFilter] = useState<string>("engaged");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", statusFilter, sourceFilter],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as Lead["status"]);
      }
      if (sourceFilter !== "all") {
        query = query.eq("source", sourceFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Lead[];
    },
    refetchInterval: 30000,
  });

  // Fetch enrichment from auto_dialer_leads (assigned agent, last contact, callback)
  const { data: enrichmentMap = {} } = useQuery({
    queryKey: ["leads-enrichment", leads.map((l) => l.id).join(",")],
    enabled: leads.length > 0,
    queryFn: async () => {
      const ids = leads.map((l) => l.id);
      const { data, error } = await supabase
        .from("auto_dialer_leads")
        .select(
          "converted_lead_id, called_at, callback_requested, callback_at, callback_reason, call_status, interest_level, ai_summary, session_id, auto_dialer_sessions(agent_id, ai_agents(name))"
        )
        .in("converted_lead_id", ids)
        .order("called_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, LeadEnrichment> = {};
      for (const row of (data || []) as any[]) {
        const lid = row.converted_lead_id;
        if (!lid) continue;
        const existing = map[lid];
        const entry: LeadEnrichment = {
          agent_name: row.auto_dialer_sessions?.ai_agents?.name ?? null,
          last_called_at: row.called_at ?? null,
          callback_requested: !!row.callback_requested,
          callback_at: row.callback_at ?? null,
          call_status: row.call_status ?? null,
          interest_level: row.interest_level ?? null,
          callback_reason: row.callback_reason ?? null,
          ai_summary: row.ai_summary ?? null,
        };
        if (!existing) {
          map[lid] = entry;
        } else {
          if (entry.last_called_at && (!existing.last_called_at || entry.last_called_at > existing.last_called_at)) {
            existing.last_called_at = entry.last_called_at;
            existing.agent_name = entry.agent_name ?? existing.agent_name;
            existing.call_status = entry.call_status ?? existing.call_status;
            existing.interest_level = entry.interest_level ?? existing.interest_level;
            existing.callback_reason = entry.callback_reason ?? existing.callback_reason;
            existing.ai_summary = entry.ai_summary ?? existing.ai_summary;
          }
          existing.callback_requested = existing.callback_requested || entry.callback_requested;
          existing.callback_at = existing.callback_at || entry.callback_at;
          existing.callback_reason = existing.callback_reason || entry.callback_reason;
          existing.ai_summary = existing.ai_summary || entry.ai_summary;
        }
      }
      return map;
    },
    refetchInterval: 30000,
  });

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("Lead ID copied");
  };

  const getLeadEvidenceText = (lead: Lead) => {
    const enrich = enrichmentMap[lead.id];
    return [lead.notes, enrich?.ai_summary, enrich?.callback_reason, enrich?.interest_level, enrich?.call_status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  };

  const hasAutomatedOrNoAnswerMarkers = (text: string) => {
    return [
      "pending ai re-analysis",
      "[auto-reclassified",
      "auto-dialer reclassified",
      "engaged_no_commit",
      "voicemail",
      "voice mail",
      "answering machine",
      "automated message",
      "automated greeting",
      "after the tone",
      "after the beep",
      "leave a message",
      "quality assurance purposes",
      "recorded for quality assurance",
      "no one is available",
      "did not respond",
      "no response",
      "stuck on hold",
      "ivr",
      "dial extension",
      "enter extension",
      "press 1",
      "press one",
      "music from the user's end",
      "did not progress beyond",
      "reception team",
      "busy",
      "no answer",
      "not answered",
    ].some((marker) => text.includes(marker));
  };

  // Derive interest signals from validated conversation evidence only.
  const getInterest = (lead: Lead): "interested" | "not_interested" | "callback" | "neutral" => {
    const enrich = enrichmentMap[lead.id];
    const text = getLeadEvidenceText(lead);
    const callbackSignal =
      enrich?.interest_level === "callback" ||
      text.includes("call back") ||
      text.includes("callback later") ||
      text.includes("call later");

    if (text.includes("not interested") || text.includes("not_interested") || lead.status === "lost") {
      return "not_interested";
    }

    if (hasAutomatedOrNoAnswerMarkers(text)) {
      return "neutral";
    }

    if (["qualified", "proposal", "negotiation", "won"].includes(lead.status || "")) {
      return "interested";
    }

    if (lead.source === "auto_dialer") {
      if (enrich?.interest_level === "interested") return "interested";
      if (callbackSignal) return "callback";
      return "neutral";
    }

    if (enrich?.interest_level === "interested") return "interested";
    if (callbackSignal) return "callback";
    if (text.includes("interested") || text.includes("engaged")) return "interested";

    return "neutral";
  };

  // Relevance: only show leads where a real person answered and showed intent.
  const isRelevant = (lead: Lead): boolean => {
    const enrich = enrichmentMap[lead.id];
    const interest = getInterest(lead);
    const text = getLeadEvidenceText(lead);

    if (interest === "not_interested" || lead.status === "lost") return false;
    if (hasAutomatedOrNoAnswerMarkers(text)) return false;
    if (["qualified", "proposal", "negotiation", "won"].includes(lead.status || "")) return true;

    if (lead.source === "auto_dialer") {
      const answeredByHuman = Boolean(enrich?.last_called_at) && enrich?.call_status === "completed";
      const classifierConfirmedIntent = enrich?.interest_level === "interested" || enrich?.interest_level === "callback";
      return answeredByHuman && classifierConfirmedIntent && (interest === "interested" || interest === "callback");
    }

    return interest === "interested" || interest === "callback";
  };

  const convertToCustomer = async (lead: Lead) => {
    setConvertingId(lead.id);
    try {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("phone_number", lead.phone_number)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("customers")
          .update({
            full_name: lead.full_name,
            email: lead.email,
            company: lead.company,
            notes: lead.notes,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("customers").insert({
          phone_number: lead.phone_number,
          full_name: lead.full_name,
          email: lead.email,
          company: lead.company,
          notes: lead.notes,
        });
      }

      const { error: leadErr } = await supabase
        .from("leads")
        .update({ status: "won" })
        .eq("id", lead.id);
      if (leadErr) throw leadErr;

      toast.success(`${lead.full_name || "Lead"} converted to customer`);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to convert lead");
    } finally {
      setConvertingId(null);
    }
  };

  const relevantLeads = useMemo(() => leads.filter((lead) => isRelevant(lead)), [leads, enrichmentMap]);

  const filteredLeads = useMemo(() => {
    const baseLeads = relevanceFilter === "engaged" ? relevantLeads : leads;

    return baseLeads.filter((lead) => {
      if (interestFilter !== "all" && getInterest(lead) !== interestFilter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        lead.full_name?.toLowerCase().includes(q) ||
        lead.email?.toLowerCase().includes(q) ||
        lead.phone_number?.toLowerCase().includes(q) ||
        lead.company?.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, relevantLeads, searchQuery, interestFilter, relevanceFilter]);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const interested = leads.filter((l) => getInterest(l) === "interested").length;
    const callbacks = leads.filter((l) => getInterest(l) === "callback").length;
    const contacted = leads.filter((l) =>
      ["contacted", "qualified", "proposal", "negotiation", "won"].includes(l.status || "")
    ).length;
    const newToday = leads.filter((l) => l.created_at && new Date(l.created_at) >= today).length;
    return { interested, callbacks, contacted, newToday };
  }, [leads]);

  return (
    <PageShell>
      <PageHeader
        title={t("calls:leadsTitle", "Leads")}
        description={t("calls:leadsSubtitle", "Manage inbound and auto-dialer leads")}
        icon={<Users className="h-5 w-5" />}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:totalLeads", "Total Leads")}</p>
                <p className="text-2xl font-bold">{leads.length}</p>
              </div>
              <Users className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:newToday", "New Today")}</p>
                <p className="text-2xl font-bold">{stats.newToday}</p>
              </div>
              <UserPlus className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:contacted", "Contacted")}</p>
                <p className="text-2xl font-bold">{stats.contacted}</p>
              </div>
              <PhoneCall className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:interested", "Interested")}</p>
                <p className="text-2xl font-bold">{stats.interested}</p>
                {stats.callbacks > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">+{stats.callbacks} {t("calls:callbacks", "callbacks")}</p>
                )}
              </div>
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leads Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("calls:allLeads", "All Leads")}</CardTitle>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("calls:searchLeads", "Search leads...")}
                  className="pl-10 w-[250px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[170px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("calls:leadSource", "Source")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("calls:allSources", "All Sources")}</SelectItem>
                  <SelectItem value="inbound_call">{t("calls:inboundCall", "Inbound Call")}</SelectItem>
                  <SelectItem value="auto_dialer">{t("calls:autoDialerSource", "Auto-Dialer (Hot)")}</SelectItem>
                  <SelectItem value="outbound_campaign">{t("calls:outboundCampaign", "Outbound Campaign")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("common:status", "Status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("calls:allStatus", "All Status")}</SelectItem>
                  <SelectItem value="new">{t("calls:leadNew", "New")}</SelectItem>
                  <SelectItem value="contacted">{t("calls:leadContacted", "Contacted")}</SelectItem>
                  <SelectItem value="qualified">{t("calls:leadQualified", "Qualified")}</SelectItem>
                  <SelectItem value="proposal">{t("calls:leadProposal", "Proposal")}</SelectItem>
                  <SelectItem value="negotiation">{t("calls:leadNegotiation", "Negotiation")}</SelectItem>
                  <SelectItem value="won">{t("calls:leadWon", "Won")}</SelectItem>
                  <SelectItem value="lost">{t("calls:leadLost", "Lost")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={interestFilter} onValueChange={setInterestFilter}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("calls:interestNotes", "Interest")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("calls:anyInterest", "Any interest")}</SelectItem>
                  <SelectItem value="interested">{t("calls:interestInterested", "Interested")}</SelectItem>
                  <SelectItem value="callback">{t("calls:interestCallback", "Callback")}</SelectItem>
                  <SelectItem value="not_interested">{t("calls:interestNotInterested", "Not interested")}</SelectItem>
                  <SelectItem value="neutral">{t("calls:interestNeutral", "Neutral")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={relevanceFilter} onValueChange={setRelevanceFilter}>
                <SelectTrigger className="w-[170px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("calls:relevance", "Relevance")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engaged">{t("calls:engagedOnly", "Engaged only")}</SelectItem>
                  <SelectItem value="all">{t("calls:showAllCold", "Show all (incl. cold)")}</SelectItem>
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
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("calls:noLeadsFound", "No leads found")}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("calls:leadId", "Lead ID")}</TableHead>
                  <TableHead>{t("common:name", "Name")}</TableHead>
                  <TableHead>{t("common:phone", "Contact")}</TableHead>
                  <TableHead>{t("calls:leadCompany", "Company")}</TableHead>
                  <TableHead>{t("calls:assignedAgent", "Assigned Agent")}</TableHead>
                  <TableHead>{t("calls:lastContact", "Last Contact")}</TableHead>
                  <TableHead>{t("calls:callback", "Callback")}</TableHead>
                  <TableHead>{t("calls:interestNotes", "Interest / Notes")}</TableHead>
                  <TableHead>{t("common:status", "Status")}</TableHead>
                  <TableHead>{t("calls:leadSource", "Source")}</TableHead>
                  <TableHead>{t("common:date", "Created")}</TableHead>
                  <TableHead>{t("common:actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => {
                  const enrich = enrichmentMap[lead.id];
                  const statusKeyMap: Record<string, string> = {
                    new: t("calls:leadNew", "New"),
                    contacted: t("calls:leadContacted", "Contacted"),
                    qualified: t("calls:leadQualified", "Qualified"),
                    proposal: t("calls:leadProposal", "Proposal"),
                    negotiation: t("calls:leadNegotiation", "Negotiation"),
                    won: t("calls:leadWon", "Won"),
                    lost: t("calls:leadLost", "Lost"),
                  };
                  return (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <TableCell>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyId(lead.id);
                        }}
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                        title={`${lead.id} (click to copy)`}
                      >
                        {lead.id.slice(0, 8)}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">
                      {lead.full_name || "Unknown"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {lead.phone_number}
                        </div>
                        {lead.email && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {lead.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {lead.company ? (
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {lead.company}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {enrich?.agent_name ? (
                        <span>{enrich.agent_name}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("calls:unassigned", "Unassigned")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {enrich?.last_called_at ? (
                        <span title={formatDate(enrich.last_called_at)}>
                          {formatDistanceToNow(new Date(enrich.last_called_at), { addSuffix: true })}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {enrich?.callback_requested ? (
                        <div className="space-y-1">
                          <Badge className="bg-yellow-500 text-white text-xs">{t("calls:interestCallback", "Requested")}</Badge>
                          {enrich.callback_at && (
                            <p className="text-xs text-muted-foreground">
                              {formatDate(enrich.callback_at)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      {(() => {
                        const interest = getInterest(lead);
                        const interestLabel = {
                          interested: { label: t("calls:interestInterested", "Interested"), cls: "bg-status-available text-white" },
                          callback: { label: t("calls:interestCallback", "Callback"), cls: "bg-yellow-500 text-white" },
                          not_interested: { label: t("calls:interestNotInterested", "Not interested"), cls: "bg-destructive text-white" },
                          neutral: { label: t("calls:interestNeutral", "Neutral"), cls: "bg-muted text-muted-foreground" },
                        }[interest];
                        return (
                          <div className="space-y-1">
                            <Badge className={`${interestLabel.cls} text-xs`}>{interestLabel.label}</Badge>
                            {lead.notes && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{lead.notes}</p>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[lead.status || "new"]}>
                        {statusKeyMap[lead.status || "new"] || lead.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {lead.source?.replace("_", " ") || "Unknown"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.created_at
                        ? formatDate(lead.created_at)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLead(lead);
                          }}
                          title="View details"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        {lead.status !== "won" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={convertingId === lead.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              convertToCustomer(lead);
                            }}
                            title="Convert to customer"
                          >
                            <UserCheck className="h-4 w-4 text-status-available" />
                          </Button>
                        )}
                      </div>
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


      {/* Lead Detail Dialog */}
      <LeadDetailDialog
        lead={selectedLead}
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
      />
    </PageShell>
  );
}
