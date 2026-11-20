import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { loadDineInGuest, rememberDineInOrder } from "@/lib/dineInGuest";
import { displayTableLabel } from "@/lib/tableLabel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
} from "@/components/ui/dialog";
import {
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
  Check,
  Sparkles,
  Boxes,
  UtensilsCrossed,
} from "lucide-react";
import { formatCurrency } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getToken } from "@/lib/authStorage";
import { AIChatTest } from "@/components/agents/AIChatTest";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category_id: string | null;
  dietary_tags: string[];
  is_available?: boolean;
  track_inventory?: boolean;
  stock_quantity?: number | null;
};

type Variant = {
  id: string;
  menu_item_id: string;
  name: string;
  measurement?: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
  variant_type?: "size" | "flavor";
  parent_id?: string | null;
};

type Addon = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
};

type ItemAddonLink = {
  menu_item_id: string;
  menu_addon_id: string;
};

type Category = { id: string; name: string; sort_order: number };
type Deal = { id: string; name: string; description: string | null; price: number; original_price: number | null; image_url: string | null };
type Settings = { name: string; phone: string | null; address: string | null; tax_rate: number; delivery_fee: number; min_order_amount: number; currency: string; is_open: boolean; allows_delivery?: boolean; allows_pickup?: boolean };
type Restaurant = { id: string; elevenlabs_agent_id?: string | null };

type BranchOption = { id: string; name: string; address: string | null; phone: string | null; is_accepting_orders?: boolean };
type WorkingHour = { day_of_week: number; open_time: string; close_time: string };

type CartLine = {
  kind: "item" | "deal";
  refId: string;
  itemId?: string;
  name: string;
  price: number;
  quantity: number;
};

function MenuItemImage({ src, alt }: { src?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveMediaUrl(src);
  if (!resolved || failed) {
    return (
      <div className="h-40 w-full flex items-center justify-center bg-muted/50 text-muted-foreground">
        <UtensilsCrossed className="h-8 w-8 opacity-50" />
      </div>
    );
  }
  return (
    <img
      src={resolved}
      alt={alt}
      className="h-40 w-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function Order() {
  const { t } = useTranslation(["ordering", "common", "deals", "menu", "orders"]);
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const isOrderStaff = role === "staff" || role === "admin" || role === "manager";
  const { restaurantSlug, branchId } = useParams<{ restaurantSlug?: string; branchId?: string }>();
  const [searchParams] = useSearchParams();
  const rawTableParam = searchParams.get("table");
  const tableParam = rawTableParam ? decodeURIComponent(rawTableParam).trim() : null;
  const tableIdParam = searchParams.get("table_id") ? searchParams.get("table_id")!.trim() : null;
  const reservationIdParam = searchParams.get("reservation_id") ? searchParams.get("reservation_id")!.trim() : null;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [itemAddons, setItemAddons] = useState<ItemAddonLink[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCat, setActiveCat] = useState<string>("deals");
  const [submitting, setSubmitting] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "pickup" | "dine_in">("delivery");
  const [tableInfo, setTableInfo] = useState<{ id?: string; table_number?: string } | null>(null);
  const [staffTables, setStaffTables] = useState<Array<{ id: string; table_number: string; occupied?: boolean }>>([]);
  const [staffChoice, setStaffChoice] = useState<"pending" | "table" | "online">(
    tableParam || tableIdParam ? "table" : "pending",
  );
  const [checkInNotice, setCheckInNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_name: searchParams.get("name") || searchParams.get("customer_name") || "",
    customer_phone: searchParams.get("phone") || searchParams.get("customer_phone") || "",
    customer_email: searchParams.get("email") || searchParams.get("customer_email") || "",
    delivery_address: "",
    notes: "",
  });
  const [tableBill, setTableBill] = useState<{
    session?: { id: string; table_number?: string; customer_name?: string };
    orders?: Array<{ id: string; order_number: string; total_amount: number; items?: Array<{ item_name: string; quantity: number }> }>;
    totals?: { order_count: number; total_amount: number };
  } | null>(null);

  // Customization Dialog State (Sizes, Flavors, Sauces & Extras)
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [chosenSize, setChosenSize] = useState<Variant | null>(null);
  const [chosenFlavor, setChosenFlavor] = useState<Variant | null>(null);
  const [chosenAddonIds, setChosenAddonIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams();
      if (restaurantSlug) q.set("slug", restaurantSlug);
      if (branchId) q.set("branch", branchId);
      if (tableParam) q.set("table", tableParam);
      if (tableIdParam) q.set("table_id", tableIdParam);

      const res = await fetch(`${getApiBase()}/api/public/storefront${q.toString() ? `?${q.toString()}` : ""}`);
      if (!res.ok) return;
      const bundle = await res.json();
      const s = bundle.settings || {};
      const r = bundle.restaurant || {};
      setRestaurant({ id: r.id, elevenlabs_agent_id: r.elevenlabs_agent_id ?? null });
      setSettings({ ...s, allows_delivery: r.allows_delivery, allows_pickup: r.allows_pickup, restaurant_id: r.id } as any);
      setBranches(bundle.branches || []);

      if (bundle.table || tableParam || tableIdParam) {
        const tbl = bundle.table || { id: tableIdParam || undefined, table_number: tableParam || undefined };
        setTableInfo(tbl);
        setFulfillmentType("dine_in");

        // Automatically trigger check-in for this table
        try {
          const checkInRes = await fetch(`${getApiBase()}/api/public/tables/check-in`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              restaurant_id: r.id,
              branch_id: r.is_branch ? r.id : undefined,
              slug: restaurantSlug,
              table_id: tableIdParam || tbl?.id,
              table_number: tableParam || tbl?.table_number,
            }),
          });
          const checkInData = await checkInRes.json();
          if (checkInData.seated) {
            setCheckInNotice(checkInData.message || "Reservation checked in as Seated.");
            toast.success(checkInData.message || "Welcome! You are checked in to your table.");
          } else if (checkInData.table) {
            setCheckInNotice(
              `Welcome! You are seated at ${displayTableLabel(checkInData.table.table_number)}.`,
            );
          }
        } catch (err) {
          console.warn("Table check-in request error:", err);
        }
      } else if (r.allows_delivery === false && r.allows_pickup !== false) {
        setFulfillmentType("pickup");
      }
      
      setCategories(bundle.categories || []);
      setItems(bundle.items || []);
      setDeals(bundle.deals || []);
      setHours(bundle.hours || []);
      setVariants(bundle.variants || []);
      setAddons(bundle.addons || []);
      setItemAddons(bundle.itemAddons || []);

      if ((bundle.deals?.length ?? 0) === 0 && (bundle.categories?.length ?? 0) > 0) {
        setActiveCat(bundle.categories[0].id);
      }

      if (bundle.table || tableParam || tableIdParam) {
        const saved = loadDineInGuest(
          r.id,
          tableIdParam || bundle.table?.id,
          tableParam || bundle.table?.table_number,
        );
        if (saved) {
          setForm((f) => ({
            ...f,
            customer_name: f.customer_name || saved.customer_name,
            customer_phone: f.customer_phone || saved.customer_phone,
            customer_email: f.customer_email || saved.customer_email,
          }));
        }
      }
    })();
  }, [restaurantSlug, branchId, tableParam, tableIdParam]);

  useEffect(() => {
    if (!isOrderStaff || !restaurant?.id || !user) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${getApiBase()}/api/restaurants/${restaurant.id}/floor-tables`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const rows = Array.isArray(data?.tables) ? data.tables : [];
      setStaffTables(
        rows
          .filter((table: { is_active?: boolean }) => table.is_active !== false)
          .map((table: { id: string; table_number: string; occupied?: boolean }) => ({
            id: table.id,
            table_number: table.table_number,
            occupied: table.occupied,
          })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isOrderStaff, restaurant?.id, user]);

  const chooseStaffTable = (table: { id: string; table_number: string }) => {
    setTableInfo({ id: table.id, table_number: table.table_number });
    setFulfillmentType("dine_in");
    setStaffChoice("table");
  };

  const chooseStaffOnline = () => {
    setTableInfo(null);
    setFulfillmentType(settings?.allows_delivery === false ? "pickup" : "delivery");
    setStaffChoice("online");
  };

  const addItem = (line: Omit<CartLine, "quantity">) => {
    setCart((prev) => {
      const idx = prev.findIndex((p) => p.kind === line.kind && p.refId === line.refId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  };

  const handleItemAddClick = (it: MenuItem) => {
    const itemSizes = variants.filter((v) => v.menu_item_id === it.id && v.variant_type === "size");
    const itemFlavors = variants.filter((v) => v.menu_item_id === it.id && v.variant_type !== "size");
    const linkedAddonIds = itemAddons.filter((l) => l.menu_item_id === it.id).map((l) => l.menu_addon_id);
    const itemLinkedAddons = addons.filter((a) => linkedAddonIds.includes(a.id));

    // If item has sizes, flavors or sauces/addons, open customization dialog
    if (itemSizes.length > 0 || itemFlavors.length > 0 || itemLinkedAddons.length > 0) {
      setCustomizingItem(it);
      const firstActiveSize = itemSizes.find((s) => s.is_active !== false) || itemSizes[0] || null;
      let initialFlavor: Variant | null = null;
      if (firstActiveSize) {
        const flavorsForSize = itemFlavors.filter((f) => f.parent_id === firstActiveSize.id);
        initialFlavor = flavorsForSize.find((f) => f.is_active !== false) || flavorsForSize[0] || null;
      }
      if (!initialFlavor) {
        initialFlavor = itemFlavors.find((f) => f.is_active !== false) || itemFlavors[0] || null;
      }
      setChosenSize(firstActiveSize);
      setChosenFlavor(initialFlavor);
      setChosenAddonIds([]);
    } else {
      addItem({ kind: "item", refId: it.id, itemId: it.id, name: it.name, price: Number(it.price) });
      toast.success(`Added ${it.name} to cart`);
    }
  };

  const selectSize = (size: Variant) => {
    setChosenSize(size);
    const flavorsForThisSize = variants.filter(
      (v) => v.menu_item_id === customizingItem?.id && v.variant_type !== "size" && v.parent_id === size.id
    );
    if (flavorsForThisSize.length > 0) {
      const match = flavorsForThisSize.find((f) => f.name.toLowerCase() === chosenFlavor?.name.toLowerCase());
      if (match) {
        setChosenFlavor(match);
      } else {
        const firstActive = flavorsForThisSize.find((f) => f.is_active !== false) || flavorsForThisSize[0];
        setChosenFlavor(firstActive);
      }
    }
  };

  const addCustomizedItemToCart = () => {
    if (!customizingItem) return;
    if (activeCustomizingSizes.length > 0 && !chosenSize) {
      return toast.error("Please choose a size");
    }
    if (chosenSize && chosenSize.is_active === false) {
      return toast.error("Selected size is currently unavailable");
    }
    if (activeCustomizingFlavors.length > 0 && !chosenFlavor) {
      return toast.error("Please choose a flavor");
    }
    if (chosenFlavor && chosenFlavor.is_active === false) {
      return toast.error("Selected flavor is currently unavailable");
    }

    const basePrice = chosenSize ? Number(chosenSize.price) : Number(customizingItem.price);
    const flavorExtra = chosenFlavor && Number(chosenFlavor.price) > 0 ? Number(chosenFlavor.price) : 0;
    const selectedAddonsList = addons.filter((a) => chosenAddonIds.includes(a.id));
    const addonsTotal = selectedAddonsList.reduce((sum, a) => sum + Number(a.price), 0);
    const finalPrice = basePrice + flavorExtra + addonsTotal;

    const sizeName = chosenSize
      ? `${chosenSize.name}${chosenSize.measurement ? ` — ${chosenSize.measurement}` : ""}`
      : "";
    const flavorName = chosenFlavor ? chosenFlavor.name : "";

    let descriptor = "";
    if (sizeName && flavorName) {
      descriptor = ` (${sizeName} · ${flavorName})`;
    } else if (sizeName) {
      descriptor = ` (${sizeName})`;
    } else if (flavorName) {
      descriptor = ` (${flavorName})`;
    }

    const addonsPart =
      selectedAddonsList.length > 0 ? ` + ${selectedAddonsList.map((a) => a.name).join(", ")}` : "";
    const fullName = `${customizingItem.name}${descriptor}${addonsPart}`;

    addItem({
      kind: "item",
      refId: `${customizingItem.id}:::${chosenSize?.id || "nosize"}:::${chosenFlavor?.id || "noflavor"}:::${chosenAddonIds.sort().join(",")}`,
      itemId: customizingItem.id,
      name: fullName,
      price: finalPrice,
    });

    setCustomizingItem(null);
    toast.success(`Added ${fullName} to order!`);
  };

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p)));
  };
  const removeLine = (idx: number) => setCart((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.quantity, 0), [cart]);
  const tax = useMemo(() => subtotal * ((settings?.tax_rate || 0) / 100), [subtotal, settings]);
  const deliveryFee = fulfillmentType === "delivery" ? Number(settings?.delivery_fee || 0) : 0;
  const total = subtotal + tax + deliveryFee;

  const isOpenNow = useMemo(() => {
    if (!hours.length) return true; // default open if no hours set
    const now = new Date();
    const day = now.getDay();
    const currentTime = now.getHours() * 100 + now.getMinutes();

    const todaySlots = hours.filter((h) => h.day_of_week === day);
    if (!todaySlots.length) return false;

    return todaySlots.some((slot) => {
      const [oH, oM] = slot.open_time.split(":").map(Number);
      const [cH, cM] = slot.close_time.split(":").map(Number);
      const open = oH * 100 + oM;
      const close = cH * 100 + cM;
      return currentTime >= open && currentTime <= close;
    });
  }, [hours]);

  useEffect(() => {
    const isDineIn = fulfillmentType === "dine_in" || Boolean(tableInfo || tableParam);
    const restaurantId = (settings as any)?.restaurant_id || restaurant?.id;
    const tableNumber = tableInfo?.table_number || tableParam;
    if (!isDineIn || !restaurantId || !tableNumber) {
      setTableBill(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
        });
        if (tableInfo?.id || tableIdParam) q.set("table_id", tableInfo?.id || tableIdParam || "");
        const res = await fetch(`${getApiBase()}/api/public/table-session?${q.toString()}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        setTableBill(data.session ? data : null);
      } catch {
        // ignore aborted / network
      }
    }, 400);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [fulfillmentType, tableInfo, tableParam, tableIdParam, settings, restaurant]);

  const submitOrder = async () => {
    if (cart.length === 0) return toast.error("Your cart is empty");
    const isDineIn = fulfillmentType === "dine_in";
    if (!isDineIn && !form.customer_name.trim()) {
      return toast.error("Please enter your name");
    }
    if (!isDineIn && !form.customer_phone.trim()) {
      return toast.error("Please enter required name and contact details");
    }
    if (fulfillmentType === "delivery" && !form.delivery_address) {
      return toast.error("Please enter required name and contact details");
    }
    if (settings && Number(settings.min_order_amount || 0) > 0 && subtotal < Number(settings.min_order_amount) && !isDineIn) {
      return toast.error(`Minimum order amount is ${formatCurrency(settings.min_order_amount, settings.currency)}. Orders below this amount cannot be placed.`);
    }
    setSubmitting(true);
    try {
      const restaurantId = (settings as any)?.restaurant_id || restaurant?.id;
      if (!restaurantId) {
        toast.error("Restaurant configuration missing");
        setSubmitting(false);
        return;
      }
      const lines = cart.map((l) => {
        let menuItemId: string | null = null;
        if (l.kind === "item") {
          menuItemId = l.itemId || (l.refId.includes(":::") ? l.refId.split(":::")[0] : l.refId);
        }
        return {
          menu_item_id: menuItemId,
          deal_id: l.kind === "deal" ? l.refId : null,
          item_name: l.name,
          quantity: l.quantity,
          unit_price: l.price,
          line_total: l.price * l.quantity,
        };
      });
      const tableNumber = tableInfo?.table_number || tableParam || null;
      const tableId = tableInfo?.id || tableIdParam || null;
      const dineInName = displayTableLabel(tableNumber || "Guest");
      const dineInPhone = "";

      const res = await fetch(`${getApiBase()}/api/public/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          branch_id: selectedBranchId || (restaurant?.id !== restaurantId ? restaurant?.id : null),
          customer_name: isDineIn ? dineInName : form.customer_name,
          customer_phone: isDineIn ? dineInPhone : form.customer_phone.trim(),
          customer_email: isDineIn ? null : form.customer_email || null,
          delivery_address: isDineIn
            ? `Dine-in (${displayTableLabel(tableNumber || "Assigned")})`
            : fulfillmentType === "delivery"
            ? form.delivery_address
            : "Self Pickup",
          fulfillment_type: fulfillmentType,
          table_id: tableId,
          table_number: tableNumber,
          reservation_id: reservationIdParam || null,
          notes: form.notes || null,
          subtotal,
          tax_amount: tax,
          delivery_fee: isDineIn ? 0 : deliveryFee,
          total_amount: isDineIn ? subtotal + tax : total,
          lines,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Order failed");
      const order = body.order;
      if (isDineIn && order?.id) {
        rememberDineInOrder(
          restaurantId,
          tableId,
          tableNumber,
          order.id,
          order.table_session_id || body.session?.id || null,
        );
      }
      toast.success(isDineIn ? "Dine-in order placed to kitchen!" : "Order placed! We sent a tracking link to your phone.");
      navigate(`/track/${order.tracking_code}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  const visibleItems = useMemo(
    () => items.filter((i) => i.category_id === activeCat),
    [items, activeCat],
  );

  // Customization active options
  const activeCustomizingSizes = useMemo(() => {
    if (!customizingItem) return [];
    return variants
      .filter((v) => v.menu_item_id === customizingItem.id && v.variant_type === "size")
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [customizingItem, variants]);

  const activeCustomizingFlavors = useMemo(() => {
    if (!customizingItem) return [];
    const itemFlavors = variants.filter(
      (v) => v.menu_item_id === customizingItem.id && v.variant_type !== "size"
    );
    // If a size is selected and has child flavors, filter to ONLY that size's flavors!
    if (chosenSize) {
      const sizeFlavors = itemFlavors.filter((f) => f.parent_id === chosenSize.id);
      if (sizeFlavors.length > 0) return sizeFlavors.sort((a, b) => a.sort_order - b.sort_order);
    }
    // Fallback: root flavors without parent
    return itemFlavors.filter((f) => !f.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  }, [customizingItem, variants, chosenSize]);

  const activeCustomizingAddons = useMemo(() => {
    if (!customizingItem) return [];
    const linkedIds = itemAddons
      .filter((l) => l.menu_item_id === customizingItem.id)
      .map((l) => l.menu_addon_id);
    return addons.filter((a) => linkedIds.includes(a.id));
  }, [customizingItem, itemAddons, addons]);

  const computedCustomizingTotal = useMemo(() => {
    if (!customizingItem) return 0;
    const basePrice = chosenSize ? Number(chosenSize.price) : Number(customizingItem.price);
    const flavorExtra = chosenFlavor && Number(chosenFlavor.price) > 0 ? Number(chosenFlavor.price) : 0;
    const selectedAddonsList = addons.filter((a) => chosenAddonIds.includes(a.id));
    const addonsTotal = selectedAddonsList.reduce((sum, a) => sum + Number(a.price), 0);
    return basePrice + flavorExtra + addonsTotal;
  }, [customizingItem, chosenSize, chosenFlavor, chosenAddonIds, addons]);

  const waitingForTableChoice = isOrderStaff && staffChoice === "pending" && !tableParam && !tableIdParam;

  if (waitingForTableChoice) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b bg-card">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-foreground">{settings?.name || "Restaurant"}</h1>
              <p className="text-xs text-muted-foreground">Staff order</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </header>
        <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-10 space-y-6">
          <div>
            <h2 className="text-2xl font-black tracking-tight">Where is this order?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Pick a table first. If the guest is not sitting at a table, place a normal online order.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {staffTables.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => chooseStaffTable(table)}
                className="rounded-2xl border bg-card p-4 text-left hover:border-primary hover:bg-primary/5"
              >
                <p className="text-lg font-black">Table {table.table_number}</p>
                <p className="text-xs text-muted-foreground">{table.occupied ? "Guests seated" : "Available"}</p>
              </button>
            ))}
          </div>
          {staffTables.length === 0 && (
            <p className="text-sm text-muted-foreground">No tables are set up yet. You can still place an online order.</p>
          )}
          <Button className="w-full sm:w-auto" size="lg" onClick={chooseStaffOnline}>
            No table — place an online order
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <span>{settings?.name || "Restaurant"}</span>
              {isOpenNow ? (
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-semibold">
                  Open
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs font-semibold">
                  Closed
                </Badge>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">{settings?.address || ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {isOrderStaff && !tableParam && !tableIdParam && (
              <Button variant="outline" size="sm" onClick={() => setStaffChoice("pending")}>
                {staffChoice === "table"
                  ? displayTableLabel(tableInfo?.table_number || "")
                  : "Online order"}
              </Button>
            )}
            <LanguageSwitcher />
            {/* Hide staff entry on table QR menus — guests must not jump into dashboard/reception */}
            {!tableParam && !tableIdParam ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/login">{t("ordering:staffLogin", "Staff login")}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Dine-In Table Banner */}
      {(fulfillmentType === "dine_in" || tableInfo || tableParam) && (
        <section className="bg-primary/10 border-b border-primary/20 py-3 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <UtensilsCrossed className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-primary uppercase tracking-wider">
                  Dine-In Menu · {displayTableLabel(tableInfo?.table_number || tableParam)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {checkInNotice || "Your table is checked in. Order directly to your table."}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30 text-xs font-bold gap-1">
              <Check className="h-3 w-3" /> Seated & Active
            </Badge>
          </div>
        </section>
      )}

      {/* Hero / Banner */}
      <section className="bg-muted/40 border-b py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-foreground">{t("ordering:heroTitle", "Delicious Food Delivered Fast")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("ordering:heroSubtitle", "Choose from our chef-crafted deals, specialty pizzas, and authentic meals.")}
            </p>
          </div>
          {restaurant?.elevenlabs_agent_id &&
          fulfillmentType !== "dine_in" &&
          !tableInfo &&
          !tableParam ? (
            <AIChatTest agentId={restaurant.elevenlabs_agent_id} />
          ) : null}
        </div>
      </section>

      {/* Category Pills Nav */}
      <nav className="border-b bg-card sticky top-[57px] z-10 overflow-x-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2">
          {deals.length > 0 && (
            <Button
              size="sm"
              variant={activeCat === "deals" ? "default" : "outline"}
              onClick={() => setActiveCat("deals")}
              className="rounded-full text-xs font-semibold shrink-0"
            >
              🔥 {t("deals:title", "Special Deals")} ({deals.length})
            </Button>
          )}
          {categories.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={activeCat === c.id ? "default" : "outline"}
              onClick={() => setActiveCat(c.id)}
              className="rounded-full text-xs font-semibold shrink-0"
            >
              {c.name}
            </Button>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 w-full">
        {/* Menu Items Grid */}
        <section className="space-y-4">
          {activeCat === "deals" && deals.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {deals.map((d) => (
                <Card key={d.id} className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 shadow-xs transition-shadow hover:shadow-sm">
                  {d.image_url ? <MenuItemImage src={d.image_url} alt={d.name} /> : null}
                  <CardContent className="p-4 flex flex-col justify-between flex-1">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-base text-foreground">{d.name}</h3>
                        <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold shrink-0">
                          {t("deals:dealBadge", "Deal")}
                        </Badge>
                      </div>
                      {d.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{d.description}</p>}
                    </div>
                    <div className="mt-4 flex items-center justify-between pt-2 border-t">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-black text-foreground">{formatCurrency(d.price, settings?.currency)}</span>
                        {d.original_price && Number(d.original_price) > Number(d.price) && (
                          <span className="text-xs text-muted-foreground line-through">
                            {formatCurrency(d.original_price, settings?.currency)}
                          </span>
                        )}
                      </div>
                      <Button size="sm" onClick={() => addItem({ kind: "deal", refId: d.id, name: d.name, price: Number(d.price) })}>
                        <Plus className="h-4 w-4 mr-1" /> {t("ordering:addDeal", "Add")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {visibleItems.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {visibleItems.map((it) => {
                const itemSizes = variants.filter((v) => v.menu_item_id === it.id && v.variant_type === "size");
                const itemFlavors = variants.filter((v) => v.menu_item_id === it.id && v.variant_type !== "size");
                const linkedAddons = itemAddons.filter((l) => l.menu_item_id === it.id);
                const hasCustomization = itemSizes.length > 0 || itemFlavors.length > 0 || linkedAddons.length > 0;
                const isOutOfStock = !it.is_available || (it.track_inventory && Number(it.stock_quantity || 0) <= 0);

                const sizePrices = itemSizes.filter((s) => s.is_active).map((s) => Number(s.price));
                const minSizePrice = sizePrices.length > 0 ? Math.min(...sizePrices) : Number(it.price);

                return (
                  <Card key={it.id} className={cn("flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 shadow-xs transition-shadow hover:shadow-sm", isOutOfStock && "opacity-60")}>
                    {it.image_url ? (
                      <MenuItemImage src={it.image_url} alt={it.name} />
                    ) : null}
                    <CardContent className="p-4 flex flex-col justify-between flex-1">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-base text-foreground">{it.name}</h3>
                          {isOutOfStock && (
                            <Badge variant="destructive" className="text-xs font-semibold shrink-0">
                              {t("menu:outOfStock", "Out of Order")}
                            </Badge>
                          )}
                        </div>
                        {it.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{it.description}</p>}
                        
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-foreground">
                            {sizePrices.length > 0
                              ? `From ${formatCurrency(minSizePrice, settings?.currency)}`
                              : formatCurrency(it.price, settings?.currency)}
                          </span>
                          {it.dietary_tags?.map((t) => (
                            <Badge key={t} variant="secondary" className="text-xs">
                              {t}
                            </Badge>
                          ))}
                          {itemSizes.length > 0 && (
                            <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-xs font-semibold">
                              {itemSizes.length} {itemSizes.length === 1 ? "Size" : "Sizes"}
                            </Badge>
                          )}
                          {itemFlavors.length > 0 && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                              {itemFlavors.length} {itemFlavors.length === 1 ? "Flavor" : "Flavors"}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {isOutOfStock ? (
                        <Button
                          disabled
                          variant="secondary"
                          size="sm"
                          className="opacity-70 cursor-not-allowed bg-muted text-muted-foreground border border-border mt-3"
                        >
                          {t("menu:outOfStock", "Out of Order")}
                        </Button>
                      ) : (
                        <Button className="mt-3" onClick={() => handleItemAddClick(it)}>
                          <Plus className="h-4 w-4 mr-1" />
                          {itemSizes.length > 0 && itemFlavors.length > 0
                            ? t("ordering:chooseSizeAndFlavor", "Choose Size & Flavor")
                            : itemSizes.length > 0
                            ? t("ordering:chooseSize", "Choose Size")
                            : itemFlavors.length > 0
                            ? t("ordering:chooseFlavor", "Choose Flavor")
                            : hasCustomization
                            ? t("ordering:itemOptions", "Customize")
                            : t("ordering:addToCart", "Add")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {activeCat !== "deals" && visibleItems.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">{t("menu:noItemsFound", "No items in this category.")}</p>
          )}
        </section>

        {/* Cart */}
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-5 w-5" /> {t("ordering:yourCart", "Your order")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 && <p className="text-sm text-muted-foreground py-2 text-center">{t("ordering:emptyCart", "Cart is empty.")}</p>}
              {cart.map((l, idx) => (
                <div key={idx} className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground leading-snug">{l.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatCurrency(l.price, settings?.currency)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-sm font-bold">{l.quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeLine(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("ordering:subtotal", "Subtotal")}</span>
                  <span>{formatCurrency(subtotal, settings?.currency)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("ordering:tax", "Tax")}</span>
                  <span>{formatCurrency(tax, settings?.currency)}</span>
                </div>
                {fulfillmentType !== "dine_in" && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("ordering:deliveryFee", "Delivery")}</span>
                    <span>{formatCurrency(deliveryFee, settings?.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-2 border-t text-foreground">
                  <span>{t("ordering:total", "Total")}</span>
                  <span>{formatCurrency(total, settings?.currency)}</span>
                </div>
              </div>

              {/* Fulfillment Switch & Customer Details */}
              <div className="space-y-3 pt-3 border-t">
                {fulfillmentType === "dine_in" ? (
                  <div className="p-3 bg-primary/10 border border-primary/25 rounded-xl text-primary space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                        <UtensilsCrossed className="h-3.5 w-3.5" /> Dine-In Order
                      </span>
                      <Badge variant="outline" className="bg-primary/20 border-primary/30 text-[10px] font-bold">
                        {displayTableLabel(tableInfo?.table_number || tableParam)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This order will be prepared and served directly to your table.
                    </p>
                  </div>
                ) : (
                  settings?.allows_delivery !== false && settings?.allows_pickup !== false && (
                    <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
                      <Button
                        type="button"
                        size="sm"
                        variant={fulfillmentType === "delivery" ? "default" : "ghost"}
                        className="text-xs h-8"
                        onClick={() => setFulfillmentType("delivery")}
                      >
                        🛵 {t("ordering:delivery", "Delivery")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={fulfillmentType === "pickup" ? "default" : "ghost"}
                        className="text-xs h-8"
                        onClick={() => setFulfillmentType("pickup")}
                      >
                        🛍️ {t("orders:pickup", "Pickup")}
                      </Button>
                    </div>
                  )
                )}

                {fulfillmentType !== "dine_in" && (
                  <>
                    <div>
                      <Label>{t("ordering:customerName", "Your Name")} *</Label>
                      <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="John Doe" />
                    </div>
                    <div>
                      <Label>
                        {t("ordering:customerPhone", "Phone Number")} *
                      </Label>
                      <Input
                        value={form.customer_phone}
                        onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                        placeholder="03XXXXXXXXX"
                        required
                      />
                    </div>
                    <div>
                      <Label>{t("ordering:customerEmail", "Email")}</Label>
                      <Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} />
                    </div>
                  </>
                )}
                {fulfillmentType === "dine_in" && tableBill?.orders && tableBill.orders.length > 0 && (
                  <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-2">
                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
                      Open table bill · {tableBill.totals?.order_count || tableBill.orders.length} previous order(s)
                    </p>
                    <ul className="space-y-1 text-xs text-foreground">
                      {tableBill.orders.map((o) => (
                        <li key={o.id} className="flex justify-between gap-2">
                          <span className="truncate">
                            {o.order_number}: {(o.items || []).map((i) => `${i.quantity}× ${i.item_name}`).join(", ") || "Items"}
                          </span>
                          <span className="font-semibold shrink-0">{formatCurrency(o.total_amount, settings?.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      This new order will be added to the same table invoice.
                    </p>
                  </div>
                )}

                {fulfillmentType === "dine_in" ? (
                  <div className="p-2.5 rounded-lg bg-muted text-xs flex items-center justify-between">
                    <span className="text-muted-foreground">Serving Table:</span>
                    <span className="font-bold text-foreground">
                      {displayTableLabel(tableInfo?.table_number || tableParam || "Assigned")}
                    </span>
                  </div>
                ) : fulfillmentType === "delivery" ? (
                  <div>
                    <Label>{t("ordering:deliveryAddress", "Delivery Address")} *</Label>
                    <Textarea
                      value={form.delivery_address}
                      onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                      placeholder="Enter your full address"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {branches.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">{t("orders:pickupLocation", "Pickup Location")}</Label>
                        <select
                          value={selectedBranchId}
                          onChange={(e) => setSelectedBranchId(e.target.value)}
                          className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="">{settings?.name || "Main Location"} (Main)</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id} disabled={b.is_accepting_orders === false}>
                              {b.name} {b.address ? `— ${b.address}` : ""} {b.is_accepting_orders === false ? "(Closed)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="p-3 rounded-lg border bg-primary/5 text-primary text-xs flex flex-col gap-1">
                      <p className="font-bold">{t("orders:pickup", "Pickup from")}:</p>
                      <p className="font-semibold">
                        {selectedBranchId
                          ? branches.find((b) => b.id === selectedBranchId)?.name || settings?.name
                          : settings?.name}
                      </p>
                      <p className="opacity-85">
                        {selectedBranchId
                          ? branches.find((b) => b.id === selectedBranchId)?.address || settings?.address
                          : settings?.address}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <Label>{t("ordering:specialInstructions", "Notes")}</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any special instructions?" />
                </div>
                <Button className="w-full font-bold" onClick={submitOrder} disabled={submitting || cart.length === 0}>
                  {submitting ? t("ordering:processingOrder", "Placing order…") : `${t("ordering:placeOrder", "Place order")} — ${formatCurrency(total, settings?.currency)}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>

      {/* Item Customization Dialog (Sizes, Flavors & Extras) */}
      <Dialog open={!!customizingItem} onOpenChange={(open) => !open && setCustomizingItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("ordering:itemOptions", "Customize")} {customizingItem?.name}
            </DialogTitle>
            {customizingItem?.description ? (
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                {customizingItem.description}
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">Customize item options</DialogDescription>
            )}
          </DialogHeader>

          <DialogBody className="space-y-5 py-2">
            {/* 1. Size Selection */}
            {activeCustomizingSizes.length > 0 && (
              <div className="space-y-2.5">
                <Label className="text-sm font-bold text-foreground uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 text-blue-500" />
                  1. {t("ordering:chooseSize", "Choose your size")} *
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeCustomizingSizes.map((s) => {
                    const isSelected = chosenSize?.id === s.id;
                    const isUnavailable = s.is_active === false;

                    return (
                      <button
                        type="button"
                        key={s.id}
                        disabled={isUnavailable}
                        onClick={() => !isUnavailable && selectSize(s)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border text-left transition-all relative",
                          isUnavailable
                            ? "opacity-50 cursor-not-allowed bg-muted/40 border-dashed border-border"
                            : isSelected
                            ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-bold shadow-xs ring-1 ring-blue-500"
                            : "border-border hover:bg-muted/50 text-foreground"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("text-sm font-semibold truncate", isUnavailable && "line-through text-muted-foreground")}>
                            {s.name}{s.measurement ? ` — ${s.measurement}` : ""}
                          </span>
                          {isUnavailable && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                              {t("menu:unavailable", "Unavailable")}
                            </Badge>
                          )}
                        </div>
                        <span className="text-sm tabular-nums font-bold shrink-0 ml-2">
                          {formatCurrency(s.price, settings?.currency)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Flavor Selection */}
            {activeCustomizingFlavors.length > 0 && (
              <div className="space-y-2.5">
                <Label className="text-sm font-bold text-foreground uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {activeCustomizingSizes.length > 0 ? "2" : "1"}. {t("ordering:chooseFlavor", "Choose your flavor")} *
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeCustomizingFlavors.map((f) => {
                    const isSelected = chosenFlavor?.id === f.id;
                    const isUnavailable = f.is_active === false;

                    return (
                      <button
                        type="button"
                        key={f.id}
                        disabled={isUnavailable}
                        onClick={() => !isUnavailable && setChosenFlavor(f)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border text-left transition-all relative",
                          isUnavailable
                            ? "opacity-50 cursor-not-allowed bg-muted/40 border-dashed border-border"
                            : isSelected
                            ? "border-primary bg-primary/10 text-primary font-bold shadow-xs ring-1 ring-primary"
                            : "border-border hover:bg-muted/50 text-foreground"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("text-sm font-semibold truncate", isUnavailable && "line-through text-muted-foreground")}>
                            {f.name}
                          </span>
                          {isUnavailable && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                              {t("menu:unavailable", "Unavailable")}
                            </Badge>
                          )}
                        </div>
                        {Number(f.price) > 0 && (
                          <span className="text-sm tabular-nums font-bold shrink-0 ml-2">
                            +{formatCurrency(f.price, settings?.currency)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Sauces & Add-ons Selection */}
            {activeCustomizingAddons.length > 0 && (
              <div className="space-y-2.5">
                <Label className="text-sm font-bold text-foreground uppercase tracking-wider text-xs">
                  {(activeCustomizingSizes.length > 0 ? 1 : 0) + (activeCustomizingFlavors.length > 0 ? 1 : 0) + 1}. {t("menu:tabAddOns", "Choose Extra Sauces / Add-ons")} ({t("common:optional", "Optional")})
                </Label>
                <div className="space-y-2">
                  {activeCustomizingAddons.map((ad) => {
                    const isChecked = chosenAddonIds.includes(ad.id);
                    return (
                      <label
                        key={ad.id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
                          isChecked
                            ? "border-primary bg-primary/5 text-foreground font-semibold shadow-2xs"
                            : "border-border hover:bg-muted/40 text-foreground"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => {
                              setChosenAddonIds((prev) =>
                                isChecked ? prev.filter((id) => id !== ad.id) : [...prev, ad.id]
                              );
                            }}
                          />
                          <div>
                            <span className="text-sm font-medium">{ad.name}</span>
                            {ad.description && (
                              <p className="text-xs text-muted-foreground">{ad.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-bold text-primary tabular-nums">
                          +{formatCurrency(ad.price, settings?.currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </DialogBody>

          <DialogFooter className="flex-col sm:flex-row items-center justify-between gap-3 border-t pt-3">
            <div className="text-left w-full sm:w-auto">
              <span className="text-xs text-muted-foreground block">{t("ordering:total", "Total Price")}</span>
              <span className="text-lg font-black text-foreground">
                {formatCurrency(computedCustomizingTotal, settings?.currency)}
              </span>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button variant="outline" onClick={() => setCustomizingItem(null)}>
                {t("common:cancel", "Cancel")}
              </Button>
              <Button onClick={addCustomizedItemToCart} className="font-bold">
                {t("ordering:addToCart", "Add to Cart")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}