import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Phone, MapPin, Truck, LogOut, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ORDER_STATUS_COLORS, OrderStatus, formatCurrency } from "@/lib/restaurant";
import { getOrderStatusLabel } from "@/i18n/formatters";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

interface Order { id: string; order_number: string; customer_name: string; customer_phone: string; delivery_address: string; delivery_notes: string | null; status: OrderStatus; total_amount: number; payment_method: string; payment_status: string; created_at: string; assigned_at: string | null; delivered_at: string | null }
interface Item { id: string; order_id: string; item_name: string; quantity: number; notes: string | null; line_total: number }

export default function DriverPortal() {
  const { t } = useTranslation(["drivers", "orders", "common"]);
  const { user, signOut, profile } = useAuth();
  const { toast } = useToast();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("drivers").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) setDriverId(data.id);
    });
  }, [user]);

  const load = async () => {
    if (!driverId) return;
    const { data: o } = await supabase.from("orders").select("*").eq("driver_id", driverId).order("created_at", { ascending: false });
    if (o) setOrders(o as any);
    const ids = (o || []).map((x: any) => x.id);
    if (ids.length) {
      const { data: it } = await supabase.from("order_items").select("*").in("order_id", ids);
      if (it) setItems(it as any);
    }
  };
  useEffect(() => { if (driverId) load(); }, [driverId]);
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase.channel("driver-rt").on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `driver_id=eq.${driverId}` }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [driverId]);

  const advance = async (id: string, status: OrderStatus, extra: Record<string, any> = {}) => {
    const { error } = await supabase.from("orders").update({ status, ...extra }).eq("id", id);
    if (error) toast({ variant: "destructive", title: t("common:error", "Failed"), description: error.message });
    else { toast({ title: t("drivers:driverSaved", "Status updated successfully") }); load(); }
  };

  const current = orders.find((o) => o.status === "out_for_delivery") || orders.find((o) => o.status === "assigned");
  const filtered = orders.filter((o) => (statusFilter === "all" || o.status === statusFilter) && (search === "" || o.customer_name.toLowerCase().includes(search.toLowerCase()) || o.order_number.toLowerCase().includes(search.toLowerCase())));
  const orderItems = (id: string) => items.filter((i) => i.order_id === id);

  if (!driverId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-4">
        <Card className="max-w-md w-full rounded-2xl border border-border/80 shadow-xs"><CardContent className="py-10 text-center space-y-3">
          <Truck className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold">No driver profile linked</h2>
          <p className="text-sm text-muted-foreground">Your account ({profile?.email || user?.email}) hasn't been linked to a driver. Ask an admin to link you in the Drivers section.</p>
          <div className="flex justify-center gap-3 pt-2">
            <LanguageSwitcher />
            <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4 mr-1" />{t("common:signOut", "Sign out")}</Button>
          </div>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2"><Truck className="h-5 w-5" /><span className="font-semibold">{t("drivers:driverPortal", "Driver portal")}</span></div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="text-sm text-muted-foreground hidden sm:inline">{profile?.full_name || profile?.email}</span>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-6">
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">{t("drivers:myDeliveries", "Current delivery")}</CardTitle></CardHeader>
          <CardContent>
            {current ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-mono font-semibold">{current.order_number}</span>
                  <Badge className={ORDER_STATUS_COLORS[current.status]} variant="outline">{getOrderStatusLabel(current.status)}</Badge>
                </div>
                <div className="text-sm space-y-1.5">
                  <p><strong>{current.customer_name}</strong></p>
                  <a href={`tel:${current.customer_phone}`} className="flex items-center gap-1.5 text-primary"><Phone className="h-4 w-4" />{current.customer_phone}</a>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.delivery_address)}`} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-primary"><MapPin className="h-4 w-4 mt-0.5" />{current.delivery_address}</a>
                  <p className="text-muted-foreground">{formatCurrency(current.total_amount)} • {current.payment_method} ({current.payment_status})</p>
                </div>
                <div className="flex gap-2">
                  {current.status === "assigned" && <Button onClick={() => advance(current.id, "out_for_delivery")}><ArrowRight className="h-4 w-4 mr-1" />{t("drivers:markPickedUp", "Pick up & start")}</Button>}
                  {current.status === "out_for_delivery" && <Button onClick={() => advance(current.id, "delivered", { delivered_at: new Date().toISOString() })}><CheckCircle2 className="h-4 w-4 mr-1" />{t("drivers:markDelivered", "Mark delivered")}</Button>}
                  <Button variant="outline" onClick={() => setOpenId(current.id)}>{t("common:details", "Details")}</Button>
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground text-center py-4">{t("drivers:noActiveDeliveries", "No active delivery right now")}</p>}
          </CardContent>
        </Card>

        <div>
          <h2 className="font-semibold mb-3">{t("orders:title", "My orders")}</h2>
          <div className="flex gap-2 mb-3 flex-wrap">
            <Input placeholder={t("common:searchPlaceholder", "Search…")} value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-40" />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common:all", "All")}</SelectItem>
                <SelectItem value="assigned">{getOrderStatusLabel("assigned")}</SelectItem>
                <SelectItem value="out_for_delivery">{getOrderStatusLabel("out_for_delivery")}</SelectItem>
                <SelectItem value="delivered">{getOrderStatusLabel("delivered")}</SelectItem>
                <SelectItem value="cancelled">{getOrderStatusLabel("cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">{t("common:active", "Active")} ({filtered.filter((o) => o.status === "assigned" || o.status === "out_for_delivery").length})</TabsTrigger>
              <TabsTrigger value="all">{t("common:all", "All")} ({filtered.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="space-y-2"><OrdersList list={filtered.filter((o) => o.status === "assigned" || o.status === "out_for_delivery")} onOpen={setOpenId} /></TabsContent>
            <TabsContent value="all" className="space-y-2"><OrdersList list={filtered} onOpen={setOpenId} /></TabsContent>
          </Tabs>
        </div>

        {openId && (() => {
          const o = orders.find((x) => x.id === openId);
          if (!o) return null;
          return (
            <Card className="fixed inset-4 z-50 overflow-y-auto md:inset-auto md:right-4 md:top-20 md:bottom-4 md:w-96 shadow-2xl">
              <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{o.order_number}</CardTitle><Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>✕</Button></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge className={ORDER_STATUS_COLORS[o.status]} variant="outline">{getOrderStatusLabel(o.status)}</Badge>
                <p><strong>{o.customer_name}</strong></p>
                <a href={`tel:${o.customer_phone}`} className="flex items-center gap-1.5 text-primary"><Phone className="h-4 w-4" />{o.customer_phone}</a>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.delivery_address)}`} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-primary"><MapPin className="h-4 w-4 mt-0.5" />{o.delivery_address}</a>
                {o.delivery_notes && <p className="text-xs italic text-muted-foreground">{o.delivery_notes}</p>}
                <div className="border-t pt-2 space-y-1">
                  {orderItems(o.id).map((i) => (<div key={i.id} className="flex justify-between"><span>{i.quantity}× {i.item_name}</span><span>{formatCurrency(i.line_total)}</span></div>))}
                  <div className="flex justify-between font-semibold border-t pt-1.5"><span>{t("common:total", "Total")}</span><span>{formatCurrency(o.total_amount)}</span></div>
                  <p className="text-xs text-muted-foreground">{o.payment_method} • {o.payment_status}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {o.status === "assigned" && <Button size="sm" onClick={() => advance(o.id, "out_for_delivery")}>{t("drivers:markPickedUp", "Start delivery")}</Button>}
                  {o.status === "out_for_delivery" && <Button size="sm" onClick={() => advance(o.id, "delivered", { delivered_at: new Date().toISOString() })}><CheckCircle2 className="h-4 w-4 mr-1" />{t("drivers:markDelivered", "Mark delivered")}</Button>}
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </main>
    </div>
  );
}

function OrdersList({ list, onOpen }: { list: Order[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation(["common"]);
  if (list.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">{t("common:noData", "No orders")}</p>;
  return <>{list.map((o) => (
    <Card key={o.id} className="cursor-pointer hover:border-primary/40" onClick={() => onOpen(o.id)}>
      <CardContent className="p-3 flex justify-between items-center">
        <div>
          <div className="flex gap-2 items-center"><span className="font-mono text-sm font-semibold">{o.order_number}</span><Badge className={ORDER_STATUS_COLORS[o.status]} variant="outline">{getOrderStatusLabel(o.status)}</Badge></div>
          <p className="text-sm">{o.customer_name}</p>
          <p className="text-xs text-muted-foreground line-clamp-1">{o.delivery_address}</p>
        </div>
        <span className="font-semibold">{formatCurrency(o.total_amount)}</span>
      </CardContent>
    </Card>
  ))}</>;
}