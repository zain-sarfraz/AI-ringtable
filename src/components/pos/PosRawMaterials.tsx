import { useState, useMemo } from "react";
import {
  Boxes,
  Plus,
  Search,
  ArrowDownUp,
  AlertTriangle,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/i18n/formatters";

export interface RawMaterialItem {
  id: string;
  name: string;
  sku?: string | null;
  category_name?: string | null;
  unit: string;
  cost_price: number;
  current_stock: number;
  minimum_stock: number;
  supplier_name?: string | null;
  supplier_company?: string | null;
  supplier_id?: string | null;
  total_purchased: number;
  total_used: number;
  stock_value: number;
  stock_status: "in_stock" | "low_stock" | "out_of_stock";
  notes?: string | null;
  status: string;
}

interface Props {
  materials: RawMaterialItem[];
  onOpenAddMaterial: () => void;
  onOpenEditMaterial: (item: RawMaterialItem) => void;
  onOpenAdjustStock: (item: RawMaterialItem) => void;
  onDeleteMaterial: (id: string) => void;
}

export function PosRawMaterials({
  materials,
  onOpenAddMaterial,
  onOpenEditMaterial,
  onOpenAdjustStock,
  onDeleteMaterial,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "low_stock" | "out_of_stock">("all");

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      const matchSearch =
        !search.trim() ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.sku && m.sku.toLowerCase().includes(search.toLowerCase())) ||
        (m.supplier_name && m.supplier_name.toLowerCase().includes(search.toLowerCase()));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "low_stock" && m.stock_status === "low_stock") ||
        (statusFilter === "out_of_stock" && m.stock_status === "out_of_stock");

      return matchSearch && matchStatus;
    });
  }, [materials, search, statusFilter]);

  const totalStockValue = materials.reduce((sum, m) => sum + m.stock_value, 0);
  const lowStockCount = materials.filter((m) => m.stock_status === "low_stock").length;
  const outOfStockCount = materials.filter((m) => m.stock_status === "out_of_stock").length;

  return (
    <div className="space-y-4">
      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            Raw Materials & Ingredients Inventory
          </h3>
          <p className="text-xs text-muted-foreground">
            {materials.length} Raw Materials · Total Stock Value:{" "}
            <strong className="text-foreground">{formatCurrency(totalStockValue)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onOpenAddMaterial}
            className="h-9 text-xs font-semibold gap-1.5 gradient-primary shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Raw Material
          </Button>
        </div>
      </div>

      {/* ── Filter / Search Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search raw material name, SKU, or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs bg-card"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            All ({materials.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("low_stock")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === "low_stock" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold" : "text-muted-foreground"
            }`}
          >
            ⚠️ Low Stock ({lowStockCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("out_of_stock")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === "out_of_stock" ? "bg-destructive/15 text-destructive font-bold" : "text-muted-foreground"
            }`}
          >
            ❌ Out of Stock ({outOfStockCount})
          </button>
        </div>
      </div>

      {/* ── Materials Table ── */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <Boxes className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <h4 className="text-sm font-semibold">No raw materials found</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {search ? `No materials matching "${search}"` : "Add ingredients (Chicken, Beef, Buns, Oil, Packaging) to start tracking usage."}
          </p>
          {!search && (
            <Button onClick={onOpenAddMaterial} size="sm" className="mt-4 h-8 text-xs font-semibold gradient-primary">
              <Plus className="h-3 w-3 mr-1" /> Add First Raw Material
            </Button>
          )}
        </Card>
      ) : (
        <Card className="border border-border/80 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground text-[11px]">
                  <th className="text-left py-2.5 px-3 font-semibold">Material Name</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Stock Status</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Current Stock</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Cost / Unit</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Asset Value</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Total Purchased</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Total Used</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((item) => {
                  return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-foreground text-xs">{item.name}</div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {item.sku && <span>SKU: {item.sku}</span>}
                          {item.supplier_name && <span>· Supplier: {item.supplier_name}</span>}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        {item.stock_status === "out_of_stock" ? (
                          <Badge variant="destructive" className="h-5 text-[10px] uppercase font-bold">
                            Out of Stock
                          </Badge>
                        ) : item.stock_status === "low_stock" ? (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            Low Stock (≤{item.minimum_stock})
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            In Stock
                          </Badge>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <span className="font-extrabold text-foreground text-sm">
                          {item.current_stock}
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground font-medium">{item.unit}</span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-medium text-muted-foreground">
                        {formatCurrency(item.cost_price)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-bold text-foreground">
                        {formatCurrency(item.stock_value)}
                      </td>

                      <td className="py-2.5 px-3 text-center text-blue-600 dark:text-blue-400 font-semibold">
                        +{item.total_purchased} {item.unit}
                      </td>

                      <td className="py-2.5 px-3 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
                        {item.total_used > 0 ? `-${item.total_used} ${item.unit}` : "0"}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenAdjustStock(item)}
                            className="h-7 text-[11px] px-2 gap-1"
                            title="Adjust stock (waste, damage, refill)"
                          >
                            <ArrowDownUp className="h-3 w-3" />
                            Adjust
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onOpenEditMaterial(item)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteMaterial(item.id)}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
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
