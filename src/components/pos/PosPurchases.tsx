import { useState, useMemo } from "react";
import {
  ShoppingCart,
  Plus,
  Search,
  Calendar,
  Building2,
  FileText,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/i18n/formatters";

interface PurchaseItemLine {
  id: string;
  item_name: string;
  item_unit: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface PurchaseRecord {
  id: string;
  purchase_date: string;
  total_amount: number;
  status: string;
  notes?: string | null;
  supplier_name?: string | null;
  supplier_company?: string | null;
  supplier_phone?: string | null;
  items: PurchaseItemLine[];
}

interface Props {
  purchases: PurchaseRecord[];
  onOpenNewPurchase: () => void;
  onOpenSupplierDialog?: () => void;
}

export function PosPurchases({ purchases, onOpenNewPurchase, onOpenSupplierDialog }: Props) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      const supp = (p.supplier_name || "").toLowerCase();
      const comp = (p.supplier_company || "").toLowerCase();
      const notes = (p.notes || "").toLowerCase();
      const po = p.id.toLowerCase();
      return supp.includes(q) || comp.includes(q) || notes.includes(q) || po.includes(q);
    });
  }, [purchases, search]);

  const totalSpent = purchases.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);

  return (
    <div className="space-y-4">
      {/* ── Top Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Purchasing & Supplier Invoices
          </h3>
          <p className="text-xs text-muted-foreground">
            Total Purchased: <strong className="text-foreground">{formatCurrency(totalSpent)}</strong> across{" "}
            {purchases.length} invoices.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenSupplierDialog && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenSupplierDialog}
              className="h-9 text-xs gap-1.5"
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              Manage Suppliers
            </Button>
          )}

          <Button
            type="button"
            onClick={onOpenNewPurchase}
            className="h-9 text-xs font-semibold gap-1.5 gradient-primary shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Record Purchase
          </Button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by supplier, PO #, notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs bg-card"
        />
      </div>

      {/* ── Purchases List ── */}
      {filteredPurchases.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <h4 className="text-sm font-semibold">No purchase records found</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {search ? `No results matching "${search}"` : "Click 'Record Purchase' to add incoming raw materials from vendors."}
          </p>
          {!search && (
            <Button onClick={onOpenNewPurchase} size="sm" className="mt-4 h-8 text-xs font-semibold gradient-primary">
              <Plus className="h-3 w-3 mr-1" /> Record First Purchase
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredPurchases.map((p) => {
            const isExpanded = expandedId === p.id;
            const itemsCount = p.items?.length || 0;

            return (
              <Card
                key={p.id}
                className="border border-border/80 bg-card overflow-hidden transition-all hover:border-primary/30"
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                      PO
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-foreground">
                          {p.supplier_name || "Unknown Supplier"}
                        </span>
                        {p.supplier_company && (
                          <span className="text-xs text-muted-foreground truncate">({p.supplier_company})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-mono">PO #{p.id.slice(0, 8)}</span>
                        <span>·</span>
                        <span>{formatDate(p.purchase_date, { dateStyle: "medium" })}</span>
                        <span>·</span>
                        <span>{itemsCount} item{itemsCount === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-base font-black text-foreground">
                        {formatCurrency(p.total_amount)}
                      </div>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] uppercase font-bold h-4 px-1.5 ${
                          p.status === "received"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {p.status === "received" ? "✓ Stock Received" : "Pending"}
                      </Badge>
                    </div>

                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Invoice Line Items */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/10 p-4 space-y-3 animate-fade-in">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Purchased Raw Materials Breakdown
                    </div>

                    {p.items && p.items.length > 0 ? (
                      <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-background">
                        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <div className="col-span-6">Material Item</div>
                          <div className="col-span-2 text-center">Quantity</div>
                          <div className="col-span-2 text-right">Unit Price</div>
                          <div className="col-span-2 text-right">Total</div>
                        </div>

                        {p.items.map((line) => (
                          <div key={line.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center">
                            <div className="col-span-6 font-semibold text-foreground">
                              {line.item_name}
                            </div>
                            <div className="col-span-2 text-center font-medium">
                              {line.quantity} {line.item_unit}
                            </div>
                            <div className="col-span-2 text-right text-muted-foreground">
                              {formatCurrency(line.unit_price)}
                            </div>
                            <div className="col-span-2 text-right font-bold text-foreground">
                              {formatCurrency(line.total_price)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No line items details recorded.</p>
                    )}

                    {p.notes && (
                      <div className="text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg">
                        <strong>Invoice Notes:</strong> {p.notes}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
