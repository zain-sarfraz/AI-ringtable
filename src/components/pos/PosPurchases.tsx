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
    <div className="space-y-4">
      {/* ── Top Bar with Tab Switcher ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Purchasing & Suppliers
            </h3>
            <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("invoices")}
                className={`px-3 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "invoices"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span>Invoices ({purchases.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("suppliers")}
                className={`px-3 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "suppliers"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span>All Suppliers ({suppliers.length})</span>
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {activeTab === "invoices" ? (
              <>
                Total Purchased: <strong className="text-foreground">{formatCurrency(totalSpent, activeCurrency)}</strong> across{" "}
                {purchases.length} invoices.
              </>
            ) : (
              <>
                Active Vendors: <strong className="text-foreground">{suppliers.length} suppliers</strong> · Total Spent:{" "}
                <strong className="text-foreground">{formatCurrency(totalSuppliersSpent, activeCurrency)}</strong>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "invoices" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveTab("suppliers")}
                className="h-9 text-xs gap-1.5"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Manage Suppliers ({suppliers.length})
              </Button>
              <Button
                type="button"
                onClick={onOpenNewPurchase}
                className="h-9 text-xs font-semibold gap-1.5 gradient-primary shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
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
                className="h-9 text-xs gap-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                View Invoices ({purchases.length})
              </Button>
              {onOpenSupplierDialog && (
                <Button
                  type="button"
                  onClick={() => onOpenSupplierDialog(null)}
                  className="h-9 text-xs font-semibold gap-1.5 gradient-primary shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Supplier
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={
            activeTab === "invoices"
              ? "Search by supplier, PO #, notes..."
              : "Search suppliers by name, company, phone, email, address..."
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs bg-card"
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
                            {formatCurrency(p.total_amount, activeCurrency)}
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
                                  {formatCurrency(line.unit_price, activeCurrency)}
                                </div>
                                <div className="col-span-2 text-right font-bold text-foreground">
                                  {formatCurrency(line.total_price, activeCurrency)}
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
