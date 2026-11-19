import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Award, Loader2, ShoppingCart, TrendingUp, DollarSign } from "lucide-react";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { useReportRestaurants } from "@/hooks/useReportRestaurants";
import { formatCurrency } from "@/lib/restaurant";

type BestSellerRow = {
  rank: number;
  restaurant_id: string;
  restaurant_name: string;
  menu_item_id: string | null;
  item_name: string;
  category_name: string | null;
  quantity_sold: number;
  order_count: number;
  revenue: number;
  revenue_share_pct: number;
};

type BestSellersResponse = {
  items: BestSellerRow[];
  summary: {
    total_revenue: number;
    total_units: number;
    period_days: number | null;
    sort_by: string;
  };
};

export default function BestSellersReportPage() {
  const { t } = useTranslation(["reports", "common"]);
  const { data: meta, isLoading: metaLoading, error: metaError } = useReportRestaurants();
  const restaurants = meta?.restaurants ?? [];
  const [restaurantId, setRestaurantId] = useState("");
  const [periodDays, setPeriodDays] = useState("30");
  const [limit, setLimit] = useState("10");
  const [sortBy, setSortBy] = useState("revenue");

  useEffect(() => {
    if (restaurants.length > 0 && (!restaurantId || !restaurants.some((r) => r.restaurant_id === restaurantId))) {
      setRestaurantId(restaurants[0].restaurant_id);
    }
  }, [restaurants, restaurantId]);

  const { data, isLoading, error } = useQuery<BestSellersResponse>({
    queryKey: ["best-sellers", restaurantId, periodDays, limit, sortBy],
    queryFn: async () => {
      const token = getToken();
      const params = new URLSearchParams();
      if (restaurantId) params.set("restaurant_id", restaurantId);
      if (periodDays !== "0") params.set("days", periodDays);
      params.set("limit", limit);
      params.set("sort", sortBy);
      const res = await fetch(`${getApiBase()}/api/stats/best-sellers?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch best sellers");
      return res.json();
    },
    enabled: !metaLoading && Boolean(restaurantId),
    refetchInterval: 30000,
  });

  const rows = data?.items ?? [];
  const summary = data?.summary;
  const showRestaurantCol = false;
  const colSpan = 6;

  const topItem = rows[0];

  if (metaLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (metaError || restaurants.length === 0) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <p className="font-bold">{t("reports:noRestaurantAccess", "No restaurant access")}</p>
        <p className="text-sm">{t("reports:linkAccountPrompt", "Link your account to a restaurant to view best sellers.")}</p>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("reports:bestSellingProducts", "Best selling products")}
        description={t("reports:bestSellingProductsDesc", "Top menu items by revenue or units sold")}
        icon={<Award className="h-5 w-5" />}
        actions={
        <ReportFilters
          restaurants={restaurants}
          restaurantId={restaurantId}
          onRestaurantChange={setRestaurantId}
          periodDays={periodDays}
          onPeriodChange={setPeriodDays}
          showPeriod
          extra={
            <>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Top 10</SelectItem>
                  <SelectItem value="25">Top 25</SelectItem>
                  <SelectItem value="50">Top 50</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="revenue">{t("reports:byRevenue", "By revenue")}</SelectItem>
                  <SelectItem value="quantity">{t("reports:byQuantity", "By quantity")}</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />
        }
      />

      {error ? (
        <div className="p-6 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
          <p className="font-bold">{t("common:error", "Error loading report")}</p>
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              label={t("reports:topProduct", "Top product")}
              value={isLoading ? "…" : topItem?.item_name ?? "—"}
              icon={Award}
              sub={topItem ? formatCurrency(topItem.revenue) : undefined}
            />
            <StatCard
              label={t("reports:totalRevenue", "Total revenue")}
              value={isLoading ? "…" : formatCurrency(summary?.total_revenue ?? 0)}
              icon={DollarSign}
            />
            <StatCard
              label={t("reports:unitsSold", "Units sold")}
              value={isLoading ? "…" : String(summary?.total_units ?? 0)}
              icon={ShoppingCart}
            />
            <StatCard
              label={t("reports:productsRanked", "Products ranked")}
              value={isLoading ? "…" : String(rows.length)}
              icon={TrendingUp}
            />
          </div>

          <Card className="border-none bg-card/50 backdrop-blur-sm shadow-xl overflow-hidden">
            <CardHeader>
              <CardTitle>{t("reports:rankings", "Rankings")}</CardTitle>
              <p className="text-sm text-muted-foreground font-normal">
                {t("reports:deliveredAndCompletedOrders", "Delivered and completed orders")}{periodDays !== "0" ? ` · ${t("reports:lastDays", { count: parseInt(periodDays) }) || `last ${periodDays} days`}` : ""}.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-medium border-y">
                    <tr>
                      <th className="px-6 py-4 w-14">#</th>
                      {showRestaurantCol && <th className="px-6 py-4">{t("reports:colRestaurant", "Restaurant")}</th>}
                      <th className="px-6 py-4">{t("reports:colProduct", "Product")}</th>
                      <th className="px-6 py-4">{t("reports:colCategory", "Category")}</th>
                      <th className="px-6 py-4 text-right">{t("reports:colQtySold", "Qty sold")}</th>
                      <th className="px-6 py-4 text-right">{t("reports:colOrders", "Orders")}</th>
                      <th className="px-6 py-4 text-right">{t("reports:colRevenue", "Revenue")}</th>
                      <th className="px-6 py-4 text-right">{t("reports:colShare", "Share")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading && (
                      <tr>
                        <td colSpan={colSpan} className="px-6 py-12 text-center">
                          <Loader2 className="h-6 w-6 animate-spin text-primary inline" />
                        </td>
                      </tr>
                    )}
                    {!isLoading &&
                      rows.map((row) => (
                        <tr key={`${row.restaurant_id}-${row.menu_item_id ?? row.item_name}`} className="hover:bg-muted/30">
                          <td className="px-6 py-4">
                            <Badge variant={row.rank <= 3 ? "default" : "secondary"} className="tabular-nums">
                              {row.rank}
                            </Badge>
                          </td>
                          {showRestaurantCol && (
                            <td className="px-6 py-4 font-medium">{row.restaurant_name}</td>
                          )}
                          <td className="px-6 py-4 font-semibold">{row.item_name}</td>
                          <td className="px-6 py-4 text-muted-foreground">{row.category_name ?? "—"}</td>
                          <td className="px-6 py-4 text-right tabular-nums">{row.quantity_sold}</td>
                          <td className="px-6 py-4 text-right tabular-nums">{row.order_count}</td>
                          <td className="px-6 py-4 text-right font-medium tabular-nums">
                            {formatCurrency(row.revenue)}
                          </td>
                          <td className="px-6 py-4 text-right text-muted-foreground tabular-nums">
                            {row.revenue_share_pct}%
                          </td>
                        </tr>
                      ))}
                    {!isLoading && rows.length === 0 && (
                      <tr>
                        <td colSpan={colSpan} className="px-6 py-8 text-center text-muted-foreground">
                          {t("reports:noDataPeriod", "No sales data for this period.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
}) {
  return (
    <Card className="rounded-2xl border border-border/80 shadow-xs">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-lg font-bold mt-1 truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className="h-6 w-6 text-primary flex-shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}

