import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  ShoppingCart,
  User,
  Phone,
  MapPin,
  Trash2,
  Search,
  Loader2,
  Check,
  UtensilsCrossed,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/i18n/formatters";
import { cn } from "@/lib/utils";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  restaurant_id?: string | null;
  is_available?: boolean;
  image_url?: string | null;
}

interface CartItem {
  cart_id: string;
  menu_item_id: string | null;
  item_name: string;
  unit_price: number;
  quantity: number;
  notes: string;
}

interface VariantItem {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  is_active: boolean;
  variant_type?: "size" | "flavor";
  measurement?: string | null;
  parent_id?: string | null;
}

interface Props {
  onOrderCreated?: () => void;
  defaultTableId?: string;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
}

export function CreateManualOrderDialog({
  onOrderCreated,
  defaultTableId,
  defaultCustomerName,
  defaultCustomerPhone,
  hideTrigger,
  open: openProp,
  onOpenChange,
  triggerLabel,
}: Props) {
  const { t } = useTranslation(["orders", "common"]);
  const { toast } = useToast();
  const { restaurantId: activeRestaurantId } = useActiveRestaurant();

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? Boolean(openProp) : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [submitting, setSubmitting] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  // Customer details
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [orderType, setOrderType] = useState<"delivery" | "pickup" | "dine_in">("dine_in");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [tables, setTables] = useState<Array<{ id: string; table_number: string; is_active?: boolean }>>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [tableBill, setTableBill] = useState<{
    session?: { id: string; customer_name?: string | null; customer_phone?: string | null; table_number?: string };
    orders?: Array<{ id: string; order_number: string; total_amount: number; items?: Array<{ item_name: string; quantity: number }> }>;
    totals?: { order_count: number; total_amount: number };
  } | null>(null);
  const [sessionChoices, setSessionChoices] = useState<typeof tableBill[]>([]);

  // Menu items & Cart
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [variants, setVariants] = useState<VariantItem[]>([]);
  /** Branch item id → parent item id (when branch menu was copied without variants). */
  const [variantSourceByItemId, setVariantSourceByItemId] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [fallbackRestaurantId, setFallbackRestaurantId] = useState<string | null>(null);

  // Custom Item inputs
  const [customItemName, setCustomItemName] = useState("");
  const [customItemPrice, setCustomItemPrice] = useState("");
  const [showCustomItem, setShowCustomItem] = useState(false);

  // Load menu items & fallback restaurant whenever dialog opens
  useEffect(() => {
    if (!open) return;

    let isMounted = true;
    setLoadingItems(true);

    async function loadData() {
      try {
        // Branch: permanently copy missing parent sizes/flavors onto this branch first
        if (activeRestaurantId) {
          try {
            await fetch(`${getApiBase()}/api/restaurants/${activeRestaurantId}/heal-menu-from-parent`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getToken()}`,
              },
              // Rebuild when parent has more sizes/flavors than branch (fixes partial sync)
              body: JSON.stringify({ force: false }),
            });
          } catch {
            // heal is best-effort; UI fallback below still covers display
          }
        }

        // 1. Fetch menu items for the active restaurant only
        let query = supabase.from("menu_items").select("id, name, price, restaurant_id, is_available, image_url");
        if (activeRestaurantId) {
          query = query.eq("restaurant_id", activeRestaurantId);
        }

        const { data: itemsData, error } = await query;
        if (error) console.error("Error fetching menu items:", error);

        let finalItems = ((itemsData as MenuItem[]) || []).filter((i) => i.is_available !== false);
        let finalVariants: VariantItem[] = [];
        const sourceMap: Record<string, string> = {};

        const itemIds = finalItems.map((i) => i.id);
        if (itemIds.length > 0) {
          const { data: variantsData } = await supabase
            .from("menu_item_variants")
            .select("id, menu_item_id, name, price, is_active, variant_type, measurement, parent_id")
            .in("menu_item_id", itemIds)
            .order("sort_order");
          finalVariants = ((variantsData as VariantItem[]) || []).filter((v) => v.is_active !== false);
        }

        // Per-item fallback: if a branch item still has no variants, show parent sizes/flavors by name
        const missingVariantItemIds = finalItems
          .filter((bi) => !finalVariants.some((v) => v.menu_item_id === bi.id))
          .map((bi) => bi.id);

        if (missingVariantItemIds.length > 0 && activeRestaurantId) {
          const { data: rest } = await supabase
            .from("restaurants")
            .select("id, parent_restaurant_id, is_branch")
            .eq("id", activeRestaurantId)
            .maybeSingle();
          const parentId = (rest as { parent_restaurant_id?: string | null } | null)?.parent_restaurant_id;
          if (parentId) {
            const { data: parentItems } = await supabase
              .from("menu_items")
              .select("id, name")
              .eq("restaurant_id", parentId);
            const parentByName = new Map<string, string>();
            for (const pi of (parentItems as { id: string; name: string }[]) || []) {
              parentByName.set(String(pi.name || "").trim().toLowerCase(), pi.id);
            }
            const parentIdsNeeded: string[] = [];
            for (const bi of finalItems) {
              if (!missingVariantItemIds.includes(bi.id)) continue;
              const pid = parentByName.get(String(bi.name || "").trim().toLowerCase());
              if (pid) {
                sourceMap[bi.id] = pid;
                parentIdsNeeded.push(pid);
              }
            }
            if (parentIdsNeeded.length > 0) {
              const { data: parentVariants } = await supabase
                .from("menu_item_variants")
                .select("id, menu_item_id, name, price, is_active, variant_type, measurement, parent_id")
                .in("menu_item_id", [...new Set(parentIdsNeeded)])
                .order("sort_order");
              const extra = ((parentVariants as VariantItem[]) || []).filter((v) => v.is_active !== false);
              finalVariants = [...finalVariants, ...extra];
            }
          }
        }

        if (isMounted) {
          setMenuItems(finalItems);
          setVariants(finalVariants);
          setVariantSourceByItemId(sourceMap);
        }

        if (activeRestaurantId) {
          try {
            const tblRes = await fetch(`${getApiBase()}/api/restaurants/${activeRestaurantId}/tables`, {
              headers: { Authorization: `Bearer ${getToken()}` },
            });
            if (tblRes.ok) {
              const d = await tblRes.json();
              if (isMounted) setTables((d.tables || []).filter((t: any) => t.is_active !== false));
            }
          } catch {
            // tables optional
          }
        }

        // 2. Fetch fallback restaurant id if not available
        if (!activeRestaurantId) {
          const { data: restList } = await supabase
            .from("restaurants")
            .select("id")
            .limit(1);
          const restArr = (restList as any[]) || [];
          if (restArr.length > 0 && isMounted) {
            setFallbackRestaurantId(restArr[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load menu items for manual order:", err);
      } finally {
        if (isMounted) setLoadingItems(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [open, activeRestaurantId]);

  const filteredMenuItems = useMemo(() => {
    if (!itemSearch.trim()) return menuItems;
    const q = itemSearch.toLowerCase();
    return menuItems.filter((m) => m.name.toLowerCase().includes(q));
  }, [menuItems, itemSearch]);

interface AddToCartParams {
  id?: string;
  cart_id?: string;
  name?: string;
  item_name?: string;
  price?: number;
  unit_price?: number;
  menu_item_id?: string | null;
  flavor?: string;
  quantity?: number;
  notes?: string;
}

  const addToCart = (item: AddToCartParams) => {
    const cartId = item.cart_id || item.id || `item-${Date.now()}`;
    const itemName = item.item_name || item.name || "Item";
    const unitPrice = Number(item.unit_price !== undefined ? item.unit_price : item.price) || 0;
    const menuItemId =
      item.menu_item_id !== undefined
        ? item.menu_item_id
        : (cartId.startsWith("custom-") ? null : cartId);
    const notes = item.notes || (item.flavor ? `Flavor: ${item.flavor}` : "");
    const qty = item.quantity || 1;

    setCart((prev) => {
      const existing = prev.find((c) => c.cart_id === cartId);
      if (existing) {
        return prev.map((c) =>
          c.cart_id === cartId ? { ...c, quantity: c.quantity + qty } : c
        );
      }
      return [
        ...prev,
        {
          cart_id: cartId,
          menu_item_id: menuItemId,
          item_name: itemName,
          unit_price: unitPrice,
          quantity: qty,
          notes,
        },
      ];
    });
  };

  const handleAddCustomItem = () => {
    if (!customItemName.trim()) return;
    const priceNum = parseFloat(customItemPrice) || 0;
    const fakeId = `custom-${Date.now()}`;
    addToCart({ id: fakeId, name: customItemName.trim(), price: priceNum, menu_item_id: null });
    setCustomItemName("");
    setCustomItemPrice("");
    setShowCustomItem(false);
  };

  const updateQty = (cartId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.cart_id === cartId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (cartId: string) => {
    setCart((prev) => prev.filter((c) => c.cart_id !== cartId));
  };

  const subtotal = cart.reduce((s, c) => s + c.unit_price * c.quantity, 0);
  const total = subtotal;

  const resetForm = () => {
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setOrderType("dine_in");
    setPaymentMethod("cash");
    setPaymentStatus("unpaid");
    setSelectedTableId("");
    setTableBill(null);
    setSessionChoices([]);
    setCart([]);
    setItemSearch("");
    setShowCustomItem(false);
    setCustomItemName("");
    setCustomItemPrice("");
  };

  useEffect(() => {
    if (!open) return;
    if (defaultTableId) setSelectedTableId(defaultTableId);
    if (defaultCustomerName) setCustomerName(defaultCustomerName);
    if (defaultCustomerPhone) setCustomerPhone(defaultCustomerPhone);
  }, [open, defaultTableId, defaultCustomerName, defaultCustomerPhone]);

  const targetRestaurantId =
    activeRestaurantId ||
    menuItems[0]?.restaurant_id ||
    fallbackRestaurantId;

  const selectedTable = tables.find((t) => t.id === selectedTableId);

  useEffect(() => {
    if (!open || orderType !== "dine_in" || !targetRestaurantId || !selectedTable) {
      if (!selectedTable) {
        setTableBill(null);
        setSessionChoices([]);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({ table_id: selectedTable.id, table_number: selectedTable.table_number });
        if (customerPhone.trim()) q.set("phone", customerPhone.trim());
        const res = await fetch(
          `${getApiBase()}/api/restaurants/${targetRestaurantId}/table-sessions/by-table?${q.toString()}`,
          { headers: { Authorization: `Bearer ${getToken()}` } },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const bills = data.sessions || [];
        if (cancelled) return;
        setSessionChoices(bills);
        const first = bills[0] || null;
        setTableBill(first);
        if (first?.session) {
          if (!customerName.trim() && first.session.customer_name) {
            setCustomerName(first.session.customer_name);
          }
          if (!customerPhone.trim() && first.session.customer_phone) {
            setCustomerPhone(first.session.customer_phone);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orderType, targetRestaurantId, selectedTableId, customerPhone]);

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast({
        variant: "destructive",
        title: t("common:validationError", "Validation Error"),
        description: t("orders:customerNameRequired", "Customer name is required."),
      });
      return;
    }
    if (orderType === "delivery" && !deliveryAddress.trim()) {
      toast({
        variant: "destructive",
        title: t("common:validationError", "Validation Error"),
        description: t("orders:addressRequired", "Delivery address is required."),
      });
      return;
    }
    if (orderType === "dine_in" && !selectedTable) {
      toast({
        variant: "destructive",
        title: t("common:validationError", "Validation Error"),
        description: "Select a table number for dine-in orders.",
      });
      return;
    }
    if (cart.length === 0) {
      toast({
        variant: "destructive",
        title: t("common:validationError", "Validation Error"),
        description: t("orders:cartEmpty", "Please add at least one item."),
      });
      return;
    }
    if (!targetRestaurantId) {
      toast({
        variant: "destructive",
        title: t("common:error", "Error"),
        description: "Restaurant is not selected.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/restaurants/${targetRestaurantId}/staff-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          delivery_address: deliveryAddress.trim(),
          fulfillment_type: orderType,
          table_id: selectedTable?.id || null,
          table_number: selectedTable?.table_number || null,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          subtotal,
          tax_amount: 0,
          delivery_fee: 0,
          total_amount: total,
          lines: cart.map((c) => ({
            menu_item_id: c.menu_item_id || null,
            item_name: c.item_name,
            quantity: c.quantity,
            unit_price: c.unit_price,
            line_total: c.unit_price * c.quantity,
            notes: c.notes || null,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to create order");

      const created = body.order;
      toast({
        title: t("orders:orderCreated", "✅ Order Created"),
        description: `${created?.order_number || ""} · ${customerName} · ${formatCurrency(total)}`,
        duration: 5000,
      });

      window.dispatchEvent(
        new CustomEvent("new-order-created", {
          detail: {
            id: created?.id,
            restaurant_id: targetRestaurantId,
            order_number: created?.order_number,
            customer_name: customerName.trim(),
            total_amount: total,
            created_at: new Date().toISOString(),
          },
        })
      );

      setOpen(false);
      resetForm();
      onOrderCreated?.();
    } catch (err: any) {
      console.error("Order creation failed:", err);
      toast({
        variant: "destructive",
        title: t("common:error", "Error"),
        description: err?.message || "Failed to create order",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            className="h-10 w-full shrink-0 gap-2 rounded-full px-4 font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm sm:w-auto"
            id="btn-create-manual-order"
          >
            <Plus className="h-4 w-4" />
            {triggerLabel || t("orders:newManualOrder", "New Order")}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[min(92vh,900px)] w-[calc(100%-1rem)] max-w-2xl flex-col overflow-hidden p-0 sm:w-[calc(100%-2rem)]">
        <DialogHeader className="px-6 pt-6 pb-2 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {t("orders:createManualOrder", "Create Manual Order")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a dine-in, pickup, or delivery order from the restaurant dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Customer Info Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {t("orders:customerInfo", "Customer Info")}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cust-name" className="flex items-center gap-1.5 text-xs font-semibold">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("orders:customer", "Customer Name")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cust-name"
                  placeholder="e.g. John Doe"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-phone" className="flex items-center gap-1.5 text-xs font-semibold">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("common:phone", "Phone")}
                </Label>
                <Input
                  id="cust-phone"
                  placeholder="e.g. +1 234 567 8900"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>
            </div>

            {orderType === "delivery" && (
            <div className="space-y-1.5">
              <Label htmlFor="cust-addr" className="flex items-center gap-1.5 text-xs font-semibold">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {t("common:address", "Delivery Address")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cust-addr"
                placeholder={t("orders:addressPlaceholder", "Street, City")}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </div>
            )}

            {orderType === "dine_in" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Table number <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                  <SelectTrigger><SelectValue placeholder="Select table" /></SelectTrigger>
                  <SelectContent>
                    {tables.length === 0 ? (
                      <SelectItem value="__none" disabled>No tables configured</SelectItem>
                    ) : (
                      tables.map((tbl) => (
                        <SelectItem key={tbl.id} value={tbl.id}>
                          {/^table\b/i.test(String(tbl.table_number || "").trim())
                            ? String(tbl.table_number).trim()
                            : `Table ${tbl.table_number}`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {orderType === "dine_in" && sessionChoices.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Guest at this table</Label>
                <Select
                  value={tableBill?.session?.id || ""}
                  onValueChange={(id) => {
                    const picked = sessionChoices.find((s) => s?.session?.id === id) || null;
                    setTableBill(picked);
                    if (picked?.session?.customer_name) setCustomerName(picked.session.customer_name);
                    if (picked?.session?.customer_phone) setCustomerPhone(picked.session.customer_phone);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select guest" /></SelectTrigger>
                  <SelectContent>
                    {sessionChoices.map((s) => (
                      <SelectItem key={s?.session?.id} value={s?.session?.id || ""}>
                        {s?.session?.customer_name || "Guest"} · {s?.session?.customer_phone || "No phone"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {orderType === "dine_in" && tableBill?.orders && tableBill.orders.length > 0 && (
              <div className="p-3 rounded-xl border border-primary/25 bg-primary/5 space-y-2">
                <p className="text-xs font-bold text-foreground">
                  Already ordered at this table ({tableBill.totals?.order_count || tableBill.orders.length} orders)
                </p>
                <ul className="space-y-1 text-xs">
                  {tableBill.orders.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span className="truncate">
                        {o.order_number}: {(o.items || []).map((i) => `${i.quantity}× ${i.item_name}`).join(", ")}
                      </span>
                      <span className="font-semibold shrink-0">{formatCurrency(o.total_amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  A new order will be added to the same table invoice for this guest.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orders:orderType", "Order Type")}</Label>
                <Select value={orderType} onValueChange={(v) => setOrderType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dine_in">{t("orders:dineIn", "Dine In")}</SelectItem>
                    <SelectItem value="pickup">{t("orders:pickup", "Pickup")}</SelectItem>
                    <SelectItem value="delivery">{t("orders:delivery", "Delivery")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orders:paymentMethod", "Payment Method")}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("orders:cashOnDelivery", "Cash")}</SelectItem>
                    <SelectItem value="card">{t("orders:creditCard", "Card")}</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orders:paymentStatus", "Payment Status")}</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">{t("orders:unpaid", "Unpaid")}</SelectItem>
                    <SelectItem value="paid">{t("orders:paid", "Paid")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Menu Items Selection Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <UtensilsCrossed className="h-3.5 w-3.5" />
                {t("orders:items", "Select Menu Items")} <span className="text-destructive">*</span>
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-primary hover:text-primary"
                onClick={() => setShowCustomItem((v) => !v)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {showCustomItem ? "Cancel Custom" : "+ Custom Item"}
              </Button>
            </div>

            {/* Custom Item Form */}
            {showCustomItem && (
              <div className="p-3 border border-primary/30 rounded-xl bg-primary/5 space-y-2.5 animate-fade-in">
                <p className="text-xs font-semibold text-foreground">Add Custom / Off-Menu Item</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Item name (e.g. Special Burger)"
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    className="flex-1 h-8 text-xs"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Price (e.g. 15.00)"
                    value={customItemPrice}
                    onChange={(e) => setCustomItemPrice(e.target.value)}
                    className="w-28 h-8 text-xs"
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={handleAddCustomItem} disabled={!customItemName.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            )}

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("orders:searchItems", "Search menu items by name...")}
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Menu Items List / Grid */}
            <div className="border border-border rounded-xl p-2 bg-muted/20 max-h-48 overflow-y-auto space-y-2">
              {loadingItems ? (
                <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Loading menu items...</span>
                </div>
              ) : filteredMenuItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {itemSearch ? `No menu items matching "${itemSearch}"` : "No menu items available. You can add a custom item above."}
                </div>
              ) : (
                filteredMenuItems.map((item) => {
                  const variantItemId = variantSourceByItemId[item.id] || item.id;
                  const itemSizes = variants.filter(
                    (v) => v.menu_item_id === variantItemId && v.variant_type === "size"
                  );
                  const itemFlavors = variants.filter(
                    (v) => v.menu_item_id === variantItemId && v.variant_type !== "size"
                  );
                  const standaloneFlavors = itemFlavors.filter((v) => !v.parent_id);
                  const inCartQty = cart
                    .filter((c) => c.menu_item_id === item.id)
                    .reduce((sum, c) => sum + c.quantity, 0);

                  if (itemSizes.length > 0 || itemFlavors.length > 0) {
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "p-2.5 rounded-lg border border-border/70 transition-all bg-card space-y-2.5",
                          inCartQty > 0 && "border-primary/40 bg-primary/5"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-xs text-foreground truncate">{item.name}</span>
                            {itemSizes.length > 0 && (
                              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                {itemSizes.length} sizes
                              </Badge>
                            )}
                            {itemFlavors.length > 0 && (
                              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                {itemFlavors.length} flavors
                              </Badge>
                            )}
                          </div>
                          {inCartQty > 0 && (
                            <Badge variant="default" className="h-4 px-1.5 text-[9px] font-bold">
                              {inCartQty} in cart
                            </Badge>
                          )}
                        </div>

                        {/* Sizes with their nested flavors */}
                        {itemSizes.length > 0 && (
                          <div className="space-y-2 pt-0.5">
                            {itemSizes.map((s) => {
                              const childFlavors = variants.filter(
                                (v) => v.parent_id === s.id && v.variant_type !== "size"
                              );
                              const sizeLabel = `${s.name}${s.measurement ? ` (${s.measurement})` : ""}`;
                              const sizeCartId = `${item.id}-${s.id}`;
                              const inCartSize = cart.find((c) => c.cart_id === sizeCartId)?.quantity || 0;

                              return (
                                <div
                                  key={s.id}
                                  className="p-2 rounded-lg border bg-muted/30 space-y-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-foreground">
                                      {sizeLabel} — {formatCurrency(s.price)}
                                    </span>
                                    {childFlavors.length === 0 && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={inCartSize > 0 ? "default" : "outline"}
                                        className="h-6 text-[11px] px-2 font-medium"
                                        onClick={() =>
                                          addToCart({
                                            cart_id: sizeCartId,
                                            menu_item_id: item.id,
                                            item_name: `${item.name} (${sizeLabel})`,
                                            unit_price: Number(s.price),
                                            quantity: 1,
                                            notes: `Size: ${sizeLabel}`,
                                          })
                                        }
                                      >
                                        <Plus className="h-2.5 w-2.5 mr-1" />
                                        Add {inCartSize > 0 && `× ${inCartSize}`}
                                      </Button>
                                    )}
                                  </div>

                                  {childFlavors.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                      <span className="text-[10px] font-medium text-muted-foreground mr-0.5">Flavors:</span>
                                      {childFlavors.map((f) => {
                                        const flavorCartId = `${item.id}-${s.id}-${f.id}`;
                                        const inCartFlavor = cart.find((c) => c.cart_id === flavorCartId)?.quantity || 0;
                                        return (
                                          <Button
                                            key={f.id}
                                            type="button"
                                            size="sm"
                                            variant={inCartFlavor > 0 ? "default" : "outline"}
                                            className="h-6 text-[10px] px-2 font-medium"
                                            onClick={() =>
                                              addToCart({
                                                cart_id: flavorCartId,
                                                menu_item_id: item.id,
                                                item_name: `${item.name} (${sizeLabel} · ${f.name})`,
                                                unit_price: Number(s.price),
                                                quantity: 1,
                                                notes: `Size: ${sizeLabel}, Flavor: ${f.name}`,
                                              })
                                            }
                                          >
                                            <Plus className="h-2.5 w-2.5 mr-1" />
                                            {f.name}
                                            {inCartFlavor > 0 && ` × ${inCartFlavor}`}
                                          </Button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Standalone Flavors (for items without sizes) */}
                        {itemSizes.length === 0 && standaloneFlavors.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase mr-1">Flavors:</span>
                            {standaloneFlavors.map((f) => {
                              const flavorCartId = `${item.id}-${f.id}`;
                              const inCart = cart.find((c) => c.cart_id === flavorCartId)?.quantity || 0;
                              const price = Number(f.price) > 0 ? Number(f.price) : Number(item.price);
                              return (
                                <Button
                                  key={f.id}
                                  type="button"
                                  size="sm"
                                  variant={inCart > 0 ? "default" : "outline"}
                                  className="h-6 text-[11px] px-2 font-medium"
                                  onClick={() =>
                                    addToCart({
                                      cart_id: flavorCartId,
                                      menu_item_id: item.id,
                                      item_name: `${item.name} (${f.name})`,
                                      unit_price: price,
                                      quantity: 1,
                                      notes: `Flavor: ${f.name}`,
                                    })
                                  }
                                >
                                  <Plus className="h-2.5 w-2.5 mr-1" />
                                  {f.name} {Number(f.price) > 0 ? `(${formatCurrency(f.price)})` : ""}
                                  {inCart > 0 && ` × ${inCart}`}
                                </Button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-lg border border-transparent hover:border-border transition-all bg-card cursor-pointer group",
                        inCartQty > 0 && "border-primary/30 bg-primary/5"
                      )}
                      onClick={() => addToCart({ cart_id: item.id, item_name: item.name, unit_price: Number(item.price), menu_item_id: item.id, quantity: 1 })}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-xs text-foreground truncate group-hover:text-primary">
                          {item.name}
                        </span>
                        {inCartQty > 0 && (
                          <Badge variant="default" className="h-4 px-1.5 text-[9px] font-bold">
                            {inCartQty} in cart
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {formatCurrency(item.price)}
                        </span>
                        <Button
                          type="button"
                          variant={inCartQty > 0 ? "default" : "outline"}
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart({ cart_id: item.id, item_name: item.name, unit_price: Number(item.price), menu_item_id: item.id, quantity: 1 });
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Order Cart / Summary */}
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Order Items ({cart.reduce((s, c) => s + c.quantity, 0)})
              </h4>

              {cart.length === 0 ? (
                <div className="border border-dashed border-border rounded-xl py-6 text-center text-muted-foreground text-xs">
                  {t("orders:searchAndAddItems", "Click any item above to add it to this order")}
                </div>
              ) : (
                <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-card shadow-sm">
                  {cart.map((c) => (
                    <div key={c.cart_id} className="p-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">{c.item_name}</p>
                        <p className="text-muted-foreground">{formatCurrency(c.unit_price)} each</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          className="h-6 w-6 rounded-full"
                          onClick={() => updateQty(c.cart_id, -1)}
                        >
                          −
                        </Button>
                        <span className="w-5 text-center text-xs font-bold">{c.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          className="h-6 w-6 rounded-full"
                          onClick={() => updateQty(c.cart_id, 1)}
                        >
                          +
                        </Button>
                      </div>
                      <span className="text-xs font-bold text-primary w-16 text-right">
                        {formatCurrency(c.unit_price * c.quantity)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        onClick={() => removeFromCart(c.cart_id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {/* Total row */}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-muted/40 font-bold text-sm">
                    <span className="text-foreground">{t("common:total", "Total")}</span>
                    <span className="text-primary text-base font-extrabold">{formatCurrency(total)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border bg-muted/10 gap-2 flex items-center justify-end">
          <Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={submitting} className="h-9 text-xs">
            {t("common:cancel", "Cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0 || !customerName.trim()}
            className="gradient-primary text-primary-foreground gap-2 min-w-[130px] h-9 text-xs font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShoppingCart className="h-3.5 w-3.5" />
            )}
            {submitting
              ? t("orders:placingOrder", "Placing order...")
              : t("orders:placeOrder", "Place Order")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
