import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  PackageCheck,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Store,
  Boxes,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/i18n/formatters";

interface PosSummaryData {
  summary: {
    total_sales: number;
    total_purchases: number;
    gross_profit: number;
    margin_percent: number;
    total_orders: number;
    total_purchases_count: number;
    total_raw_materials: number;
    stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
  };
  recent_sales: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    total_amount: number;
    payment_method: string;
    fulfillment_type: string;
    status: string;
    created_at: string;
  }>;
  recent_purchases: Array<{
    id: string;
    purchase_date: string;
    total_amount: number;
    status: string;
    notes?: string;
    supplier_name?: string;
    supplier_company?: string;
  }>;
  top_used_materials: Array<{
    id: string;
    name: string;
    unit: string;
    total_quantity_used: number;
    total_cost_used: number;
  }>;
  fulfillment_breakdown: Array<{
    fulfillment_type: string;
    count: string | number;
    total: string | number;
  }>;
}

interface Props {
  data: PosSummaryData | null;
  period: string;
  onPeriodChange: (p: string) => void;
  onNavigateTab: (tab: string) => void;
}

export function PosOverview({ data, period, onPeriodChange, onNavigateTab }: Props) {
  if (!data) return null;

  const { summary, recent_sales, recent_purchases, top_used_materials } = data;
  const isProfitable = summary.gross_profit >= 0;

  // Comparison bar percentage
  const combinedTotal = summary.total_sales + summary.total_purchases;
  const salesPercent = combinedTotal > 0 ? Math.round((summary.total_sales / combinedTotal) * 100) : 50;
  const purchasesPercent = 100 - salesPercent;

  return (
    <div className="space-y-6">
      {/* ── Period Selector Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-2xl border border-border">
        <div>
          <h3 className="text-sm font-bold text-foreground">Sales & Purchases Financial Ledger</h3>
          <p className="text-xs text-muted-foreground">
            Complete executive comparison of restaurant sales versus raw materials purchasing.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-xl">
          {[
            { label: "Today", value: "today" },
            { label: "Last 7 Days", value: "week" },
            { label: "Last 30 Days", value: "month" },
            { label: "All Time", value: "all" },
          ].map((btn) => (
            <button
              key={btn.value}
              type="button"
              onClick={() => onPeriodChange(btn.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                period === btn.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 4 Main KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Sales */}
        <Card className="border border-border/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-emerald-500/10 via-card to-card">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Sales</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <div className="text-2xl font-black text-foreground">
              {formatCurrency(summary.total_sales)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="h-4 text-[10px] px-1.5 font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <ArrowUpRight className="h-3 w-3 mr-0.5 inline" /> {summary.total_orders} Orders
              </Badge>
              <span>revenue collected</span>
            </div>
          </CardContent>
        </Card>

        {/* Total Purchases */}
        <Card className="border border-border/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-blue-500/10 via-card to-card">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Purchasing</span>
            <div className="h-8 w-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <div className="text-2xl font-black text-foreground">
              {formatCurrency(summary.total_purchases)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="h-4 text-[10px] px-1.5 font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {summary.total_purchases_count} Invoices
              </Badge>
              <span>raw materials bought</span>
            </div>
          </CardContent>
        </Card>

        {/* Gross Profit & Margin */}
        <Card className="border border-border/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-violet-500/10 via-card to-card">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Gross Profit</span>
            <div className="h-8 w-8 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <div className={`text-2xl font-black ${isProfitable ? "text-emerald-500" : "text-destructive"}`}>
              {formatCurrency(summary.gross_profit)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="h-4 text-[10px] px-1.5 font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                {summary.margin_percent}% margin
              </Badge>
              <span>sales − purchases</span>
            </div>
          </CardContent>
        </Card>

        {/* Raw Materials Stock Value */}
        <Card className="border border-border/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-amber-500/10 via-card to-card">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stock Asset Value</span>
            <div className="h-8 w-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Boxes className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <div className="text-2xl font-black text-foreground">
              {formatCurrency(summary.stock_value)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="h-4 text-[10px] px-1.5 font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {summary.total_raw_materials} Items
              </Badge>
              {summary.low_stock_count > 0 && (
                <span className="text-amber-500 text-[11px] font-semibold flex items-center gap-0.5">
                  <AlertTriangle className="h-3 w-3" /> {summary.low_stock_count} low
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Balance Ratio Bar ── */}
      <Card className="p-4 bg-card border-border">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span>Sales Revenue: {formatCurrency(summary.total_sales)} ({salesPercent}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span>
              <span>Purchasing Expenses: {formatCurrency(summary.total_purchases)} ({purchasesPercent}%)</span>
            </div>
          </div>

          <div className="h-3.5 w-full bg-muted rounded-full overflow-hidden flex p-0.5">
            <div
              style={{ width: `${salesPercent}%` }}
              className="h-full bg-emerald-500 rounded-l-full transition-all duration-500"
            />
            <div
              style={{ width: `${purchasesPercent}%` }}
              className="h-full bg-blue-500 rounded-r-full transition-all duration-500"
            />
          </div>
        </div>
      </Card>

      {/* ── Side-by-Side Ledgers: Recent Sales vs Recent Purchases ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Sales Ledger */}
        <Card className="border border-border/80 shadow-xs flex flex-col">
          <CardHeader className="p-4 pb-3 border-b border-border/80 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Recent Sales (POS & Online)
            </CardTitle>
            <button
              type="button"
              onClick={() => onNavigateTab("terminal")}
              className="text-xs text-primary font-semibold hover:underline"
            >
              Open POS Register →
            </button>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-x-auto">
            {recent_sales.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No sales recorded in this period yet.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 font-semibold">Order #</th>
                    <th className="text-left py-2 px-3 font-semibold">Customer</th>
                    <th className="text-center py-2 px-3 font-semibold">Type</th>
                    <th className="text-right py-2 px-3 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recent_sales.map((order) => (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-foreground">
                        {order.order_number}
                        <div className="text-[10px] text-muted-foreground font-normal">
                          {formatDate(order.created_at, { timeStyle: "short", dateStyle: "short" })}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 truncate max-w-[120px]">
                        {order.customer_name || "Guest"}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold h-5">
                          {order.fulfillment_type || "dine_in"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(order.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Recent Purchases Ledger */}
        <Card className="border border-border/80 shadow-xs flex flex-col">
          <CardHeader className="p-4 pb-3 border-b border-border/80 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-500" />
              Recent Purchasing Invoices
            </CardTitle>
            <button
              type="button"
              onClick={() => onNavigateTab("purchases")}
              className="text-xs text-primary font-semibold hover:underline"
            >
              View All Purchases →
            </button>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-x-auto">
            {recent_purchases.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No purchase invoices recorded yet. Click "Record Purchase" to add.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 font-semibold">Date</th>
                    <th className="text-left py-2 px-3 font-semibold">Supplier</th>
                    <th className="text-center py-2 px-3 font-semibold">Status</th>
                    <th className="text-right py-2 px-3 font-semibold">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recent_purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-foreground">
                        {formatDate(p.purchase_date, { dateStyle: "short" })}
                        <div className="text-[10px] text-muted-foreground font-mono">
                          PO #{p.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-foreground truncate max-w-[140px]">
                          {p.supplier_name || "Supplier"}
                        </div>
                        {p.supplier_company && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                            {p.supplier_company}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] uppercase font-bold h-5 ${
                            p.status === "received"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-blue-600 dark:text-blue-400">
                        {formatCurrency(p.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Top Consumed Raw Materials Banner ("Wo Kaha Use Hua") ── */}
      <Card className="p-4 border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Top Raw Materials Consumed in Kitchen ("Kaha Use Hua")
            </h4>
            <p className="text-xs text-muted-foreground">
              Ingredients automatically deducted as dishes were prepared and sold.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab("usage")}
            className="text-xs text-primary font-semibold hover:underline"
          >
            Detailed Usage History →
          </button>
        </div>

        {top_used_materials.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
            No ingredients consumed yet. Map recipes to menu items to track real-time consumption!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {top_used_materials.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-xl border border-border bg-muted/20 space-y-1"
              >
                <div className="font-bold text-xs text-foreground truncate">{m.name}</div>
                <div className="text-lg font-black text-primary">
                  {m.total_quantity_used} <span className="text-xs font-medium text-muted-foreground">{m.unit}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Approx Cost: <strong className="text-foreground">{formatCurrency(m.total_cost_used)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
