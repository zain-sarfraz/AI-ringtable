import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ClipboardList, Download, Loader2, ArrowLeftRight, DollarSign, Building2 } from "lucide-react";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReportRestaurants } from "@/hooks/useReportRestaurants";
import { formatCurrency } from "@/lib/restaurant";
import { formatDate } from "@/i18n/formatters";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

type BranchOption = { id: string; name: string; is_branch: boolean };

type BranchTotal = {
  restaurant_id: string;
  restaurant_name: string;
  is_branch: boolean;
  order_count: number;
  transferred_orders: number;
  revenue: number;
};

type OrderRow = {
  id: string;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  source: string | null;
  fulfillment_type: string | null;
  total_amount: number;
  created_at: string;
  restaurant_id: string;
  branch_name: string;
  transferred: boolean;
  transfer_status: string | null;
  transfer_reason: string | null;
  transferred_from_name: string | null;
  pending_branch_name: string | null;
};

type OrderReportResponse = {
  branches: BranchOption[];
  by_branch: BranchTotal[];
  summary: { total_orders: number; transferred_orders: number; revenue: number };
  orders: OrderRow[];
};

export default function OrderReportPage() {
  const { t } = useTranslation(["reports", "common", "orders"]);
  const { data: meta, isLoading: metaLoading, error: metaError } = useReportRestaurants();
  const restaurants = meta?.restaurants ?? [];
  const [restaurantId, setRestaurantId] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [datePreset, setDatePreset] = useState("all");
  const [transferFilter, setTransferFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (restaurants.length > 0 && (!restaurantId || !restaurants.some((r) => r.restaurant_id === restaurantId))) {
      setRestaurantId(restaurants[0].restaurant_id);
    }
  }, [restaurants, restaurantId]);

  const { data, isLoading, isFetching, error } = useQuery<OrderReportResponse>({
    queryKey: ["order-report", restaurantId, branchId, datePreset, transferFilter, searchQuery],
    queryFn: async () => {
      const token = getToken();
      const params = new URLSearchParams();
      if (restaurantId) params.set("restaurant_id", restaurantId);
      if (branchId && branchId !== "all") params.set("branch_id", branchId);
      if (transferFilter !== "all") params.set("transferred", transferFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (datePreset === "today" || datePreset === "yesterday" || datePreset === "this_month" || datePreset === "last_month") {
        params.set("period", datePreset);
      } else if (datePreset === "7" || datePreset === "30" || datePreset === "90") {
        params.set("days", datePreset);
      }
      const res = await fetch(`${getApiBase()}/api/stats/order-report?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch order report");
      return res.json();
    },
    enabled: !metaLoading && Boolean(restaurantId),
  });

  const summary = data?.summary;
  const orders = data?.orders ?? [];
  const branches = data?.branches ?? [];
  const byBranch = data?.by_branch ?? [];

  const exportCsv = () => {
    if (!orders.length) return;
    const headers = [
      "Order",
      "Customer",
      "Phone",
      "Branch",
      "Transferred",
      "From",
      "Pending branch",
      "Status",
      "Source",
      "Total",
      "Date",
    ];
    const lines = orders.map((row) =>
      [
        row.order_number,
        row.customer_name || "",
        row.customer_phone || "",
        row.branch_name,
        row.transferred ? "Yes" : "No",
        row.transferred_from_name || "",
        row.pending_branch_name || "",
        row.status,
        row.source || "",
        row.total_amount.toFixed(2),
        row.created_at,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `order-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
      </div>
    );
  }

  return (
    <PageShell className="pb-16">
      <PageHeader
        title={t("reports:orderReport", "Order report")}
        description={t("reports:orderReportDesc", "Which branch each order went to, and how many were transferred.")}
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <Button variant="outline" className="h-10 rounded-xl w-full sm:w-auto" onClick={exportCsv} disabled={!orders.length}>
            <Download className="h-4 w-4 mr-2" />
            {t("reports:exportCsv", "Export CSV")}
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row flex-wrap gap-2.5">
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-10 bg-card border-border/80 rounded-xl px-3 text-xs w-full lg:w-[220px]">
            <Building2 className="h-4 w-4 text-muted-foreground mr-1" />
            <SelectValue placeholder={t("reports:allBranches", "All branches")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reports:allBranches", "All branches")}</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={datePreset} onValueChange={setDatePreset}>
          <SelectTrigger className="h-10 bg-card border-border/80 rounded-xl px-3 text-xs w-full lg:w-[180px]">
            <Calendar className="h-4 w-4 text-muted-foreground mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("orders:allTime", "All time")}</SelectItem>
            <SelectItem value="today">{t("orders:today", "Today")}</SelectItem>
            <SelectItem value="yesterday">{t("orders:yesterday", "Yesterday")}</SelectItem>
            <SelectItem value="7">{t("orders:last7Days", "Last 7 days")}</SelectItem>
            <SelectItem value="30">{t("orders:last30Days", "Last 30 days")}</SelectItem>
            <SelectItem value="this_month">{t("orders:thisMonth", "This month")}</SelectItem>
            <SelectItem value="last_month">{t("orders:lastMonth", "Last month")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={transferFilter} onValueChange={setTransferFilter}>
          <SelectTrigger className="h-10 bg-card border-border/80 rounded-xl px-3 text-xs w-full lg:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reports:allOrders", "All orders")}</SelectItem>
            <SelectItem value="transferred">{t("reports:transferredOnly", "Transferred only")}</SelectItem>
            <SelectItem value="not_transferred">{t("reports:notTransferred", "Not transferred")}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("reports:searchOrdersPlaceholder", "Search order, name, or phone")}
          className="h-10 rounded-xl bg-card lg:max-w-xs"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-xs text-muted-foreground">{t("reports:totalOrders", "Total Orders")}</p>
              <p className="text-2xl font-bold">{summary?.total_orders ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowLeftRight className="h-5 w-5 text-sky-600" />
            <div>
              <p className="text-xs text-muted-foreground">{t("reports:transferredOrders", "Transferred orders")}</p>
              <p className="text-2xl font-bold">{summary?.transferred_orders ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-xs text-muted-foreground">{t("reports:revenue", "Revenue")}</p>
              <p className="text-2xl font-bold">{formatCurrency(summary?.revenue ?? 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {byBranch.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {byBranch.map((branch) => (
            <button
              key={branch.restaurant_id}
              type="button"
              onClick={() => setBranchId(branch.restaurant_id === branchId ? "all" : branch.restaurant_id)}
              className={`text-left rounded-xl border bg-card p-4 shadow-sm transition ${
                branchId === branch.restaurant_id ? "border-primary ring-1 ring-primary" : "border-border/70"
              }`}
            >
              <p className="font-semibold truncate">{branch.restaurant_name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {branch.order_count} {t("reports:ordersLabel", "orders")} · {branch.transferred_orders}{" "}
                {t("reports:transferredLabel", "transferred")}
              </p>
              <p className="text-sm font-medium mt-1">{formatCurrency(branch.revenue)}</p>
            </button>
          ))}
        </div>
      )}

      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading || isFetching ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-destructive">{t("common:error", "Could not load the order report.")}</p>
          ) : orders.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("reports:noOrdersInReport", "No orders match these filters.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("orders:order", "Order")}</th>
                    <th className="px-4 py-3 font-medium">{t("orders:customer", "Customer")}</th>
                    <th className="px-4 py-3 font-medium">{t("reports:branch", "Branch")}</th>
                    <th className="px-4 py-3 font-medium">{t("reports:transfer", "Transfer")}</th>
                    <th className="px-4 py-3 font-medium">{t("orders:status", "Status")}</th>
                    <th className="px-4 py-3 font-medium text-right">{t("reports:revenue", "Revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((row) => (
                    <tr key={row.id} className="border-t border-border/60">
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold">{row.order_number}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(row.created_at)}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p>{row.customer_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{row.customer_phone || ""}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p>{row.branch_name}</p>
                        {row.pending_branch_name && (
                          <p className="text-xs text-amber-700">
                            {t("reports:pendingTo", "Pending to")} {row.pending_branch_name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.transferred ? (
                          <div className="space-y-1">
                            <Badge variant="secondary">{t("reports:transferred", "Transferred")}</Badge>
                            {row.transferred_from_name && (
                              <p className="text-xs text-muted-foreground">
                                {t("reports:fromBranch", "From")} {row.transferred_from_name}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top capitalize">{String(row.status || "").replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 align-top text-right font-medium">{formatCurrency(row.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
