import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  TableProperties,
  Users,
  MapPin,
  Phone,
  RefreshCw,
  Plus,
  Receipt,
  UtensilsCrossed,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateManualOrderDialog } from "@/components/orders/CreateManualOrderDialog";
import { OrderReceipt } from "@/components/orders/OrderReceipt";
import { formatCurrency } from "@/lib/restaurant";
import { getOrderStatusLabel } from "@/i18n/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";

type OrderItem = {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type SessionOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  items?: OrderItem[];
};

type TableSessionBill = {
  session?: {
    id: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    table_number?: string;
    status?: string;
    opened_at?: string;
  };
  orders?: SessionOrder[];
  totals?: { order_count: number; subtotal: number; tax_amount: number; total_amount: number };
};

type FloorTable = {
  id: string;
  table_number: string;
  capacity: number;
  location?: string | null;
  notes?: string | null;
  is_active: boolean;
  occupied: boolean;
  sessions: TableSessionBill[];
};

type FloorData = {
  tables: FloorTable[];
  unmatched_sessions?: TableSessionBill[];
  summary: { total_tables: number; occupied: number; available: number; open_bills: number };
};

const displayTable = (num?: string | null) => {
  if (!num) return "Table";
  return /^table\b/i.test(num.trim()) ? num.trim() : `Table ${num.trim()}`;
};

export default function StaffTables() {
  const { restaurantId, activeRestaurant } = useActiveRestaurant();
  const [data, setData] = useState<FloorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [heldReceipt, setHeldReceipt] = useState<{
    order: any;
    items: OrderItem[];
    tableSession: TableSessionBill;
  } | null>(null);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const load = useCallback(async (silent = false) => {
    if (!restaurantId) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/restaurants/${restaurantId}/floor-tables`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load tables");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      if (!silent) toast.error(err.message || "Could not load tables");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!restaurantId) return;
    const timer = setInterval(() => {
      void load(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [restaurantId, load]);

  const tables = useMemo(() => {
    const list = (data?.tables || []).filter((t) => t.is_active !== false || t.occupied);
    const extras: FloorTable[] = (data?.unmatched_sessions || []).map((bill, idx) => ({
      id: `session-${bill.session?.id || idx}`,
      table_number: bill.session?.table_number || `Open ${idx + 1}`,
      capacity: 0,
      location: null,
      notes: "Opened from QR / staff order",
      is_active: true,
      occupied: true,
      sessions: [bill],
    }));
    const merged = [...list];
    const tableKey = (value?: string | null) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^table[\s._-]*/i, "")
        .trim();
    for (const extra of extras) {
      const extraKey = tableKey(extra.table_number);
      const match = merged.find((t) => t.id === extra.id || tableKey(t.table_number) === extraKey);
      if (match) {
        if (!match.sessions.some((s) => s.session?.id && s.session.id === extra.sessions[0]?.session?.id)) {
          match.sessions = [...match.sessions, ...extra.sessions];
          match.occupied = true;
        }
      } else {
        merged.push(extra);
      }
    }
    return merged.sort((a, b) => {
      const na = parseInt(a.table_number, 10);
      const nb = parseInt(b.table_number, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.table_number).localeCompare(String(b.table_number), undefined, { numeric: true });
    });
  }, [data]);

  useEffect(() => {
    if (!tables.length) return;
    if (selectedId && tables.some((t) => t.id === selectedId)) return;
    const firstBusy = tables.find((t) => t.occupied);
    setSelectedId((firstBusy || tables[0]).id);
  }, [tables, selectedId]);

  const selected = tables.find((t) => t.id === selectedId) || null;
  const bills = selected?.sessions || [];
  const primary = bills[0] || null;
  const allOrders = bills.flatMap((b) => b.orders || []);
  const grandTotal = bills.reduce((s, b) => s + Number(b.totals?.total_amount || 0), 0);

  const buildReceiptPayload = () => {
    if (!allOrders[0] || !selected) return null;
    return {
      order: {
        id: allOrders[0].id,
        order_number: allOrders[0].order_number,
        tracking_code: allOrders[0].order_number,
        customer_name: primary?.session?.customer_name || "Guest",
        customer_phone: primary?.session?.customer_phone || "",
        fulfillment_type: "dine_in",
        payment_method: "cash",
        payment_status: "pending",
        status: allOrders[0].status,
        subtotal: bills.reduce((s, b) => s + Number(b.totals?.subtotal || 0), 0),
        tax_amount: bills.reduce((s, b) => s + Number(b.totals?.tax_amount || 0), 0),
        delivery_fee: 0,
        discount_amount: 0,
        total_amount: grandTotal,
        created_at: allOrders[0].created_at,
        table_number: selected.table_number,
      },
      items: allOrders.flatMap((o) => o.items || []),
      tableSession: {
        session: { ...primary?.session, table_number: selected.table_number },
        orders: allOrders,
        totals: { order_count: allOrders.length, subtotal: grandTotal, tax_amount: 0, total_amount: grandTotal },
      },
    };
  };

  const printCurrentBill = (payload = buildReceiptPayload()) => {
    if (!payload) {
      toast.error("No orders on this table to print");
      return;
    }
    setHeldReceipt(payload);
    setTimeout(() => window.print(), 150);
  };

  const closeTable = async () => {
    if (!selected || allOrders.length === 0) return;
    const payload = buildReceiptPayload();
    if (payload) setHeldReceipt(payload);
    setClosing(true);
    try {
      const res = await fetch(`${getApiBase()}/api/restaurants/${restaurantId}/close-table`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          table_id: UUID_RE.test(selected.id) ? selected.id : null,
          table_number: selected.table_number,
          order_ids: allOrders.map((o) => o.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to close table");
      toast.success("Table is available again.");
      await load();
      setTimeout(() => window.print(), 200);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div>
    <PageShell className="no-print max-w-[1680px] space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight sm:text-2xl">Tables</h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Floor view · {activeRestaurant?.name || "your restaurant"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full gap-1.5 rounded-xl sm:w-auto"
          onClick={load}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {[
          { label: "Total", value: tables.length || data?.summary.total_tables || 0, icon: TableProperties, tone: "text-foreground", bg: "bg-muted/60" },
          { label: "Occupied", value: tables.filter((t) => t.occupied).length, icon: UtensilsCrossed, tone: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10" },
          { label: "Available", value: tables.filter((t) => !t.occupied).length, icon: CheckCircle2, tone: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Open bills", value: data?.summary.open_bills ?? tables.filter((t) => t.occupied).length, icon: Receipt, tone: "text-violet-700 dark:text-violet-400", bg: "bg-violet-500/10" },
        ].map((card) => (
          <Card key={card.label} className="overflow-hidden rounded-2xl border border-border/70 shadow-xs">
            <CardContent className="p-3.5">
              {loading && !data ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{card.label}</p>
                    <p className={cn("mt-0.5 text-xl font-black tracking-tight", card.tone)}>{card.value}</p>
                  </div>
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", card.bg, card.tone)}>
                    <card.icon className="h-[18px] w-[18px]" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_1fr] gap-5">
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="border-b border-border/80 bg-muted/30 px-4 py-3 pb-4">
            <CardTitle className="text-sm font-bold">All tables ({tables.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-3 max-h-[70vh] overflow-y-auto space-y-2">
            {loading && !data ? (
              <Skeleton className="h-40 w-full" />
            ) : tables.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No tables configured yet.</p>
            ) : (
              tables.map((table) => {
                const guest = table.sessions[0]?.session;
                const orders = table.sessions.reduce((n, s) => n + (s.orders?.length || 0), 0);
                const total = table.sessions.reduce((n, s) => n + Number(s.totals?.total_amount || 0), 0);
                const active = selectedId === table.id;
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => setSelectedId(table.id)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : table.occupied
                        ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                        : "border-border/70 hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm">{displayTable(table.table_number)}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-bold",
                          table.occupied
                            ? "bg-amber-500/15 text-amber-800 border-amber-500/30"
                            : "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
                        )}
                      >
                        {table.occupied ? "Occupied" : "Available"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      {table.capacity > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {table.capacity} seats
                      </span>
                      )}
                      {table.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {table.location}
                        </span>
                      )}
                    </p>
                    {table.occupied && (
                      <p className="text-xs font-semibold mt-1.5 truncate">
                        {guest?.customer_name || "Guest"}
                        {orders ? ` · ${orders} order${orders === 1 ? "" : "s"}` : ""}
                        {total ? ` · ${formatCurrency(total)}` : ""}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          {!selected ? (
            <CardContent className="py-16 text-center text-sm text-muted-foreground">Select a table to see details and orders.</CardContent>
          ) : (
            <>
              <CardHeader className="space-y-3 border-b border-border/80 bg-muted/30 px-5 py-4 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-xl font-black">{displayTable(selected.table_number)}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1.5">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {selected.capacity} seats
                      </span>
                      {selected.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {selected.location}
                        </span>
                      )}
                      {selected.notes && <span>{selected.notes}</span>}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <Button size="sm" className="w-full gap-1.5 font-bold sm:w-auto" onClick={() => setOrderOpen(true)}>
                      <Plus className="h-4 w-4" /> New order
                    </Button>
                    {allOrders.length > 0 && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printCurrentBill()}>
                        <Receipt className="h-4 w-4" /> Print receipt
                      </Button>
                    )}
                    {allOrders.length > 0 && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={closeTable} disabled={closing}>
                        {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                        Close table
                      </Button>
                    )}
                  </div>
                </div>

                {primary?.session ? (
                  <div className="rounded-xl bg-muted/50 border border-border/60 px-3 py-2 text-sm">
                    <p className="font-bold text-foreground">{primary.session.customer_name || "Guest"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap mt-0.5">
                      {primary.session.customer_phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {primary.session.customer_phone}
                        </span>
                      )}
                      {primary.session.opened_at && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Seated {format(new Date(primary.session.opened_at), "h:mm a")}
                        </span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">This table is free. Place a new order to start a bill.</p>
                )}
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                {allOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-10 text-center">No orders on this table yet.</p>
                ) : (
                  <>
                    {allOrders.map((order, index) => (
                      <section key={order.id} className="rounded-2xl border border-border/70 overflow-hidden">
                        <div className="px-4 py-2.5 bg-muted/40 border-b border-border/50 flex items-center justify-between gap-2">
                          <p className="text-sm font-black">
                            {index + 1}) Order {index + 1}
                            <span className="font-semibold text-muted-foreground ml-2">{order.order_number}</span>
                          </p>
                          <Badge variant="outline" className="text-[10px] font-bold">
                            {getOrderStatusLabel(order.status)}
                          </Badge>
                        </div>
                        <div className="p-4 space-y-2">
                          <p className="text-[11px] text-muted-foreground">
                            {format(new Date(order.created_at), "MMM d · h:mm a")}
                          </p>
                          {(order.items || []).map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                              <span className="font-medium">
                                {item.quantity}× {item.item_name}
                              </span>
                              <span className="font-semibold tabular-nums shrink-0">
                                {formatCurrency(item.line_total || item.quantity * item.unit_price)}
                              </span>
                            </div>
                          ))}
                          <div className="flex justify-between text-xs font-bold pt-2 border-t border-border/50">
                            <span>Section total</span>
                            <span>{formatCurrency(order.total_amount)}</span>
                          </div>
                        </div>
                      </section>
                    ))}

                    <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Table total · {allOrders.length} order{allOrders.length === 1 ? "" : "s"}
                        </p>
                        <p className="text-2xl font-black text-foreground">{formatCurrency(grandTotal)}</p>
                      </div>
                      <Button className="font-bold gap-1.5" onClick={() => setOrderOpen(true)}>
                        <Plus className="h-4 w-4" /> Add another order
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </PageShell>

      {(heldReceipt || allOrders[0]) && (
        <OrderReceipt
          isPrintOnly
          order={(heldReceipt?.order || {
            id: allOrders[0].id,
            order_number: allOrders[0].order_number,
            tracking_code: allOrders[0].order_number,
            customer_name: primary?.session?.customer_name || "Guest",
            customer_phone: primary?.session?.customer_phone || "",
            fulfillment_type: "dine_in",
            payment_method: "cash",
            payment_status: "pending",
            status: allOrders[0].status,
            subtotal: bills.reduce((s, b) => s + Number(b.totals?.subtotal || 0), 0),
            tax_amount: bills.reduce((s, b) => s + Number(b.totals?.tax_amount || 0), 0),
            delivery_fee: 0,
            discount_amount: 0,
            total_amount: grandTotal,
            created_at: allOrders[0].created_at,
            table_number: selected?.table_number,
          }) as any}
          items={heldReceipt?.items || allOrders.flatMap((o) => o.items || [])}
          restaurantName={activeRestaurant?.name}
          tableSession={heldReceipt?.tableSession || {
            session: { ...primary?.session, table_number: selected?.table_number },
            orders: allOrders,
            totals: { order_count: allOrders.length, subtotal: grandTotal, tax_amount: 0, total_amount: grandTotal },
          }}
        />
      )}

      <CreateManualOrderDialog
        hideTrigger
        open={orderOpen}
        onOpenChange={setOrderOpen}
        defaultTableId={selected?.id}
        defaultCustomerName={primary?.session?.customer_name || ""}
        defaultCustomerPhone={primary?.session?.customer_phone || ""}
        onOrderCreated={() => {
          setOrderOpen(false);
          void load();
        }}
      />
    </div>
  );
}
