import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Plus, Printer, Receipt, Clock, Phone } from "lucide-react";
import { ORDER_STATUS_COLORS, OrderStatus, formatCurrency } from "@/lib/restaurant";
import { getOrderStatusLabel } from "@/i18n/formatters";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";
import { OrderReceipt } from "@/components/orders/OrderReceipt";
import { OrderFulfillmentTimeline } from "@/components/orders/OrderFulfillmentTimeline";
import { cn } from "@/lib/utils";

export default function Track() {
  const { t } = useTranslation(["track", "orders", "common"]);
  const { code } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [tableSession, setTableSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<any>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  const load = async () => {
    if (!code) return;
    const res = await fetch(`${getApiBase()}/api/public/track/${encodeURIComponent(code.toUpperCase())}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.order) {
      setOrder(j.order);
      setItems(j.items || []);
      setHistory(j.history || []);
      setRestaurant(j.settings || null);
      setTableSession(j.table_session || null);
      setMenuPath(j.menu_path || null);
      setLogoBroken(false);
    } else {
      setOrder(null);
      setItems([]);
      setHistory([]);
      setRestaurant(null);
      setTableSession(null);
      setMenuPath(null);
      setLogoBroken(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [code]);

  useEffect(() => {
    if (!order?.id) return;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [order?.id, code]);

  const sessionOrders = tableSession?.orders?.length ? tableSession.orders : null;
  const lineItems = useMemo(() => {
    if (sessionOrders?.length) {
      return sessionOrders.flatMap((sessOrder: any) =>
        (sessOrder.items || (sessOrder.id === order?.id ? items : [])).map((it: any) => ({
          ...it,
          _key: `${sessOrder.id || "o"}-${it.id}`,
        })),
      );
    }
    return (items || []).map((it: any) => ({ ...it, _key: it.id }));
  }, [sessionOrders, order, items]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!order) return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-4">
      <Card className="max-w-md w-full"><CardContent className="py-10 text-center space-y-2">
        <Package className="h-10 w-10 mx-auto text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("track:orderNotFound", "Order not found")}</h2>
        <p className="text-sm text-muted-foreground">{t("track:orderNotFound", "Check the tracking code and try again.")}</p>
      </CardContent></Card>
    </div>
  );

  const isDineIn = order.fulfillment_type === "dine_in" || Boolean(order.table_number) || Boolean(tableSession?.session);
  const cleanTableDisplay = order.table_number || tableSession?.session?.table_number
    ? (/^table\b/i.test(String(order.table_number || tableSession?.session?.table_number || "").trim())
      ? String(order.table_number || tableSession?.session?.table_number).trim()
      : `Table ${String(order.table_number || tableSession?.session?.table_number).trim()}`)
    : "Assigned Table";
  const cancelled = order.status === "cancelled";
  const paid = String(order.payment_status || "").toLowerCase() === "paid" || order.status === "delivered"
    || String(tableSession?.session?.status || "") === "closed";
  const billTotal = tableSession?.totals?.total_amount ?? order.total_amount;
  const logoSrc = resolveMediaUrl(restaurant?.logo_url) || restaurant?.logo_url || null;
  const orderMorePath = (() => {
    if (!menuPath) return null;
    const [path, qs] = menuPath.split("?");
    const q = new URLSearchParams(qs || "");
    const name = order.customer_name || tableSession?.session?.customer_name;
    const phone = order.customer_phone || tableSession?.session?.customer_phone;
    const email = order.customer_email;
    if (name && !q.get("name")) q.set("name", String(name));
    if (phone && !q.get("phone")) q.set("phone", String(phone));
    if (email && !q.get("email")) q.set("email", String(email));
    const query = q.toString();
    return query ? `${path}?${query}` : path;
  })();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {logoSrc && !logoBroken ? (
              <img
                src={logoSrc}
                alt={restaurant?.name || "Restaurant"}
                className="h-9 w-9 rounded-lg object-cover border border-border/60 bg-muted"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold border border-primary/20">
                {String(restaurant?.name || "R").charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="font-semibold">{restaurant?.name || t("track:title", "Order tracking")}</h1>
              {restaurant?.phone && <a href={`tel:${restaurant.phone}`} className="text-xs text-primary">{restaurant.phone}</a>}
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="break-all font-mono text-base sm:text-lg">{order.order_number}</span>
              <Badge className={cn(ORDER_STATUS_COLORS[order.status as OrderStatus], "w-fit")} variant="outline">
                {isDineIn && order.status === "out_for_delivery"
                  ? "🍽️ Served to Table"
                  : isDineIn && order.status === "delivered"
                  ? "✓ Complete / Paid"
                  : getOrderStatusLabel(order.status, t)}
              </Badge>
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {order.customer_name} • {isDineIn ? `Dine-In (${cleanTableDisplay})` : order.delivery_address}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">
              Save this page. Quote <span className="font-mono font-semibold text-foreground">{order.order_number}</span> if you call us to hear the latest status.
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
          <CardHeader className="border-b border-border/40 bg-muted/30 px-4 py-4 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Clock className="h-4 w-4 text-orange-500" />
              {t("orders:orderFulfillmentTimeline", "Order Fulfillment Timeline")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {cancelled ? (
              <p className="py-6 text-center text-sm text-red-600">{t("orders:orderCancelledAt", "This order was cancelled.")}</p>
            ) : (
              <OrderFulfillmentTimeline order={order} history={history} />
            )}
          </CardContent>
        </Card>

        {restaurant?.phone && (
          <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Phone className="h-4 w-4" /> Call to track
                </p>
                <p className="text-xs text-muted-foreground">
                  Tell the agent your order number {order.order_number} and they will read the status.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full font-bold sm:w-auto">
                <a href={`tel:${restaurant.phone}`}>Call {restaurant.phone}</a>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="border-b bg-muted/30 pb-3">
            <CardTitle className="text-sm">{t("orders:items", "Items")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-4 text-sm">
            {lineItems.map((it: any) => (
              <div key={it._key} className="flex justify-between gap-3">
                <span className="min-w-0">{it.quantity}× {it.item_name}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(it.line_total)}</span>
              </div>
            ))}
            {lineItems.length === 0 && (
              <p className="text-xs text-muted-foreground">No items</p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="space-y-1.5 pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>{t("orders:subtotal", "Subtotal")}</span><span>{formatCurrency(tableSession?.totals?.subtotal ?? order.subtotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>{t("orders:tax", "Tax")}</span><span>{formatCurrency(tableSession?.totals?.tax_amount ?? order.tax_amount)}</span></div>
            {!isDineIn && <div className="flex justify-between text-muted-foreground"><span>{t("orders:deliveryFee", "Delivery")}</span><span>{formatCurrency(order.delivery_fee)}</span></div>}
            {order.discount_amount > 0 && <div className="flex justify-between text-green-600"><span>{t("orders:discount", "Discount")}</span><span>-{formatCurrency(order.discount_amount)}</span></div>}
            <div className="flex justify-between pt-1 font-semibold"><span>{t("orders:total", "Total")}</span><span>{formatCurrency(billTotal)}</span></div>
          </CardContent>
        </Card>

        {isDineIn && !cancelled && orderMorePath && !paid && (
          <Card className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/5 shadow-xs">
            <CardContent className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold">Want something else?</p>
                <p className="text-xs text-muted-foreground">Place another order for this table.</p>
              </div>
              <Button asChild className="w-full gap-1.5 font-bold sm:w-auto">
                <Link to={orderMorePath}>
                  <Plus className="h-4 w-4" /> Order more
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <Receipt className="h-4 w-4" /> {paid ? "Invoice ready" : "Invoice"}
              </p>
              <p className="text-xs text-muted-foreground">
                {paid
                  ? isDineIn
                    ? "Your table bill is complete. View or print your invoice."
                    : "Your order is complete. View or print your invoice."
                  : isDineIn
                    ? "Invoice will be ready when the table bill is paid."
                    : "Invoice will be ready when the order is complete."}
              </p>
            </div>
            <Button
              variant={paid ? "default" : "outline"}
              className="w-full gap-1.5 font-bold sm:w-auto"
              onClick={() => {
                setShowInvoice(true);
                setTimeout(() => window.print(), 150);
              }}
            >
              <Printer className="h-4 w-4" /> {paid ? "View / Print Invoice" : "Preview invoice"}
            </Button>
          </CardContent>
        </Card>

        {(showInvoice || paid) && (
          <div className="no-print">
            <OrderReceipt
              order={order}
              items={items}
              restaurantName={restaurant?.name}
              tableSession={tableSession}
            />
          </div>
        )}
        <OrderReceipt
          order={order}
          items={items}
          restaurantName={restaurant?.name}
          tableSession={tableSession}
          isPrintOnly
        />
      </main>
    </div>
  );
}
