import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Wallet, 
  TrendingUp, 
  Store, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight,
  PieChart as PieChartIcon,
  BarChart as BarChartIcon,
  Loader2
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReChartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

interface EarningStats {
  restaurants: {
    restaurant_id: string;
    restaurant_name: string;
    commission_rate: number;
    total_sales: number;
    order_count: number;
    admin_earning: number;
    restaurant_earning: number;
  }[];
  summary: {
    total_sales: number;
    total_orders: number;
    total_admin_earning: number;
    total_restaurant_earning: number;
  };
}

export default function Earnings() {
  const { t } = useTranslation(["superAdmin", "reports", "common"]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>("all");

  // Fetch earnings data (only restaurants with completed orders)
  const { data, isLoading, error } = useQuery<EarningStats>({
    queryKey: ["super-admin-earnings"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/stats/earnings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch earnings");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch ALL restaurants for the filter dropdown (independent of whether they have orders)
  const { data: allRestaurantsData } = useQuery<{ restaurants: { id: string; name: string }[] }>({
    queryKey: ["all-restaurants-for-filter"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/stats/all-restaurants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { restaurants: [] };
      return res.json();
    },
  });

  // All restaurants for dropdown (use all-restaurants endpoint, not earnings data)
  const allRestaurantsForFilter = allRestaurantsData?.restaurants ?? [];

  const earningsRestaurants = data?.restaurants ?? [];
  const earningsById = useMemo(() => {
    const map: Record<string, typeof earningsRestaurants[0]> = {};
    for (const r of earningsRestaurants) map[r.restaurant_id] = r;
    return map;
  }, [earningsRestaurants]);

  const displayedRestaurants = useMemo(
    () =>
      selectedRestaurantId === "all"
        ? earningsRestaurants
        : earningsRestaurants.filter((r) => r.restaurant_id === selectedRestaurantId),
    [earningsRestaurants, selectedRestaurantId]
  );

  const selectedRestaurantName = useMemo(() => {
    if (selectedRestaurantId === "all") return t("reports:allRestaurants", "All Restaurants");
    const restaurant = allRestaurantsForFilter.find((r) => r.id === selectedRestaurantId);
    return restaurant?.name || t("superAdmin:selectedRestaurant", "Selected Restaurant");
  }, [allRestaurantsForFilter, selectedRestaurantId, t]);

  const displayedSummary = useMemo(
    () =>
      displayedRestaurants.reduce(
        (acc, row) => {
          acc.total_sales += row.total_sales;
          acc.total_orders += row.order_count;
          acc.total_admin_earning += row.admin_earning;
          acc.total_restaurant_earning += row.restaurant_earning;
          return acc;
        },
        {
          total_sales: 0,
          total_orders: 0,
          total_admin_earning: 0,
          total_restaurant_earning: 0,
        }
      ),
    [displayedRestaurants]
  );

  const chartData = useMemo(() => {
    return displayedRestaurants.map((r) => ({
      name: r.restaurant_name,
      Admin: r.admin_earning,
      Restaurant: r.restaurant_earning,
    }));
  }, [displayedRestaurants]);

  const pieData = useMemo(() => {
    return [
      { name: t("superAdmin:adminProfit", "Admin Profit"), value: displayedSummary.total_admin_earning, color: "hsl(var(--primary))" },
      { name: t("superAdmin:restaurantShare", "Restaurant Share"), value: displayedSummary.total_restaurant_earning, color: "hsl(142, 71%, 45%)" },
    ];
  }, [displayedSummary, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <p className="font-bold">{t("common:error", "Error loading earnings")}</p>
        <p className="text-sm">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        icon={<Wallet className="h-5 w-5" />}
        title={t("superAdmin:earningsTitle", "Platform Earnings")}
        description={t("superAdmin:earningsSubtitle", "Global revenue and commission analytics")}
        actions={
        <Select value={selectedRestaurantId} onValueChange={setSelectedRestaurantId}>
          <SelectTrigger className="w-full rounded-xl sm:w-[280px]">
            <SelectValue placeholder={t("reports:filterByRestaurant", "Filter by restaurant")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reports:allRestaurants", "All Restaurants")}</SelectItem>
            {allRestaurantsForFilter.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
                {!earningsById[r.id] && (
                  <span className="ml-2 text-[10px] text-muted-foreground">(no sales yet)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        }
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title={t("superAdmin:totalPlatformSales", "Total Platform Sales")} 
          value={formatCurrency(displayedSummary.total_sales)} 
          icon={TrendingUp} 
          trend="+12.5%" 
          isPositive={true}
          description={t("superAdmin:grossSalesDesc", "Gross sales across all locations")}
          vsText={t("common:vsLastMonth", "vs last month")}
        />
        <StatCard 
          title={t("superAdmin:adminEarnings", "Admin Earnings")} 
          value={formatCurrency(displayedSummary.total_admin_earning)} 
          icon={DollarSign} 
          trend="+8.2%" 
          isPositive={true}
          description={t("superAdmin:commissionsCollectedDesc", "Total commissions collected")}
          vsText={t("common:vsLastMonth", "vs last month")}
          highlight
        />
        <StatCard 
          title={t("superAdmin:restaurantEarnings", "Restaurant Earnings")} 
          value={formatCurrency(displayedSummary.total_restaurant_earning)} 
          icon={Store} 
          trend="+14.1%" 
          isPositive={true}
          description={t("superAdmin:netRevenueDesc", "Net revenue for restaurant partners")}
          vsText={t("common:vsLastMonth", "vs last month")}
        />
        <StatCard 
          title={t("reports:totalOrders", "Total Orders")} 
          value={displayedSummary.total_orders.toString()} 
          icon={BarChartIcon} 
          trend="+20.4%" 
          isPositive={true}
          description={t("superAdmin:completedDeliveriesDesc", "Completed deliveries")}
          vsText={t("common:vsLastMonth", "vs last month")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Distribution Chart */}
        <Card className="lg:col-span-2 rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChartIcon className="h-5 w-5 text-primary" />
              {selectedRestaurantId === "all" ? t("superAdmin:restaurantWiseRevenue", "Restaurant-wise Revenue") : `${selectedRestaurantName} ${t("reports:sales", "Revenue")}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                  <ReChartsTooltip 
                    cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => formatCurrency(value)}
                  />
                  <Legend iconType="circle" />
                  <Bar dataKey="Admin" name={t("superAdmin:adminProfit", "Admin Profit")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="Restaurant" name={t("superAdmin:restaurantShare", "Restaurant Share")} fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Share Breakdown Pie */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              {selectedRestaurantId === "all" ? t("superAdmin:profitSplit", "Profit Split") : `${selectedRestaurantName} ${t("superAdmin:profitSplit", "Profit Split")}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={100}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReChartsTooltip 
                     contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))' }}
                     formatter={(value: any) => formatCurrency(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full space-y-3 mt-4">
              {pieData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold">{formatCurrency(item.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        <CardHeader>
          <CardTitle>{t("superAdmin:detailedRestaurantEarnings", "Detailed Restaurant Earnings")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-y">
                <tr>
                  <th className="px-6 py-4">{t("reports:colRestaurant", "Restaurant")}</th>
                  <th className="px-6 py-4">{t("superAdmin:colCommissionRate", "Commission")}</th>
                  <th className="px-6 py-4 text-right">{t("reports:colOrders", "Orders")}</th>
                  <th className="px-6 py-4 text-right">{t("reports:colSales", "Total Sales")}</th>
                  <th className="px-6 py-4 text-right">{t("reports:colAdminEarnings", "Admin Profit")}</th>
                  <th className="px-6 py-4 text-right">{t("reports:colRestaurantEarnings", "Net Payout")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayedRestaurants.map((r) => (
                  <tr key={r.restaurant_id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 font-semibold text-foreground">{r.restaurant_name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-bold">
                        {r.commission_rate}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-muted-foreground">{r.order_count}</td>
                    <td className="px-6 py-4 text-right font-medium">{formatCurrency(r.total_sales)}</td>
                    <td className="px-6 py-4 text-right text-primary font-bold">{formatCurrency(r.admin_earning)}</td>
                    <td className="px-6 py-4 text-right text-emerald-600 font-bold">{formatCurrency(r.restaurant_earning)}</td>
                  </tr>
                ))}
                {displayedRestaurants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                      {t("reports:noData", "No earnings data found for the selected restaurant.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  isPositive, 
  description,
  vsText,
  highlight = false
}: { 
  title: string; 
  value: string; 
  icon: any; 
  trend: string; 
  isPositive: boolean; 
  description: string;
  vsText?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(
      "rounded-2xl border border-border/80 shadow-xs overflow-hidden transition-all duration-300",
      highlight ? "bg-primary text-primary-foreground border-primary/30" : "bg-card"
    )}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className={cn("text-xs font-bold uppercase tracking-wider", highlight ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {title}
            </p>
            <p className="text-3xl font-black">{value}</p>
            <div className="flex items-center gap-2">
              <span className={cn(
                "flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full",
                highlight 
                  ? "bg-white/20 text-white" 
                  : isPositive ? "bg-emerald-500/20 text-emerald-600" : "bg-destructive/20 text-destructive"
              )}>
                {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {trend}
              </span>
              <span className={cn("text-[10px]", highlight ? "text-primary-foreground/60" : "text-muted-foreground")}>
                {vsText || "vs last month"}
              </span>
            </div>
          </div>
          <div className={cn(
            "p-3 rounded-2xl shadow-inner",
            highlight ? "bg-white/20" : "bg-muted"
          )}>
            <Icon className={cn("h-6 w-6", highlight ? "text-white" : "text-primary")} />
          </div>
        </div>
        <p className={cn("mt-4 text-[10px] italic", highlight ? "text-primary-foreground/70" : "text-muted-foreground/80")}>
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
