import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Phone, Clock, UserPlus, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, subDays, startOfDay, eachDayOfInterval, eachHourOfInterval, subHours, startOfHour, isSameHour, isSameDay } from "date-fns";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

type Period = "24h" | "7d" | "30d" | "90d";

const PERIOD_DAYS: Record<Period, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

const STATUS_COLORS: Record<string, string> = {
  new: "hsl(var(--primary))",
  contacted: "hsl(var(--muted-foreground))",
  qualified: "hsl(var(--status-available))",
  proposal: "hsl(var(--status-on-call))",
  negotiation: "hsl(var(--priority-medium))",
  won: "hsl(var(--status-available))",
  lost: "hsl(var(--destructive))",
};

export default function Analytics() {
  const { t } = useTranslation(["dashboard", "calls", "reports", "common"]);
  const [period, setPeriod] = useState<Period>("7d");
  const days = PERIOD_DAYS[period];
  const isHourly = period === "24h";
  const since = useMemo(
    () => (isHourly ? startOfHour(subHours(new Date(), 23)) : startOfDay(subDays(new Date(), days - 1))).toISOString(),
    [days, isHourly]
  );
  const prevSince = useMemo(
    () => (isHourly ? startOfHour(subHours(new Date(), 47)) : startOfDay(subDays(new Date(), days * 2 - 1))).toISOString(),
    [days, isHourly]
  );

  const { data: callsData } = useQuery({
    queryKey: ["analytics-calls", period],
    queryFn: async () => {
      const { data } = await supabase
        .from("calls")
        .select("created_at,status,direction,duration_seconds")
        .gte("created_at", prevSince);
      return data || [];
    },
    refetchInterval: 60000,
  });

  const { data: leadsData } = useQuery({
    queryKey: ["analytics-leads", period],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("status,created_at")
        .gte("created_at", prevSince);
      return data || [];
    },
    refetchInterval: 60000,
  });

  const { data: dialerLeads } = useQuery({
    queryKey: ["analytics-dialer", period],
    queryFn: async () => {
      const { data } = await supabase
        .from("auto_dialer_leads")
        .select("call_status,interest_level,created_at")
        .gte("created_at", prevSince);
      return data || [];
    },
    refetchInterval: 60000,
  });

  const stats = useMemo(() => {
    const calls = callsData || [];
    const current = calls.filter(c => c.created_at && c.created_at >= since);
    const previous = calls.filter(c => c.created_at && c.created_at < since);

    const totalCalls = current.length;
    const prevTotal = previous.length;
    const callsChange = prevTotal > 0 ? ((totalCalls - prevTotal) / prevTotal) * 100 : 0;

    const completed = current.filter(c => c.status === "completed");
    const avgDuration = completed.length > 0
      ? Math.round(completed.reduce((a, c) => a + (c.duration_seconds || 0), 0) / completed.length)
      : 0;
    const prevCompleted = previous.filter(c => c.status === "completed");
    const prevAvgDuration = prevCompleted.length > 0
      ? Math.round(prevCompleted.reduce((a, c) => a + (c.duration_seconds || 0), 0) / prevCompleted.length)
      : 0;
    const durChange = prevAvgDuration > 0 ? ((avgDuration - prevAvgDuration) / prevAvgDuration) * 100 : 0;

    const completionRate = totalCalls > 0 ? (completed.length / totalCalls) * 100 : 0;
    const prevCompletionRate = prevTotal > 0 ? (prevCompleted.length / prevTotal) * 100 : 0;
    const compRateChange = completionRate - prevCompletionRate;

    const leads = leadsData || [];
    const currentLeads = leads.filter(l => l.created_at && l.created_at >= since);
    const prevLeads = leads.filter(l => l.created_at && l.created_at < since);
    const leadsChange = prevLeads.length > 0 ? ((currentLeads.length - prevLeads.length) / prevLeads.length) * 100 : 0;

    return {
      totalCalls, callsChange,
      avgDuration, durChange,
      completionRate, compRateChange,
      leadsCount: currentLeads.length, leadsChange,
    };
  }, [callsData, leadsData, since]);

  const dailyVolume = useMemo(() => {
    const calls = (callsData || []).filter(c => c.created_at && c.created_at >= since);
    const leads = (leadsData || []).filter(l => l.created_at && l.created_at >= since);

    if (isHourly) {
      const now = new Date();
      const range = eachHourOfInterval({ start: subHours(startOfHour(now), 23), end: startOfHour(now) });
      return range.map(hour => ({
        name: format(hour, "HH:00"),
        calls: calls.filter(c => c.created_at && isSameHour(new Date(c.created_at), hour)).length,
        leads: leads.filter(l => l.created_at && isSameHour(new Date(l.created_at), hour)).length,
      }));
    }

    const range = eachDayOfInterval({ start: subDays(new Date(), days - 1), end: new Date() });
    return range.map(day => ({
      name: days <= 7 ? format(day, "EEE") : format(day, "MMM d"),
      calls: calls.filter(c => c.created_at && isSameDay(new Date(c.created_at), day)).length,
      leads: leads.filter(l => l.created_at && isSameDay(new Date(l.created_at), day)).length,
    }));
  }, [callsData, leadsData, since, days, isHourly]);

  const hourlyDistribution = useMemo(() => {
    const calls = (callsData || []).filter(c => c.created_at && c.created_at >= since);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, calls: 0 }));
    calls.forEach(c => {
      if (!c.created_at) return;
      const h = new Date(c.created_at).getHours();
      buckets[h].calls++;
    });
    // For 24h view show all hours; otherwise focus on business hours where activity concentrates
    return isHourly ? buckets : buckets.filter((_, i) => i >= 7 && i <= 20);
  }, [callsData, since, isHourly]);

  const leadsByStatus = useMemo(() => {
    const leads = (leadsData || []).filter(l => l.created_at && l.created_at >= since);
    const map = new Map<string, number>();
    leads.forEach(l => {
      const s = l.status || "new";
      map.set(s, (map.get(s) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({
      name, value, color: STATUS_COLORS[name] || "hsl(var(--muted-foreground))",
    }));
  }, [leadsData, since]);

  const dialerOutcomes = useMemo(() => {
    const leads = (dialerLeads || []).filter(l => l.created_at && l.created_at >= since);
    const map = new Map<string, number>();
    leads.forEach(l => {
      const s = l.call_status || "pending";
      map.set(s, (map.get(s) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [dialerLeads, since]);

  const fmtDuration = (s: number) =>
    s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "0:00";

  const ChangeIndicator = ({ value, suffix = "%" }: { value: number; suffix?: string }) => {
    const isUp = value >= 0;
    const Icon = isUp ? TrendingUp : TrendingDown;
    return (
      <div className={`flex items-center gap-1 mt-1 text-sm ${isUp ? "text-status-available" : "text-destructive"}`}>
        <Icon className="h-4 w-4" />
        <span>{isUp ? "+" : ""}{value.toFixed(1)}{suffix}</span>
      </div>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t("dashboard:analytics", "Analytics")}
        description={t("reports:subtitle", "Real-time performance metrics")}
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">{t("reports:last24Hours", "Last 24 hours")}</SelectItem>
              <SelectItem value="7d">{t("reports:last7Days", "Last 7 days")}</SelectItem>
              <SelectItem value="30d">{t("reports:last30Days", "Last 30 days")}</SelectItem>
              <SelectItem value="90d">{t("reports:last90Days", "Last 90 days")}</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:totalCalls", "Total Calls")}</p>
                <p className="text-2xl font-bold">{stats.totalCalls}</p>
                <ChangeIndicator value={stats.callsChange} />
              </div>
              <div className="p-3 rounded-lg gradient-primary">
                <Phone className="h-6 w-6 text-primary-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:averageDuration", "Avg Handle Time")}</p>
                <p className="text-2xl font-bold">{fmtDuration(stats.avgDuration)}</p>
                <ChangeIndicator value={stats.durChange} />
              </div>
              <div className="p-3 rounded-lg bg-status-available/10">
                <Clock className="h-6 w-6 text-status-available" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:successRate", "Completion Rate")}</p>
                <p className="text-2xl font-bold">{stats.completionRate.toFixed(1)}%</p>
                <ChangeIndicator value={stats.compRateChange} suffix="pp" />
              </div>
              <div className="p-3 rounded-lg bg-status-on-call/10">
                <Target className="h-6 w-6 text-status-on-call" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("calls:newToday", "New Leads")}</p>
                <p className="text-2xl font-bold">{stats.leadsCount}</p>
                <ChangeIndicator value={stats.leadsChange} />
              </div>
              <div className="p-3 rounded-lg bg-priority-medium/10">
                <UserPlus className="h-6 w-6 text-priority-medium" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{isHourly ? "Calls & Leads (Hourly, last 24h)" : "Calls & Leads (Daily)"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyVolume}>
                  <defs>
                    <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--status-available))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--status-available))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Legend />
                  <Area type="monotone" dataKey="calls" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorCalls)" />
                  <Area type="monotone" dataKey="leads" stroke="hsl(var(--status-available))" strokeWidth={2} fill="url(#colorLeads)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hourly Call Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyDistribution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="hour" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Leads by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {leadsByStatus.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No lead data in this period</p>
            ) : (
              <>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={leadsByStatus} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                        {leadsByStatus.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mt-4">
                  {leadsByStatus.map((c) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-sm capitalize">{c.name}</span>
                      </div>
                      <span className="text-sm font-medium">{c.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auto-Dialer Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            {dialerOutcomes.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No auto-dialer activity in this period</p>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dialerOutcomes} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis dataKey="name" type="category" className="text-xs" width={100} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
