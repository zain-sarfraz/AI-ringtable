import { AiValuePanel } from "@/components/dashboard/AiValuePanel";
import { ReceptionistDashboard } from "@/components/dashboard/ReceptionistDashboard";
import { StaffDashboard } from "@/components/dashboard/StaffDashboard";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useAuth } from "@/hooks/useAuth";
import { usePermission } from "@/hooks/usePermission";
import {
    formatDate,
    formatNumber,
    getActiveLocale,
    getOrderStatusLabel,
} from "@/i18n/formatters";
import { supabase } from "@/integrations/supabase/client";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { formatCurrency } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
    eachDayOfInterval,
    format,
    isSameDay,
    parseISO,
    startOfDay,
    subDays,
} from "date-fns";
import {
    Activity,
    ArrowUpRight,
    BarChart3,
    Calendar,
    ChefHat,
    Clock,
    DollarSign,
    Filter,
    List,
    type LucideIcon,
    Settings,
    ShoppingBag,
    Store,
    Tag,
    Ticket,
    TrendingUp,
    Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from "recharts";

/* ─── Types ─────────────────────────────────────────────────── */
type SuperAdminDashboardData = {
    summary: {
        total_restaurants: number;
        active_restaurants: number;
        total_orders: number;
        pending_orders: number;
        total_revenue: number;
        total_customers: number;
    };
    monthly_revenue: { month: string; orders: number; revenue: number }[];
    restaurant_sales: { name: string; order_count: number; revenue: number }[];
    order_status: { status: string; count: number }[];
};

type RecentOrderRow = {
    id: string;
    order_number: string;
    tracking_code: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    delivery_address: string;
    total_amount: number;
    subtotal: number;
    tax_amount: number;
    delivery_fee: number;
    status: string;
    created_at: string;
    payment_method: string;
    payment_status: string;
    source: string;
    estimated_delivery_at: string | null;
};

const AVATAR_TONES = [
    "bg-orange-100 text-orange-800",
    "bg-amber-100 text-amber-800",
    "bg-stone-200 text-stone-700",
    "bg-slate-200 text-slate-700",
    "bg-rose-100 text-rose-800",
    "bg-yellow-100 text-yellow-800",
];

/* ─── Donut Chart (Order Status) ──────────────────────────────── */
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    delivered: { label: "Delivered", color: "#10b981" },
    completed: { label: "Completed", color: "#10b981" },
    out_for_delivery: { label: "Out For Delivery", color: "#06b6d4" },
    "out-for-delivery": { label: "Out For Delivery", color: "#06b6d4" },
    confirmed: { label: "Confirmed", color: "#3b82f6" },
    preparing: { label: "Preparing", color: "#8b5cf6" },
    pending: { label: "Pending", color: "#f59e0b" },
    cancelled: { label: "Cancelled", color: "#ef4444" },
    new: { label: "New", color: "#f97316" },
};

function DonutChart({ data }: { data: { status: string; count: number }[] }) {
    const { t } = useTranslation([
        "dashboard",
        "orders",
        "common",
        "superAdmin",
    ]);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const total = data.reduce((s, d) => s + d.count, 0);

    if (!total || !data.length) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                <Activity className="h-8 w-8 text-muted-foreground/30" />
                <p>
                    {t(
                        "superAdmin:noOrderDistribution",
                        "No order distribution data yet",
                    )}
                </p>
            </div>
        );
    }

    const chartData = data.map((d) => {
        const key = d.status.toLowerCase();
        const conf = STATUS_CONFIG[key];
        const statusLabel =
            getOrderStatusLabel(d.status, t) ||
            conf?.label ||
            d.status
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());
        return {
            name: statusLabel,
            value: d.count,
            status: d.status,
            color: conf?.color || "#94a3b8",
            pct: Math.round((d.count / total) * 100),
        };
    });

    return (
        <div className="flex flex-col sm:flex-row items-center gap-6 py-1">
            {/* Donut Chart with Center Label */}
            <div className="relative flex-shrink-0 w-44 h-44 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={75}
                            paddingAngle={4}
                            cornerRadius={5}
                            dataKey="value"
                            onMouseEnter={(_, index) => setActiveIndex(index)}
                            onMouseLeave={() => setActiveIndex(null)}
                            animationDuration={800}
                        >
                            {chartData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.color}
                                    stroke="transparent"
                                    className="transition-all duration-200 cursor-pointer"
                                    opacity={
                                        activeIndex === null ||
                                        activeIndex === index
                                            ? 1
                                            : 0.4
                                    }
                                    style={{
                                        filter:
                                            activeIndex === index
                                                ? `drop-shadow(0 0 8px ${entry.color}88)`
                                                : "none",
                                        transform:
                                            activeIndex === index
                                                ? "scale(1.05)"
                                                : "scale(1)",
                                        transformOrigin: "center center",
                                    }}
                                />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>

                {/* Center Total Card */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                    <span className="text-2xl font-black tracking-tight text-foreground tabular-nums">
                        {activeIndex !== null
                            ? chartData[activeIndex].value
                            : formatNumber(total)}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {activeIndex !== null
                            ? chartData[activeIndex].name
                            : t("common:total", "TOTAL")}
                    </span>
                </div>
            </div>

            {/* Modern Legend with Mini Progress Bars */}
            <div className="flex flex-col gap-2.5 w-full min-w-0">
                {chartData.map((item, i) => {
                    const isSelected = activeIndex === i;
                    return (
                        <div
                            key={i}
                            onMouseEnter={() => setActiveIndex(i)}
                            onMouseLeave={() => setActiveIndex(null)}
                            className={cn(
                                "group flex flex-col gap-1 p-1.5 -mx-1.5 rounded-lg transition-all duration-150 cursor-pointer",
                                isSelected
                                    ? "bg-muted/70 shadow-xs"
                                    : "hover:bg-muted/40",
                            )}
                        >
                            <div className="flex items-center justify-between text-xs min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span
                                        className="h-2.5 w-2.5 rounded-full flex-shrink-0 transition-transform duration-150 group-hover:scale-125"
                                        style={{ backgroundColor: item.color }}
                                    />
                                    <span
                                        className={cn(
                                            "font-medium truncate transition-colors",
                                            isSelected
                                                ? "text-foreground font-semibold"
                                                : "text-foreground/90",
                                        )}
                                    >
                                        {item.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                                    <span className="font-bold text-foreground text-xs">
                                        {formatNumber(item.value)}
                                    </span>
                                    <span className="text-[11px] font-medium text-muted-foreground min-w-[32px] text-right">
                                        {item.pct}%
                                    </span>
                                </div>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                        width: `${Math.max(item.pct, 3)}%`,
                                        backgroundColor: item.color,
                                        opacity: isSelected ? 1 : 0.8,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ─── Bar Chart (monthly revenue) ───────────────────────────── */
function MonthlyBarChart({
    data,
}: {
    data: { month: string; revenue: number; orders: number }[];
}) {
    const { t } = useTranslation([
        "dashboard",
        "orders",
        "common",
        "superAdmin",
    ]);
    if (!data || !data.length) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
                <p>{t("superAdmin:noMonthlyData", "No monthly data yet")}</p>
            </div>
        );
    }

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (
                <div className="rounded-xl border border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur-md text-xs space-y-1.5 min-w-[140px] animate-in fade-in-0 zoom-in-95">
                    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 font-semibold text-foreground">
                        <span>{d.month}</span>
                        <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4 font-normal"
                        >
                            {d.orders}{" "}
                            {d.orders === 1
                                ? t("orders:order", "order")
                                : t("orders:orders", "orders")}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-muted-foreground">
                            {t("dashboard:revenue", "Revenue")}
                        </span>
                        <span className="font-bold text-primary text-sm tabular-nums">
                            {formatCurrency(d.revenue)}
                        </span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="h-48 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={data}
                    margin={{ top: 8, right: 12, left: -15, bottom: 0 }}
                >
                    <defs>
                        <linearGradient
                            id="barRevenueGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop
                                offset="0%"
                                stopColor="hsl(var(--primary))"
                                stopOpacity={0.95}
                            />
                            <stop
                                offset="100%"
                                stopColor="hsl(var(--primary))"
                                stopOpacity={0.65}
                            />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--border)/0.5)"
                    />
                    <XAxis
                        dataKey="month"
                        axisLine={false}
                        tickLine={false}
                        tick={{
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 11,
                            fontWeight: 500,
                        }}
                        dy={6}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 10,
                        }}
                        tickFormatter={(v) =>
                            v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                        }
                    />
                    <RechartsTooltip
                        content={<CustomTooltip />}
                        cursor={{ fill: "hsl(var(--muted)/0.35)", radius: 6 }}
                    />
                    <Bar
                        dataKey="revenue"
                        fill="url(#barRevenueGrad)"
                        radius={[6, 6, 2, 2]}
                        maxBarSize={48}
                        animationDuration={800}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/* ─── Restaurant Bar Chart ───────────────────────────────────── */
function RestaurantBarChart({
    data,
}: {
    data: { name: string; revenue: number; order_count: number }[];
}) {
    const { t } = useTranslation([
        "dashboard",
        "orders",
        "common",
        "superAdmin",
    ]);
    const maxRev = Math.max(...data.map((d) => d.revenue), 1);
    const palette = [
        "bg-orange-500",
        "bg-amber-500",
        "bg-emerald-500",
        "bg-sky-500",
        "bg-violet-500",
        "bg-pink-500",
        "bg-teal-500",
        "bg-rose-500",
    ];
    if (!data.length)
        return (
            <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
                {t("superAdmin:noSalesData", "No sales data yet")}
            </div>
        );
    return (
        <div className="space-y-3">
            {data.map((d, i) => {
                const pct = (d.revenue / maxRev) * 100;
                return (
                    <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground truncate max-w-[55%]">
                                {d.name}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                                {formatCurrency(d.revenue)} ·{" "}
                                {formatNumber(d.order_count)}{" "}
                                {t("orders:orders", "orders")}
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    palette[i % palette.length],
                                )}
                                style={{ width: `${Math.max(pct, 1)}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Skeletons ─────────────────────────────────────────────── */
function StatCardSkeleton() {
    return (
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
            <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-8 w-16" />
                    </div>
                    <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                </div>
            </CardContent>
        </Card>
    );
}

function avatarTone(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
        hash = (hash + name.charCodeAt(i) * (i + 1)) % AVATAR_TONES.length;
    return AVATAR_TONES[hash];
}

/* ════════════════════════════════════════════════════════════
   SUPER ADMIN DASHBOARD
   ════════════════════════════════════════════════════════════ */
function SuperAdminDashboard({ firstName }: { firstName: string }) {
    const { t, i18n } = useTranslation([
        "superAdmin",
        "dashboard",
        "sidebar",
        "common",
        "orders",
    ]);
    const todayLabel = useMemo(
        () =>
            formatDate(new Date(), {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
            }),
        [i18n.language],
    );

    const { data: dash, isPending } = useQuery<SuperAdminDashboardData>({
        queryKey: ["superadmin-dashboard"],
        queryFn: async () => {
            const resp = await fetch(
                `${getApiBase()}/api/stats/superadmin-dashboard`,
                {
                    headers: { Authorization: `Bearer ${getToken()}` },
                },
            );
            if (!resp.ok) throw new Error("Failed to load");
            return resp.json();
        },
        refetchInterval: 30000,
    });

    const kpis = useMemo((): {
        label: string;
        value: string;
        icon: LucideIcon;
        tone: string;
        sub?: string;
    }[] => {
        const s = dash?.summary;
        const activeCount = s?.active_restaurants ?? 0;
        const pendingCount = s?.pending_orders ?? 0;
        return [
            {
                label: t("superAdmin:totalRestaurants", "Total Restaurants"),
                value: formatNumber(s?.total_restaurants ?? 0),
                icon: Store,
                tone: "bg-sky-50 text-sky-600",
                sub: t("superAdmin:activeCount", {
                    count: activeCount,
                    defaultValue: `${formatNumber(activeCount)} active`,
                }),
            },
            {
                label: t("superAdmin:totalOrders", "Total Orders"),
                value: formatNumber(s?.total_orders ?? 0),
                icon: ShoppingBag,
                tone: "bg-orange-50 text-orange-600",
                sub: t("superAdmin:pendingCount", {
                    count: pendingCount,
                    defaultValue: `${formatNumber(pendingCount)} pending`,
                }),
            },
            {
                label: t("superAdmin:totalRevenue", "Total Revenue"),
                value: formatCurrency(s?.total_revenue ?? 0),
                icon: DollarSign,
                tone: "bg-emerald-50 text-emerald-600",
            },
            {
                label: t("superAdmin:uniqueCustomers", "Unique Customers"),
                value: formatNumber(s?.total_customers ?? 0),
                icon: Users,
                tone: "bg-violet-50 text-violet-600",
            },
        ];
    }, [dash, t]);

    return (
        <PageShell className="space-y-6">
            {/* Welcome Hero */}
            <section className="relative overflow-hidden rounded-2xl gradient-hero text-primary-foreground shadow-[0_20px_48px_-18px_rgba(249,115,22,0.45),0_8px_20px_-10px_rgba(31,41,55,0.5)] animate-rise">
                <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 18% 18%, rgba(249,115,22,0.35) 0, transparent 42%), radial-gradient(circle at 88% 12%, rgba(251,191,36,0.22) 0, transparent 38%), linear-gradient(135deg, transparent 38%, rgba(0,0,0,0.28) 100%)",
                    }}
                />
                <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-lg bg-white/20 flex items-center justify-center">
                                <Activity className="h-4 w-4" />
                            </div>
                            <span className="text-sm font-semibold text-white/80 uppercase tracking-wider">
                                {t(
                                    "superAdmin:platformOverview",
                                    "Platform Overview",
                                )}
                            </span>
                        </div>
                        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                            {t("superAdmin:welcomeBack", {
                                name: firstName,
                                defaultValue: `Welcome back, ${firstName} 👋`,
                            })}
                        </h1>
                        <p className="mt-1 max-w-xl text-sm text-white/70">
                            {t(
                                "superAdmin:platformOverviewDesc",
                                "Real-time snapshot of all restaurants, orders, and platform revenue.",
                            )}
                        </p>
                        <p className="flex items-center gap-2 text-sm text-white/55">
                            <Calendar
                                className="h-4 w-4 shrink-0"
                                aria-hidden
                            />
                            {todayLabel}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link to="/restaurants">
                            <Button
                                size="sm"
                                variant="secondary"
                                className="gap-2 rounded-xl font-semibold bg-white/20 hover:bg-white/30 text-white border-white/30"
                            >
                                <Store className="h-4 w-4" />{" "}
                                {t("sidebar:restaurants", "Restaurants")}
                            </Button>
                        </Link>
                        <Link to="/earnings">
                            <Button
                                size="sm"
                                variant="secondary"
                                className="gap-2 rounded-xl font-semibold bg-white/20 hover:bg-white/30 text-white border-white/30"
                            >
                                <TrendingUp className="h-4 w-4" />{" "}
                                {t("sidebar:earnings", "Earnings")}
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* KPI Cards */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
                {isPending
                    ? Array.from({ length: 4 }).map((_, i) => (
                          <StatCardSkeleton key={i} />
                      ))
                    : kpis.map((k, i) => (
                          <Card
                              key={i}
                              className="overflow-hidden rounded-2xl border border-border/80 shadow-xs hover:border-primary/25 hover:shadow-md transition-all duration-200 animate-rise"
                              style={{ animationDelay: `${i * 60}ms` }}
                          >
                              <CardContent className="p-5">
                                  <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0 space-y-1">
                                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                              {k.label}
                                          </p>
                                          <p className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
                                              {k.value}
                                          </p>
                                          {k.sub && (
                                              <p className="text-xs text-muted-foreground">
                                                  {k.sub}
                                              </p>
                                          )}
                                      </div>
                                      <div
                                          className={cn(
                                              "rounded-xl p-2.5 flex-shrink-0",
                                              k.tone,
                                          )}
                                      >
                                          <k.icon
                                              className="h-5 w-5"
                                              aria-hidden
                                          />
                                      </div>
                                  </div>
                              </CardContent>
                          </Card>
                      ))}
            </section>

            {/* Charts Row */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                {/* Monthly Revenue Bar Chart */}
                <Card className="xl:col-span-7 overflow-hidden rounded-2xl border border-border/80 shadow-xs">
                    <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
                        <div>
                            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                                <BarChart3 className="h-4 w-4 text-primary" />
                                {t(
                                    "superAdmin:monthlyRevenueTitle",
                                    "Monthly Revenue",
                                )}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t(
                                    "superAdmin:monthlyRevenueSubtitle",
                                    "Last 12 months · completed orders",
                                )}
                            </p>
                        </div>
                        <Badge
                            variant="outline"
                            className="text-[10px] font-bold text-primary border-primary/40 bg-primary/5"
                        >
                            {dash?.monthly_revenue?.length ?? 0}M
                        </Badge>
                    </CardHeader>
                    <CardContent className="pt-4 pb-2">
                        {isPending ? (
                            <Skeleton className="h-44 w-full rounded-lg" />
                        ) : (
                            <MonthlyBarChart
                                data={dash?.monthly_revenue ?? []}
                            />
                        )}
                    </CardContent>
                </Card>

                {/* Order Status Donut */}
                <Card className="xl:col-span-5 overflow-hidden rounded-2xl border border-border/80 shadow-xs">
                    <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
                        <div>
                            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                                <Activity className="h-4 w-4 text-primary" />
                                {t(
                                    "superAdmin:orderStatusTitle",
                                    "Order Status",
                                )}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t(
                                    "superAdmin:orderStatusSubtitle",
                                    "Distribution across all restaurants",
                                )}
                            </p>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-5">
                        {isPending ? (
                            <Skeleton className="h-36 w-full rounded-lg" />
                        ) : (
                            <DonutChart data={dash?.order_status ?? []} />
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Restaurant Sales Breakdown */}
            <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
                    <div>
                        <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            {t(
                                "superAdmin:topRestaurantsTitle",
                                "Top Restaurants by Revenue",
                            )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {t(
                                "superAdmin:topRestaurantsSubtitle",
                                "Completed orders only · sorted by revenue",
                            )}
                        </p>
                    </div>
                    <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg gap-1.5 border-border/80"
                    >
                        <Link to="/earnings">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            {t("superAdmin:fullEarnings", "Full Earnings")}
                        </Link>
                    </Button>
                </CardHeader>
                <CardContent className="pt-5">
                    {isPending ? (
                        <div className="space-y-4">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton
                                    key={i}
                                    className="h-8 w-full rounded-md"
                                />
                            ))}
                        </div>
                    ) : (
                        <RestaurantBarChart
                            data={dash?.restaurant_sales ?? []}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Quick Actions */}
            <section>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
                    {t("superAdmin:quickActions", "Quick Actions")}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                        {
                            href: "/restaurants",
                            label: t("sidebar:restaurants", "Restaurants"),
                            icon: Store,
                        },
                        {
                            href: "/earnings",
                            label: t("sidebar:earnings", "Earnings"),
                            icon: DollarSign,
                        },
                        {
                            href: "/settings",
                            label: t("sidebar:settings", "Settings"),
                            icon: Settings,
                        },
                    ].map(({ href, label, icon: Icon }, index) => (
                        <Link
                            key={href}
                            to={href}
                            style={{ animationDelay: `${index * 40}ms` }}
                            className={cn(
                                "group flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4",
                                "shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md animate-rise",
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                    <Icon className="h-5 w-5" aria-hidden />
                                </div>
                                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </div>
                            <span className="mt-3 text-sm font-semibold leading-snug text-foreground">
                                {label}
                            </span>
                        </Link>
                    ))}
                </div>
            </section>
        </PageShell>
    );
}

/* ════════════════════════════════════════════════════════════
   RESTAURANT DASHBOARD
   ════════════════════════════════════════════════════════════ */
/* ─── Restaurant Order Overview Chart (Main Area) ───────────── */
type OrderGraphPeriod = "7d" | "14d" | "30d";
type ChartViewMode = "both" | "orders" | "sales";

function RestaurantOrderOverviewChart({
    orders,
    currency,
}: {
    orders: RecentOrderRow[];
    currency?: string;
}) {
    const { t } = useTranslation(["dashboard", "orders", "common", "reports"]);
    const [period, setPeriod] = useState<OrderGraphPeriod>("14d");
    const [viewMode, setViewMode] = useState<ChartViewMode>("both");

    const daysCount = period === "7d" ? 7 : period === "14d" ? 14 : 30;

    const { chartData, totalPeriodOrders, totalPeriodRevenue, avgDailyOrders } =
        useMemo(() => {
            const end = new Date();
            const start = startOfDay(subDays(end, daysCount - 1));
            const intervalDays = eachDayOfInterval({ start, end });

            let orderSum = 0;
            let revSum = 0;

            const data = intervalDays.map((day) => {
                const dayOrders = orders.filter((o) => {
                    if (!o.created_at) return false;
                    try {
                        const dt =
                            typeof o.created_at === "string"
                                ? parseISO(o.created_at)
                                : new Date(o.created_at);
                        return isSameDay(dt, day);
                    } catch {
                        return false;
                    }
                });

                const orderCount = dayOrders.length;
                const revenue = dayOrders.reduce(
                    (sum, o) => sum + (Number(o.total_amount) || 0),
                    0,
                );

                orderSum += orderCount;
                revSum += revenue;

                return {
                    date: format(day, "yyyy-MM-dd"),
                    label: format(day, daysCount > 14 ? "d MMM" : "EEE d"),
                    orders: orderCount,
                    revenue,
                };
            });

            const avg = daysCount > 0 ? (orderSum / daysCount).toFixed(1) : "0";

            return {
                chartData: data,
                totalPeriodOrders: orderSum,
                totalPeriodRevenue: revSum,
                avgDailyOrders: avg,
            };
        }, [orders, daysCount]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (
                <div className="rounded-xl border border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur-md text-xs space-y-1.5 min-w-[150px] animate-in fade-in-0 zoom-in-95">
                    <div className="border-b border-border/50 pb-1 font-semibold text-foreground">
                        {formatDate(d.date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                        })}
                    </div>
                    <div className="space-y-1.5 pt-0.5">
                        {(viewMode === "both" || viewMode === "orders") && (
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                                    {t("orders:title", "Orders")}:
                                </span>
                                <span className="font-bold text-orange-500 tabular-nums">
                                    {d.orders}
                                </span>
                            </div>
                        )}
                        {(viewMode === "both" || viewMode === "sales") && (
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                    {t("reports:totalSales", "Sales")}:
                                </span>
                                <span className="font-bold text-emerald-500 tabular-nums">
                                    {formatCurrency(d.revenue, currency)}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-4">
            {/* Top Filter & Summary Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/40">
                {/* Dynamic Period Stats Pills */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-400 font-medium">
                        <span className="h-2 w-2 rounded-full bg-orange-500" />
                        <span>
                            <strong className="font-bold text-orange-600 dark:text-orange-300">
                                {totalPeriodOrders}
                            </strong>{" "}
                            {t("orders:orders", "orders")}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-medium">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>
                            <strong className="font-bold text-emerald-600 dark:text-emerald-300">
                                {formatCurrency(totalPeriodRevenue, currency)}
                            </strong>{" "}
                            {t("reports:totalSales", "sales")}
                        </span>
                    </div>

                    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground text-[11px]">
                        <span>
                            Avg:{" "}
                            <strong className="text-foreground">
                                {avgDailyOrders}
                            </strong>{" "}
                            / day
                        </span>
                    </div>
                </div>

                {/* View Toggle & Period Switcher Controls */}
                <div className="flex items-center gap-2 self-end sm:self-auto">
                    {/* Mode Switcher */}
                    <div className="flex items-center rounded-lg bg-muted/60 p-0.5 border border-border/50 text-[11px]">
                        <button
                            type="button"
                            onClick={() => setViewMode("both")}
                            className={cn(
                                "px-2 py-0.5 font-medium rounded-md transition-all",
                                viewMode === "both"
                                    ? "bg-background text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t("common:all", "Both")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("orders")}
                            className={cn(
                                "px-2 py-0.5 font-medium rounded-md transition-all",
                                viewMode === "orders"
                                    ? "bg-orange-500 text-white shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t("orders:title", "Orders")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("sales")}
                            className={cn(
                                "px-2 py-0.5 font-medium rounded-md transition-all",
                                viewMode === "sales"
                                    ? "bg-emerald-600 text-white shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t("reports:totalSales", "Sales")}
                        </button>
                    </div>

                    {/* Period Filter (7D, 14D, 30D) */}
                    <div className="flex items-center rounded-lg bg-muted/80 p-0.5 border border-border/60">
                        {(["7d", "14d", "30d"] as OrderGraphPeriod[]).map(
                            (p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPeriod(p)}
                                    className={cn(
                                        "px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-md transition-all",
                                        period === p
                                            ? "bg-primary text-primary-foreground shadow-xs"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {p}
                                </button>
                            ),
                        )}
                    </div>
                </div>
            </div>

            {/* Chart Canvas with Dual or Single Y-Axis */}
            <div className="h-52 w-full pt-1">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{
                            top: 10,
                            right: viewMode === "both" ? 15 : 10,
                            left: -20,
                            bottom: 0,
                        }}
                    >
                        <defs>
                            <linearGradient
                                id="orderAreaGrad"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                            >
                                <stop
                                    offset="0%"
                                    stopColor="#f97316"
                                    stopOpacity={0.45}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="#f97316"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                            <linearGradient
                                id="revenueAreaGrad"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                            >
                                <stop
                                    offset="0%"
                                    stopColor="#10b981"
                                    stopOpacity={0.4}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="#10b981"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="hsl(var(--border)/0.5)"
                        />
                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tick={{
                                fill: "hsl(var(--muted-foreground))",
                                fontSize: 10,
                                fontWeight: 500,
                            }}
                            dy={6}
                        />

                        {/* Orders Left Axis */}
                        {(viewMode === "both" || viewMode === "orders") && (
                            <YAxis
                                yAxisId="orders"
                                orientation="left"
                                axisLine={false}
                                tickLine={false}
                                allowDecimals={false}
                                domain={[
                                    0,
                                    (dataMax: number) =>
                                        Math.max(dataMax + 1, 4),
                                ]}
                                tick={{
                                    fill: "#ea580c",
                                    fontSize: 10,
                                    fontWeight: 600,
                                }}
                                width={28}
                            />
                        )}

                        {/* Sales Right Axis */}
                        {(viewMode === "both" || viewMode === "sales") && (
                            <YAxis
                                yAxisId="revenue"
                                orientation={
                                    viewMode === "sales" ? "left" : "right"
                                }
                                axisLine={false}
                                tickLine={false}
                                domain={[
                                    0,
                                    (dataMax: number) =>
                                        Math.max(
                                            Math.ceil((dataMax * 1.15) / 50) *
                                                50,
                                            50,
                                        ),
                                ]}
                                tick={{
                                    fill: "#059669",
                                    fontSize: 10,
                                    fontWeight: 600,
                                }}
                                tickFormatter={(v) =>
                                    v >= 1000
                                        ? `$${(v / 1000).toFixed(1)}k`
                                        : `$${v}`
                                }
                                width={36}
                            />
                        )}

                        <RechartsTooltip content={<CustomTooltip />} />

                        {(viewMode === "both" || viewMode === "orders") && (
                            <Area
                                yAxisId="orders"
                                type="monotone"
                                dataKey="orders"
                                stroke="#f97316"
                                strokeWidth={2.5}
                                dot={{
                                    r: 3,
                                    fill: "#f97316",
                                    strokeWidth: 1,
                                    stroke: "#fff",
                                }}
                                activeDot={{ r: 5, strokeWidth: 2 }}
                                fill="url(#orderAreaGrad)"
                                animationDuration={600}
                            />
                        )}

                        {(viewMode === "both" || viewMode === "sales") && (
                            <Area
                                yAxisId="revenue"
                                type="monotone"
                                dataKey="revenue"
                                stroke="#10b981"
                                strokeWidth={2.5}
                                dot={{
                                    r: 3,
                                    fill: "#10b981",
                                    strokeWidth: 1,
                                    stroke: "#fff",
                                }}
                                activeDot={{ r: 5, strokeWidth: 2 }}
                                fill="url(#revenueAreaGrad)"
                                animationDuration={600}
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════
   RESTAURANT DASHBOARD
   ════════════════════════════════════════════════════════════ */
function RestaurantDashboard({ firstName }: { firstName: string }) {
    const { t, i18n } = useTranslation([
        "dashboard",
        "sidebar",
        "common",
        "orders",
        "reports",
    ]);
    const { restaurantId, activeRestaurant, restaurants } =
        useActiveRestaurant();
    const { role } = useAuth();
    const can = usePermission();
    const showAdminEarnings = can("admin_earnings.view") && role !== "manager";

    const isBranch = Boolean(
        activeRestaurant?.is_branch ||
        (activeRestaurant?.parent_restaurant_id != null &&
            activeRestaurant.parent_restaurant_id !== ""),
    );

    // Each portal (admin HQ or branch) only sees its own restaurant orders.
    const familyBranchIds = useMemo(() => {
        if (!restaurantId) return [];
        return [restaurantId];
    }, [restaurantId]);

    const todayLabel = useMemo(
        () =>
            formatDate(new Date(), {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
            }),
        [i18n.language],
    );

    const { data: earningsData, isPending: earningsLoading } = useQuery<{
        summary: {
            total_sales: number;
            total_admin_earning: number;
            total_restaurant_earning: number;
            total_orders: number;
        };
        restaurants: {
            restaurant_id: string;
            restaurant_name: string;
            commission_rate: number;
            total_sales: number;
            order_count: number;
            admin_earning: number;
            restaurant_earning: number;
        }[];
    }>({
        queryKey: ["dashboard-earnings", restaurantId],
        queryFn: async () => {
            const url = restaurantId
                ? `${getApiBase()}/api/stats/earnings?restaurant_id=${encodeURIComponent(restaurantId)}`
                : `${getApiBase()}/api/stats/earnings`;
            const resp = await fetch(url, {
                headers: { Authorization: `Bearer ${getToken()}` },
            });
            if (!resp.ok) return null;
            return resp.json();
        },
        refetchInterval: 30000,
    });

    const earningsSummary = earningsData?.summary;

    const { data: recentOrders, isPending: ordersLoading } = useQuery({
        queryKey: ["dashboard-recent-orders", familyBranchIds.join(",")],
        enabled: familyBranchIds.length > 0,
        queryFn: async () => {
            let q = supabase
                .from("orders")
                .select(
                    "id,order_number,tracking_code,customer_name,customer_phone,customer_email,delivery_address,total_amount,subtotal,tax_amount,delivery_fee,status,created_at,payment_method,payment_status,source,estimated_delivery_at",
                );

            q = q.eq("restaurant_id", restaurantId!);

            const { data } = await q
                .order("created_at", { ascending: false })
                .limit(100);
            return (data || []) as RecentOrderRow[];
        },
        refetchInterval: 15000,
    });

    const { data: restaurantInfo } = useQuery({
        queryKey: ["dashboard-restaurant-info", restaurantId],
        enabled: !!restaurantId,
        queryFn: async () => {
            const { data } = await supabase
                .from("restaurants")
                .select("name,is_active")
                .eq("id", restaurantId!)
                .maybeSingle();
            return data;
        },
    });

    return (
        <PageShell className="space-y-5 sm:space-y-6">
            {/* Welcome band */}
            <section className="relative overflow-hidden rounded-2xl gradient-hero text-primary-foreground shadow-[0_20px_48px_-18px_rgba(249,115,22,0.45),0_8px_20px_-10px_rgba(31,41,55,0.5)] animate-rise">
                <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 18% 18%, rgba(249,115,22,0.35) 0, transparent 42%), radial-gradient(circle at 88% 12%, rgba(251,191,36,0.22) 0, transparent 38%), linear-gradient(135deg, transparent 38%, rgba(0,0,0,0.28) 100%)",
                    }}
                />
                <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
                    <div className="space-y-3 min-w-0">
                        <div>
                            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                                {t("auth:signInSubtitle", "Welcome back")},{" "}
                                {firstName}
                            </h1>
                            <p className="mt-1.5 max-w-xl text-sm text-white/75">
                                {`${t("dashboard:salesToday", "What's happening at")} ${restaurantInfo?.name || "your restaurant"}.`}
                            </p>
                        </div>
                        <p className="flex items-center gap-2 text-sm text-white/65">
                            <Calendar
                                className="h-4 w-4 shrink-0"
                                aria-hidden
                            />
                            {todayLabel}
                        </p>
                    </div>
                </div>
            </section>

            <div className="space-y-5">
                {/* Restaurant status */}
                <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs overflow-hidden">
                    <CardContent className="p-0">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-status-available bg-card px-5 py-4">
                            <div className="min-w-0 space-y-1">
                                <h3 className="text-lg font-bold tracking-tight">
                                    {restaurantInfo?.name || "Restaurant"}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {restaurantInfo?.is_active
                                        ? t(
                                              "orders:acceptingOrders",
                                              "Accepting orders",
                                          )
                                        : t(
                                              "menu:unavailable",
                                              "Currently closed",
                                          )}
                                </p>
                            </div>
                            <Badge className="shrink-0 rounded-md bg-status-available/12 text-status-available border border-status-available/25 hover:bg-status-available/12">
                                ● {t("dashboard:statusLive", "Live")}
                            </Badge>
                        </div>
                    </CardContent>
                </Card>

                {/* Unified Sales & Revenue Overview */}
                <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
                        <div>
                            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                {t(
                                    "dashboard:revenueOverview",
                                    "Sales & Revenue Overview",
                                )}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t(
                                    "dashboard:salesAndRevenueDesc",
                                    "Key sales metrics",
                                )}
                            </p>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-5">
                        {/* Primary KPI Metrics */}
                        <div
                            className={cn(
                                "grid grid-cols-1 gap-3 sm:grid-cols-2",
                                showAdminEarnings
                                    ? "xl:grid-cols-4"
                                    : "xl:grid-cols-3",
                            )}
                        >
                            <div className="rounded-xl border border-border/70 bg-gradient-to-br from-emerald-500/5 to-card p-4 transition-all hover:border-emerald-500/30">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t("reports:totalSales", "Total Sales")}
                                    </p>
                                    <div className="rounded-lg p-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                                        <DollarSign className="h-4 w-4" />
                                    </div>
                                </div>
                                <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-1 text-foreground">
                                    {earningsLoading
                                        ? "…"
                                        : formatCurrency(
                                              earningsSummary?.total_sales ?? 0,
                                          )}
                                </p>
                            </div>

                            <div className="rounded-xl border border-border/70 bg-gradient-to-br from-orange-500/5 to-card p-4 transition-all hover:border-orange-500/30">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t(
                                            "reports:totalOrders",
                                            "Total Orders",
                                        )}
                                    </p>
                                    <div className="rounded-lg p-2 bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
                                        <ShoppingBag className="h-4 w-4" />
                                    </div>
                                </div>
                                <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-1 text-foreground">
                                    {earningsLoading
                                        ? "…"
                                        : formatNumber(
                                              earningsSummary?.total_orders ??
                                                  0,
                                          )}
                                </p>
                            </div>

                            <div className="rounded-xl border border-border/70 bg-gradient-to-br from-sky-500/5 to-card p-4 transition-all hover:border-sky-500/30">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t(
                                            "reports:colRestaurantEarnings",
                                            "Restaurant Earnings",
                                        )}
                                    </p>
                                    <div className="rounded-lg p-2 bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400">
                                        <Store className="h-4 w-4" />
                                    </div>
                                </div>
                                <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-1 text-emerald-600 dark:text-emerald-400">
                                    {earningsLoading
                                        ? "…"
                                        : formatCurrency(
                                              earningsSummary?.total_restaurant_earning ??
                                                  0,
                                          )}
                                </p>
                            </div>

                            {showAdminEarnings && (
                                <div className="rounded-xl border border-border/70 bg-gradient-to-br from-amber-500/5 to-card p-4 transition-all hover:border-amber-500/30">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            {t(
                                                "reports:colAdminEarnings",
                                                "Admin Earnings",
                                            )}
                                        </p>
                                        <div className="rounded-lg p-2 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                                            <Tag className="h-4 w-4" />
                                        </div>
                                    </div>
                                    <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-1 text-amber-600 dark:text-amber-400">
                                        {earningsLoading
                                            ? "…"
                                            : formatCurrency(
                                                  earningsSummary?.total_admin_earning ??
                                                      0,
                                              )}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="pt-3 border-t border-border/60">
                            <AiValuePanel
                                restaurantId={restaurantId}
                                embedded
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Orders & Sales Trend Area Chart */}
                <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
                        <div>
                            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-primary" />
                                {t(
                                    "dashboard:ordersTrend",
                                    "Orders & Sales Trend",
                                )}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t(
                                    "dashboard:salesToday",
                                    "Daily order volume and completed sales performance",
                                )}
                            </p>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4 pb-3">
                        {ordersLoading && restaurantId ? (
                            <Skeleton className="h-48 w-full rounded-lg" />
                        ) : (
                            <RestaurantOrderOverviewChart
                                orders={recentOrders || []}
                            />
                        )}
                    </CardContent>
                </Card>
            </div>
        </PageShell>
    );
}

/* ════════════════════════════════════════════════════════════
   ROOT EXPORT
   ════════════════════════════════════════════════════════════ */
export default function Dashboard() {
    const { profile, role, isReceptionist, isStaff } = useAuth();
    const isSuperAdmin = role === "super_admin";
    const firstName = profile?.full_name?.split(" ")[0] || "Admin";

    if (isSuperAdmin) return <SuperAdminDashboard firstName={firstName} />;
    if (isReceptionist || role === "receptionist")
        return <ReceptionistDashboard firstName={firstName} />;
    if (isStaff || role === "staff")
        return <StaffDashboard firstName={firstName} />;
    return <RestaurantDashboard firstName={firstName} />;
}
