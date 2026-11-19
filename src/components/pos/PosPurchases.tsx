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
  Truck,
  Phone,
  Mail,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate, getDefaultCurrency } from "@/i18n/formatters";
import { SupplierItem } from "./PosSupplierDialog";

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
  suppliers?: SupplierItem[];
  currency?: string;
  onOpenNewPurchase: () => void;
  onOpenNewPurchaseWithSupplier?: (supplierId: string) => void;
  onOpenSupplierDialog?: (supplier?: SupplierItem | null) => void;
  onDeleteSupplier?: (supplierId: string) => void;
}

export function PosPurchases({
  purchases,
  suppliers = [],
  currency,
  onOpenNewPurchase,
  onOpenNewPurchaseWithSupplier,
  onOpenSupplierDialog,
  onDeleteSupplier,
}: Props) {
  const activeCurrency = currency || getDefaultCurrency();
  const [activeTab, setActiveTab] = useState<"invoices" | "suppliers">("invoices");
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

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      const name = (s.name || "").toLowerCase();
      const comp = (s.company_name || "").toLowerCase();
      const phone = (s.phone || "").toLowerCase();
      const email = (s.email || "").toLowerCase();
      const addr = (s.address || "").toLowerCase();
      return name.includes(q) || comp.includes(q) || phone.includes(q) || email.includes(q) || addr.includes(q);
    });
  }, [suppliers, search]);

  const totalSpent = purchases.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
  const totalSuppliersSpent = suppliers.reduce((sum, s) => sum + (Number(s.total_spent) || 0), 0);

  return (
    <div className="min-w-0 space-y-4">
      {/* ── Top Bar with Tab Switcher ── */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
            <span className="leading-tight">Purchasing & Suppliers</span>
          </h3>

          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("invoices")}
              className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-semibold transition-all sm:gap-1.5 sm:px-3 ${
                activeTab === "invoices"
                  ? "bg-background font-bold text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">Invoices ({purchases.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("suppliers")}
              className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-semibold transition-all sm:gap-1.5 sm:px-3 ${
                activeTab === "suppliers"
                  ? "bg-background font-bold text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">Suppliers ({suppliers.length})</span>
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            {activeTab === "invoices" ? (
              <>
                Total Purchased:{" "}
                <strong className="text-foreground">
                  {formatCurrency(totalSpent, activeCurrency)}
                </strong>{" "}
                across {purchases.length} invoices.
              </>
            ) : (
              <>
                Active Vendors:{" "}
                <strong className="text-foreground">
                  {suppliers.length} suppliers
                </strong>{" "}
                · Total Spent:{" "}
                <strong className="text-foreground">
                  {formatCurrency(totalSuppliersSpent, activeCurrency)}
                </strong>
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
          {activeTab === "invoices" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveTab("suppliers")}
                className="h-9 w-full gap-1.5 text-xs sm:w-auto"
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">Manage Suppliers ({suppliers.length})</span>
              </Button>
              <Button
                type="button"
                onClick={onOpenNewPurchase}
                className="h-9 w-full gap-1.5 text-xs font-semibold gradient-primary shadow-xs sm:w-auto"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Record Purchase
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveTab("invoices")}
                className="h-9 w-full gap-1.5 text-xs sm:w-auto"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">View Invoices ({purchases.length})</span>
              </Button>
              {onOpenSupplierDialog && (
                <Button
                  type="button"
                  onClick={() => onOpenSupplierDialog(null)}
                  className="h-9 w-full gap-1.5 text-xs font-semibold gradient-primary shadow-xs sm:w-auto"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  Add Supplier
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="relative min-w-0">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={
            activeTab === "invoices"
              ? "Search supplier, PO #, notes..."
              : "Search suppliers..."
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 bg-card pl-9 text-xs"
        />
      </div>

      {/* ── TAB 1: Invoices List ── */}
      {activeTab === "invoices" && (
        <>
          {filteredPurchases.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground border-dashed">
              <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-sm font-semibold">No purchase records found</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search
                  ? `No results matching "${search}"`
                  : "Click 'Record Purchase' to add incoming raw materials from vendors."}
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
                    className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all hover:border-primary/30"
                  >
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      className="flex cursor-pointer select-none flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-xs font-bold text-blue-600 dark:text-blue-400">
                          PO
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-extrabold text-foreground">
                              {p.supplier_name || "Unknown Supplier"}
                            </span>
                            {p.supplier_company ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {p.supplier_company}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="font-mono">PO #{p.id.slice(0, 8)}</span>
                            <span aria-hidden>·</span>
                            <span>{formatDate(p.purchase_date, { dateStyle: "medium" })}</span>
                            <span aria-hidden>·</span>
                            <span>
                              {itemsCount} item{itemsCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                        <div className="text-left sm:text-right">
                          <div className="text-base font-black tabular-nums text-foreground">
                            {formatCurrency(p.total_amount, activeCurrency)}
                          </div>
                          <Badge
                            variant="secondary"
                            className={`mt-0.5 h-5 px-1.5 text-[10px] font-bold uppercase ${
                              p.status === "received"
                                ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {p.status === "received" ? "✓ Stock Received" : "Pending"}
                          </Badge>
                        </div>

                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="animate-fade-in space-y-3 border-t border-border bg-muted/10 p-3 sm:p-4">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:text-xs">
                          Purchased Raw Materials Breakdown
                        </div>

                        {p.items && p.items.length > 0 ? (
                          <>
                            <div className="hidden overflow-hidden rounded-xl border border-border bg-background sm:block">
                              <div className="grid grid-cols-12 gap-2 bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                                <div className="col-span-6">Material Item</div>
                                <div className="col-span-2 text-center">Quantity</div>
                                <div className="col-span-2 text-right">Unit Price</div>
                                <div className="col-span-2 text-right">Total</div>
                              </div>
                              {p.items.map((line) => (
                                <div
                                  key={line.id}
                                  className="grid grid-cols-12 items-center gap-2 border-t border-border px-3 py-2 text-xs"
                                >
                                  <div className="col-span-6 font-semibold text-foreground">
                                    {line.item_name}
                                  </div>
                                  <div className="col-span-2 text-center font-medium">
                                    {line.quantity} {line.item_unit}
                                  </div>
                                  <div className="col-span-2 text-right text-muted-foreground">
                                    {formatCurrency(line.unit_price, activeCurrency)}
                                  </div>
                                  <div className="col-span-2 text-right font-bold text-foreground">
                                    {formatCurrency(line.total_price, activeCurrency)}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2 sm:hidden">
                              {p.items.map((line) => (
                                <div
                                  key={line.id}
                                  className="rounded-xl border border-border bg-background p-3 text-xs"
                                >
                                  <div className="font-semibold text-foreground">
                                    {line.item_name}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-muted-foreground">
                                    <span>
                                      {line.quantity} {line.item_unit}
                                    </span>
                                    <span>
                                      {formatCurrency(line.unit_price, activeCurrency)} / unit
                                    </span>
                                    <span className="font-bold text-foreground">
                                      {formatCurrency(line.total_price, activeCurrency)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">
                            No line items details recorded.
                          </p>
                        )}

                        {p.notes && (
                          <div className="rounded-lg bg-muted/20 p-2.5 text-xs text-muted-foreground">
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
        </>
      )}

      {/* ── TAB 2: All Suppliers List ── */}
      {activeTab === "suppliers" && (
        <>
          {filteredSuppliers.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground border-dashed">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-sm font-semibold">No suppliers found</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search
                  ? `No suppliers matching "${search}"`
                  : "Add vendors and distributors to easily record incoming raw materials and ingredient purchases."}
              </p>
              {onOpenSupplierDialog && !search && (
                <Button
                  onClick={() => onOpenSupplierDialog(null)}
                  size="sm"
                  className="mt-4 h-8 text-xs font-semibold gradient-primary"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add First Supplier
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredSuppliers.map((s) => (
                <Card
                  key={s.id}
                  className="p-4 border border-border/80 bg-card hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                          <Truck className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-foreground leading-tight">
                            {s.name}
                          </h4>
                          {s.company_name && (
                            <p className="text-xs text-muted-foreground font-medium">
                              {s.company_name}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {onOpenSupplierDialog && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onOpenSupplierDialog(s)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Edit Supplier"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {onDeleteSupplier && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteSupplier(s.id)}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete Supplier"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Contact Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-xs text-muted-foreground">
                      {s.phone && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Phone className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          <span className="truncate">{s.phone}</span>
                        </div>
                      )}
                      {s.email && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Mail className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          <span className="truncate">{s.email}</span>
                        </div>
                      )}
                      {s.address && (
                        <div className="flex items-center gap-1.5 truncate sm:col-span-2">
                          <MapPin className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          <span className="truncate">{s.address}</span>
                        </div>
                      )}
                    </div>

                    {s.notes && (
                      <p className="text-[11px] text-muted-foreground italic bg-muted/30 p-2 rounded-lg">
                        {s.notes}
                      </p>
                    )}
                  </div>

                  {/* Supplier Purchasing Stats & Action */}
                  <div className="pt-2.5 border-t border-border/60 flex items-center justify-between text-xs gap-2">
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">
                        Purchases History
                      </div>
                      <div className="font-extrabold text-foreground">
                        {s.total_purchases || 0} order{s.total_purchases === 1 ? "" : "s"} ·{" "}
                        <span className="text-primary">{formatCurrency(s.total_spent || 0, activeCurrency)}</span>
                      </div>
                    </div>

                    {onOpenNewPurchaseWithSupplier && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenNewPurchaseWithSupplier(s.id)}
                        className="h-7 text-xs font-semibold gap-1 shrink-0"
                      >
                        <Plus className="h-3 w-3" /> Record Purchase
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
