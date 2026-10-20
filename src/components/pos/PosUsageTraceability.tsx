import { useState, useMemo } from "react";
import {
  Search,
  History,
  Filter,
  ArrowDownRight,
  ArrowUpRight,
  ShoppingCart,
  Calendar,
  UtensilsCrossed,
  Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/i18n/formatters";

export interface UsageTransaction {
  id: string;
  transaction_type: "purchase" | "sale" | "adjustment";
  quantity: number;
  unit: string;
  approx_cost: number;
  notes?: string | null;
  created_at: string;
  item_id: string;
  item_name: string;
  current_stock: number;
  order_id?: string | null;
  order_number?: string | null;
  customer_name?: string | null;
  fulfillment_type?: string | null;
  supplier_name?: string | null;
}

interface RawMaterialOption {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

interface Props {
  rawMaterials: RawMaterialOption[];
  history: UsageTransaction[];
  selectedMaterialId: string;
  onSelectMaterialId: (id: string) => void;
  summary: {
    total_purchased_qty: number;
    total_used_qty: number;
    total_adjusted_qty: number;
  };
}

export function PosUsageTraceability({
  rawMaterials,
  history,
  selectedMaterialId,
  onSelectMaterialId,
  summary,
}: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "sale" | "purchase" | "adjustment">("all");

  const selectedMaterial = rawMaterials.find((m) => m.id === selectedMaterialId);

  const filteredHistory = useMemo(() => {
    return history.filter((h) => {
      const matchType = typeFilter === "all" || h.transaction_type === typeFilter;
      const q = search.toLowerCase().trim();
      if (!q) return matchType;
      const name = (h.item_name || "").toLowerCase();
      const notes = (h.notes || "").toLowerCase();
      const ord = (h.order_number || "").toLowerCase();
      const cust = (h.customer_name || "").toLowerCase();
      return matchType && (name.includes(q) || notes.includes(q) || ord.includes(q) || cust.includes(q));
    });
  }, [history, search, typeFilter]);

  return (
    <div className="space-y-5">
      {/* ── Top Header & Material Selector ── */}
      <div className="bg-card p-4 rounded-2xl border border-border space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Raw Materials Usage & Traceability ("Wo Kaha Use Hua")
            </h3>
            <p className="text-xs text-muted-foreground">
              Trace exact consumption: see which customer orders and recipes used your purchased raw materials.
            </p>
          </div>

          <div className="w-full sm:w-72">
            <Select value={selectedMaterialId || "all"} onValueChange={onSelectMaterialId}>
              <SelectTrigger className="h-9 text-xs bg-background">
                <SelectValue placeholder="All Raw Materials" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">🔍 All Raw Materials (Complete Log)</SelectItem>
                {rawMaterials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.unit}) · Stock: {m.current_stock}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Selected material summary metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/60">
          <div className="p-3 bg-muted/20 rounded-xl border border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Total Purchased
            </span>
            <div className="text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5">
              +{summary.total_purchased_qty}{" "}
              <span className="text-xs font-normal text-muted-foreground">{selectedMaterial?.unit || "units"}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">from supplier invoices</p>
          </div>

          <div className="p-3 bg-muted/20 rounded-xl border border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Consumed in Orders
            </span>
            <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              -{summary.total_used_qty}{" "}
              <span className="text-xs font-normal text-muted-foreground">{selectedMaterial?.unit || "units"}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">used in sold recipes</p>
          </div>

          <div className="p-3 bg-muted/20 rounded-xl border border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Adjustments / Waste
            </span>
            <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">
              {summary.total_adjusted_qty}{" "}
              <span className="text-xs font-normal text-muted-foreground">{selectedMaterial?.unit || "units"}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">spoilage or manual audit</p>
          </div>

          <div className="p-3 bg-muted/20 rounded-xl border border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Current Available Stock
            </span>
            <div className="text-lg font-black text-foreground mt-0.5">
              {selectedMaterial ? selectedMaterial.current_stock : "In Store"}{" "}
              <span className="text-xs font-normal text-muted-foreground">{selectedMaterial?.unit || ""}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">ready in inventory</p>
          </div>
        </div>
      </div>

      {/* ── Filters & Search ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order #, recipe dish, customer, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs bg-card"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              typeFilter === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            All Activity
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter("sale")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              typeFilter === "sale" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold" : "text-muted-foreground"
            }`}
          >
            🍽️ Order Sales (Used)
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter("purchase")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              typeFilter === "purchase" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold" : "text-muted-foreground"
            }`}
          >
            🚚 Purchases (Added)
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter("adjustment")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              typeFilter === "adjustment" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold" : "text-muted-foreground"
            }`}
          >
            ⚖️ Adjustments
          </button>
        </div>
      </div>

      {/* ── Detailed Usage Audit Table ── */}
      {filteredHistory.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <h4 className="text-sm font-semibold">No usage records found</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {search ? `No activity matching "${search}"` : "Whenever orders are completed in POS, ingredient deductions will show up here in real time."}
          </p>
        </Card>
      ) : (
        <Card className="border border-border/80 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground text-[11px]">
                  <th className="text-left py-2.5 px-3 font-semibold">Date & Time</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Raw Material</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Activity Type</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Where Used / Reference</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Quantity Delta</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Approx Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredHistory.map((item) => {
                  const isSale = item.transaction_type === "sale";
                  const isPurchase = item.transaction_type === "purchase";

                  return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(item.created_at, { dateStyle: "short", timeStyle: "short" })}
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="font-bold text-foreground">{item.item_name}</span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        {isSale ? (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            🍽️ Order Sale
                          </Badge>
                        ) : isPurchase ? (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            🚚 Purchased
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            ⚖️ Adjustment
                          </Badge>
                        )}
                      </td>

                      <td className="py-2.5 px-3">
                        {isSale && item.order_number ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <span className="text-primary font-mono">{item.order_number}</span>
                              {item.customer_name && <span>· {item.customer_name}</span>}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {item.notes || `Used in order (${item.fulfillment_type || "sale"})`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{item.notes || "—"}</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-black text-sm ${
                            isSale ? "text-emerald-600 dark:text-emerald-400" : isPurchase ? "text-blue-600 dark:text-blue-400" : "text-amber-500"
                          }`}
                        >
                          {isSale ? `-${item.quantity}` : isPurchase ? `+${item.quantity}` : `${item.quantity > 0 ? "+" : ""}${item.quantity}`}{" "}
                          <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                        {formatCurrency(item.approx_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
