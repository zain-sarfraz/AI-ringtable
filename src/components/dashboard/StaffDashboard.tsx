import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ClipboardList,
  UtensilsCrossed,
  Search,
  Plus,
  Minus,
  Trash2,
  Loader2,
  Check,
  ArrowRight,
  Receipt,
  Armchair,
} from "lucide-react";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/restaurant";
import { getOrderStatusLabel } from "@/i18n/formatters";
import { displayTableLabel } from "@/lib/tableLabel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type MenuItem = {
  id: string;
  name: string;
  price: number;
  category_id?: string | null;
  is_available?: boolean;
  image_url?: string | null;
};

type Category = { id: string; name: string };

type CartItem = {
  cart_id: string;
  menu_item_id: string | null;
  item_name: string;
  unit_price: number;
  quantity: number;
};

type ActiveOrderItem = {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type ActiveOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string | null;
  table_number?: string | null;
  table_session_id?: string | null;
  fulfillment_type?: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  items?: ActiveOrderItem[];
  sitting_order_ids?: string[];
  sitting_count?: number;
};

type FloorTable = { id: string; table_number: string; is_active?: boolean };

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("ready") || s === "completed") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (s.includes("prepar") || s.includes("cooking") || s.includes("kitchen")) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-[#F4EFE6] text-[#1B4332] border-[#E2D8C8]";
}

export function StaffDashboard({ firstName }: { firstName: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { restaurantId } = useActiveRestaurant();
  const menuSectionRef = useRef<HTMLElement | null>(null);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [menuSearch, setMenuSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");

  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "add">("new");

  const [tables, setTables] = useState<FloorTable[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "pickup">("dine_in");
  const [submitting, setSubmitting] = useState(false);

  const selectedOrder = useMemo(
    () => activeOrders.find((o) => o.id === selectedOrderId) || null,
    [activeOrders, selectedOrderId],
  );

  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const loadMenu = useCallback(
    async (silent = false) => {
      if (!restaurantId) return;
      if (!silent) setLoadingMenu(true);
      try {
        const [{ data: itemsData }, { data: catData }] = await Promise.all([
          supabase
            .from("menu_items")
            .select("id, name, price, category_id, is_available, image_url")
            .eq("restaurant_id", restaurantId)
            .order("sort_order"),
          supabase
            .from("menu_categories")
            .select("id, name")
            .eq("restaurant_id", restaurantId)
            .order("sort_order"),
        ]);
        setMenuItems((itemsData as MenuItem[]) || []);
        setCategories((catData as Category[]) || []);
      } catch (err) {
        console.error("Failed to load menu:", err);
        if (!silent) toast.error("Could not load menu");
      } finally {
        if (!silent) setLoadingMenu(false);
      }
    },
    [restaurantId],
  );

  const loadActiveOrders = useCallback(
    async (silent = false) => {
      if (!restaurantId) return;
      if (!silent) setLoadingActive(true);
      try {
        const res = await fetch(
          `${getApiBase()}/api/staff/active-orders?restaurant_id=${encodeURIComponent(restaurantId)}`,
          { headers: { Authorization: `Bearer ${getToken()}` } },
        );
        if (!res.ok) throw new Error("Failed to load active orders");
        const json = await res.json();
        const list: ActiveOrder[] = json.orders || [];
        setActiveOrders(list);
        setSelectedOrderId((prev) => (prev && list.some((o) => o.id === prev) ? prev : null));
      } catch (err) {
        console.error(err);
        if (!silent) toast.error("Could not load active orders");
      } finally {
        if (!silent) setLoadingActive(false);
      }
    },
    [restaurantId],
  );

  const loadTables = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const res = await fetch(`${getApiBase()}/api/restaurants/${restaurantId}/tables`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const d = await res.json();
        setTables((d.tables || []).filter((t: FloorTable) => t.is_active !== false));
      }
    } catch {
      // optional
    }
  }, [restaurantId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMenu(), loadActiveOrders(), loadTables()]);
  }, [loadMenu, loadActiveOrders, loadTables]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!restaurantId) return;
    const timer = setInterval(() => {
      void loadMenu(true);
      void loadActiveOrders(true);
    }, 12000);
    return () => clearInterval(timer);
  }, [restaurantId, loadMenu, loadActiveOrders]);

  // Deep-link from All Orders → Add items mode
  useEffect(() => {
    const addTo = searchParams.get("add_to");
    if (!addTo) return;
    setSelectedOrderId(addTo);
    setMode("add");
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const next = new URLSearchParams(searchParams);
    next.delete("add_to");
    setSearchParams(next, { replace: true });
  }, [searchParams, activeOrders, setSearchParams]);

  const filteredMenu = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems
      .filter((item) => {
        if (categoryId !== "all" && item.category_id !== categoryId) return false;
        if (!q) return true;
        return item.name.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const aAvail = a.is_available === false ? 1 : 0;
        const bAvail = b.is_available === false ? 1 : 0;
        if (aAvail !== bAvail) return aAvail - bAvail;
        return a.name.localeCompare(b.name);
      });
  }, [menuItems, menuSearch, categoryId]);

  const availableCount = useMemo(
    () => menuItems.filter((i) => i.is_available !== false).length,
    [menuItems],
  );

  const organizedCategories = useMemo(() => {
    return [...categories].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  /** When All is selected, group items under category headings for faster scanning */
  const menuSections = useMemo(() => {
    if (categoryId !== "all") {
      const cat = categories.find((c) => c.id === categoryId);
      return [{ id: categoryId, name: cat?.name || "Items", items: filteredMenu }];
    }
    const byCat = new Map<string, MenuItem[]>();
    for (const item of filteredMenu) {
      const key = item.category_id || "uncategorized";
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(item);
    }
    const sections: { id: string; name: string; items: MenuItem[] }[] = [];
    for (const cat of organizedCategories) {
      const items = byCat.get(cat.id);
      if (items?.length) sections.push({ id: cat.id, name: cat.name, items });
      byCat.delete(cat.id);
    }
    const uncategorized = byCat.get("uncategorized") || [];
    for (const [id, items] of byCat) {
      if (id === "uncategorized" || !items.length) continue;
      sections.push({ id, name: "Other", items });
    }
    if (uncategorized.length) {
      sections.push({ id: "uncategorized", name: "Other", items: uncategorized });
    }
    return sections;
  }, [categoryId, categories, filteredMenu, organizedCategories]);

  const cartTotal = useMemo(
    () => cart.reduce((s, c) => s + c.unit_price * c.quantity, 0),
    [cart],
  );

  const cartCount = useMemo(() => cart.reduce((s, c) => s + c.quantity, 0), [cart]);

  const addToCart = (item: MenuItem) => {
    if (item.is_available === false) {
      toast.error("This item is currently unavailable");
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.cart_id === existing.cart_id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [
        ...prev,
        {
          cart_id: `${item.id}-${Date.now()}`,
          menu_item_id: item.id,
          item_name: item.name,
          unit_price: Number(item.price) || 0,
          quantity: 1,
        },
      ];
    });
  };

  const updateQty = (cartId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.cart_id === cartId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    );
  };

  const clearCart = () => setCart([]);

  const selectActiveOrderForAdd = (order: ActiveOrder) => {
    setSelectedOrderId(order.id);
    setMode("add");
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openAllOrders = () => navigate("/orders");

  const focusTakeOrders = () => {
    setMode("new");
    setSelectedOrderId(null);
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async () => {
    if (!restaurantId) {
      toast.error("Restaurant is not selected");
      return;
    }
    if (cart.length === 0) {
      toast.error("Add at least one menu item");
      return;
    }

    const lines = cart.map((c) => ({
      menu_item_id: c.menu_item_id,
      item_name: c.item_name,
      quantity: c.quantity,
      unit_price: c.unit_price,
      line_total: c.unit_price * c.quantity,
    }));

    setSubmitting(true);
    try {
      if (mode === "add") {
        if (!selectedOrderId) {
          toast.error("Select an active order to add items");
          setSubmitting(false);
          return;
        }
        const res = await fetch(`${getApiBase()}/api/orders/${selectedOrderId}/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ lines }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to add items");
        toast.success(`Items added to ${selectedOrder?.order_number || "order"}`);
        clearCart();
        setMode("new");
        setSelectedOrderId(null);
        await loadActiveOrders();
      } else {
        const selectedTable = tables.find((t) => t.id === selectedTableId);
        if (orderType === "dine_in" && !selectedTable) {
          toast.error("Select a table for dine-in");
          setSubmitting(false);
          return;
        }
        const dineInGuest = displayTableLabel(selectedTable?.table_number || "Guest");
        const res = await fetch(`${getApiBase()}/api/restaurants/${restaurantId}/staff-orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            customer_name: orderType === "dine_in" ? dineInGuest : "Takeaway",
            customer_phone: "",
            fulfillment_type: orderType,
            table_id: orderType === "dine_in" ? selectedTable?.id || null : null,
            table_number: orderType === "dine_in" ? selectedTable?.table_number || null : null,
            payment_method: "cash",
            payment_status: "unpaid",
            subtotal: cartTotal,
            tax_amount: 0,
            delivery_fee: 0,
            total_amount: cartTotal,
            lines,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to place order");
        toast.success(
          body.appended
            ? `Items added to ${body.order?.order_number || "table order"}`
            : `Order ${body.order?.order_number || ""} placed`,
        );
        clearCart();
        setSelectedTableId("");
        await loadActiveOrders();
      }
    } catch (err: any) {
      toast.error(err?.message || "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-28 sm:space-y-5 sm:pb-8 lg:space-y-6">
      {/* Welcome + actions (reference layout) */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1917] sm:text-[28px]">
            {greeting}, {firstName || "Waiter"}!
          </h1>
          <p className="mt-1 text-sm text-[#6B6358]">
            Take orders quickly and manage your tables efficiently.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          
          <Button
            type="button"
            variant="outline"
            onClick={focusTakeOrders}
            className="h-10 gap-2 rounded-xl border-[#C9A227] bg-white px-4 text-sm font-semibold text-[#C9A227] hover:bg-[#FBF6E8] hover:text-[#B8921F]"
          >
            <UtensilsCrossed className="h-4 w-4" />
            Take Orders
          </Button>
          <Button
            type="button"
            onClick={openAllOrders}
            className="h-10 gap-2 rounded-xl bg-[#1B4332] px-4 text-sm font-semibold text-white hover:bg-[#163728]"
          >
            All Orders
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Categories — full width under header */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setCategoryId("all")}
          className={cn(
            "h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition-colors",
            categoryId === "all"
              ? "bg-[#1B4332] text-white"
              : "border border-[#E8E0D4] bg-white text-[#5C554C] hover:border-[#1B4332]/30",
          )}
        >
          All
        </button>
        {organizedCategories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            className={cn(
              "h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition-colors",
              categoryId === c.id
                ? "bg-[#1B4332] text-white"
                : "border border-[#E8E0D4] bg-white text-[#5C554C] hover:border-[#1B4332]/30",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Main: Menu + Ticket */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
        <section
          ref={menuSectionRef}
          className="overflow-hidden rounded-2xl border border-[#E8E0D4] bg-white shadow-sm"
        >
          <div className="space-y-3 border-b border-[#EFE8DC] px-3 py-3 sm:px-4 sm:py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1B4332]/10 text-[#1B4332]">
                <UtensilsCrossed className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-[#1C1917]">Menu</h2>
                <p className="text-[11px] text-[#6B6358]">
                  {availableCount} available · tap to add
                </p>
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A89880]" />
              <Input
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Search menu items..."
                className="h-11 rounded-xl border-[#E8E0D4] bg-[#FBF8F3] pl-9 text-sm text-[#1C1917] placeholder:text-[#A89880] focus-visible:ring-[#1B4332]/25"
              />
            </div>
          </div>

          <div className="max-h-[min(62vh,680px)] overflow-y-auto p-2 sm:p-3 custom-scrollbar">
            {loadingMenu && menuItems.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl bg-[#F0EAE0]" />
                ))}
              </div>
            ) : filteredMenu.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <UtensilsCrossed className="h-8 w-8 text-[#C9BBA8]" />
                <p className="text-sm font-semibold text-[#1C1917]">No items match</p>
                <p className="max-w-xs text-xs text-[#6B6358]">
                  Try another category or clear search.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {menuSections.map((section) => (
                  <div key={section.id} className="space-y-1.5">
                    {categoryId === "all" || menuSections.length > 1 ? (
                      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-white/95 px-1 py-1.5 backdrop-blur-sm">
                        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#6B6358]">
                          {section.name}
                        </h3>
                        <span className="text-[10px] font-semibold text-[#A89880]">
                          {section.items.length}
                        </span>
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      {section.items.map((item) => {
                        const unavailable = item.is_available === false;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={unavailable}
                            onClick={() => addToCart(item)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors sm:px-3.5 sm:py-3",
                              unavailable
                                ? "cursor-not-allowed border-[#EFE8DC] bg-[#F7F3EB]/70 opacity-60"
                                : "border-[#E8E0D4] bg-[#FBF8F3] hover:border-[#1B4332]/25 hover:bg-white active:bg-[#F4EFE6]",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-[#1C1917]">
                                {item.name}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold tabular-nums text-[#1B4332]">
                                  {formatCurrency(Number(item.price) || 0)}
                                </span>
                                {unavailable ? (
                                  <span className="rounded-md bg-[#1C1917]/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                    Unavailable
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-bold text-white",
                                unavailable ? "bg-[#C9BBA8]" : "bg-[#C9A227]",
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                              Add
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Current Ticket — reference style */}
        <aside id="current-ticket" className="scroll-mt-24 lg:sticky lg:top-4">
          <div className="overflow-hidden rounded-2xl border border-[#E8E0D4] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 bg-[#1B4332] px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Receipt className="h-5 w-5 text-white" />
                <h2 className="text-[15px] font-bold text-white">Current Ticket</h2>
              </div>
              {mode === "add" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("new");
                    setSelectedOrderId(null);
                  }}
                  className="text-[11px] font-semibold text-[#F4E4A6] hover:underline"
                >
                  New ticket
                </button>
              ) : null}
            </div>

            <div className="space-y-4 p-4">
              {mode === "add" && selectedOrderId ? (
                <div className="rounded-xl border border-[#C9A227]/35 bg-[#FBF6E8] px-3 py-2.5">
                  <p className="text-xs font-semibold text-[#1C1917]">
                    Adding to{" "}
                    {selectedOrder?.order_number ||
                      `order ${selectedOrderId.slice(0, 8)}…`}
                    {selectedOrder?.table_number
                      ? ` · ${displayTableLabel(selectedOrder.table_number)}`
                      : selectedOrder?.fulfillment_type === "pickup"
                        ? " · Takeaway"
                        : ""}
                  </p>
                </div>
              ) : null}

              {mode === "new" ? (
                <>
                  <div className="grid grid-cols-2 gap-1 rounded-full bg-[#F4EFE6] p-1">
                    <button
                      type="button"
                      onClick={() => setOrderType("dine_in")}
                      className={cn(
                        "rounded-full px-3 py-2.5 text-xs font-bold transition-all",
                        orderType === "dine_in"
                          ? "bg-[#1B4332] text-white shadow-sm"
                          : "text-[#5C554C] hover:text-[#1C1917]",
                      )}
                    >
                      Dine-in
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrderType("pickup")}
                      className={cn(
                        "rounded-full px-3 py-2.5 text-xs font-bold transition-all",
                        orderType === "pickup"
                          ? "bg-[#1B4332] text-white shadow-sm"
                          : "text-[#5C554C] hover:text-[#1C1917]",
                      )}
                    >
                      Takeaway
                    </button>
                  </div>

                  {orderType === "dine_in" ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-[#1C1917]">Select Table:</Label>
                      <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                        <SelectTrigger className="h-11 rounded-xl border-[#E8E0D4] bg-white">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Armchair className="h-4 w-4 shrink-0 text-[#6B6358]" />
                            <SelectValue placeholder="Select table" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {tables.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {displayTableLabel(t.table_number)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-[#E8E0D4] bg-[#FBF8F3] px-3 py-3 text-xs text-[#6B6358]">
                      Takeaway — no table required.
                    </p>
                  )}
                </>
              ) : !selectedOrderId ? (
                <div className="rounded-xl border border-dashed border-[#E8E0D4] bg-[#FBF8F3] px-3 py-4 text-center text-xs text-[#6B6358]">
                  Pick an active order below, then add menu items.
                </div>
              ) : null}

              <div className="max-h-56 space-y-2 overflow-y-auto custom-scrollbar">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#E8E0D4] bg-[#FBF8F3] py-10 text-center">
                    <Receipt className="h-6 w-6 text-[#C9BBA8]" />
                    <p className="text-xs text-[#6B6358]">Selected items appear here</p>
                  </div>
                ) : (
                  cart.map((c) => (
                    <div
                      key={c.cart_id}
                      className="space-y-2 border-b border-[#EFE8DC] py-2.5 last:border-0"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-[#1C1917]">{c.item_name}</p>
                          <p className="text-[11px] tabular-nums text-[#6B6358]">
                            {formatCurrency(c.unit_price)}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-[#1C1917]">
                          {formatCurrency(c.unit_price * c.quantity)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-0.5 rounded-full bg-[#F4EFE6] px-1 py-0.5">
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[#1C1917] hover:bg-white"
                            onClick={() => updateQty(c.cart_id, -1)}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums text-[#1C1917]">
                            {c.quantity}
                          </span>
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[#1C1917] hover:bg-white"
                            onClick={() => updateQty(c.cart_id, 1)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                          onClick={() =>
                            setCart((prev) => prev.filter((x) => x.cart_id !== c.cart_id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between border-t border-[#EFE8DC] pt-3">
                <p className="text-sm font-bold text-[#1C1917]">Total Amount:</p>
                <p className="text-2xl font-bold tabular-nums tracking-tight text-[#1B4332]">
                  {formatCurrency(cartTotal)}
                </p>
              </div>

              <Button
                type="button"
                className="h-12 w-full gap-2 rounded-xl bg-[#1B4332] text-sm font-bold text-white hover:bg-[#163728]"
                disabled={
                  submitting || cart.length === 0 || (mode === "add" && !selectedOrderId)
                }
                onClick={() => void submit()}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {mode === "add" ? "Add to Order" : "Place Order"}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* My Active Orders */}
      <section className="overflow-hidden rounded-2xl border border-[#E8E0D4] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFE8DC] px-3 py-3 sm:px-5 sm:py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[#1C1917] sm:text-lg">
              My Active Orders
            </h2>
            <p className="mt-0.5 text-xs text-[#6B6358]">
              {activeOrders.length} open ticket{activeOrders.length === 1 ? "" : "s"} on the floor
            </p>
          </div>
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1B4332] hover:text-[#C9A227]"
          >
            Open All Orders
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="p-3 sm:p-5">
          {loadingActive && activeOrders.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl bg-[#F0EAE0]" />
              ))}
            </div>
          ) : activeOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center sm:py-14">
              <ClipboardList className="h-8 w-8 text-[#C9BBA8]" />
              <p className="text-sm font-semibold text-[#1C1917]">No active orders</p>
              <p className="text-xs text-[#6B6358]">New tickets will show up here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeOrders.map((o) => {
                const lines = o.items || [];
                const itemCount = lines.reduce((s, it) => s + (it.quantity || 0), 0);
                const isTakeaway =
                  (o.fulfillment_type || "").toLowerCase() === "pickup" ||
                  (o.fulfillment_type || "").toLowerCase() === "takeaway" ||
                  !o.table_number;
                return (
                  <div
                    key={o.table_session_id || o.id}
                    className="flex flex-col rounded-2xl border border-[#E8E0D4] bg-[#FBF8F3] p-4 transition-colors hover:border-[#C9A227]/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#1C1917]">{o.order_number}</p>
                        <p className="mt-1 text-xs text-[#6B6358]">
                          {o.table_number
                            ? displayTableLabel(o.table_number)
                            : isTakeaway
                              ? "Takeaway"
                              : o.customer_name || "Guest"}
                          {" · "}
                          {itemCount || lines.length} item
                          {(itemCount || lines.length) === 1 ? "" : "s"}
                          {(o.sitting_count || 1) > 1 ? ` · ${o.sitting_count} tickets` : ""}
                        </p>
                        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                          {lines.length === 0 ? (
                            <li className="text-[11px] text-[#8A8278]">No items</li>
                          ) : (
                            lines.map((it) => (
                              <li
                                key={it.id || `${it.item_name}-${it.quantity}-${it.unit_price}`}
                                className="flex items-start justify-between gap-2 text-[11px] text-[#5C554C]"
                              >
                                <span className="min-w-0 flex-1 leading-snug">
                                  {it.quantity}× {it.item_name}
                                </span>
                                <span className="shrink-0 tabular-nums text-[#1C1917]">
                                  {formatCurrency(
                                    Number(it.line_total) ||
                                      Number(it.unit_price || 0) * Number(it.quantity || 1),
                                  )}
                                </span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                      <div className="ml-2 shrink-0 text-right">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                            statusTone(o.status),
                          )}
                        >
                          {getOrderStatusLabel(o.status)}
                        </span>
                        <p className="mt-2 text-sm font-bold tabular-nums text-[#1C1917]">
                          {formatCurrency(o.total_amount)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 flex-1 rounded-xl border-[#E8E0D4] bg-white text-xs font-semibold text-[#1C1917] hover:bg-white"
                        onClick={() => navigate(`/orders/${o.id}`)}
                      >
                        View details
                      </Button>
                      <Button
                        type="button"
                        className="h-9 flex-1 rounded-xl bg-[#1B4332] text-xs font-semibold text-[#F4E4A6] hover:bg-[#163728]"
                        onClick={() => selectActiveOrderForAdd(o)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add items
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Mobile sticky ticket summary */}
      {cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E8E0D4] bg-[#FBF8F3]/95 p-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() =>
              document.getElementById("current-ticket")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#1B4332] px-4 py-3 text-left text-[#F4E4A6] shadow-lg"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#F4E4A6]/80">
                Ticket · {cartCount} item{cartCount === 1 ? "" : "s"}
              </p>
              <p className="truncate text-base font-bold tabular-nums">
                {formatCurrency(cartTotal)}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#C9A227] px-3 py-2 text-xs font-bold text-white">
              Review
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
