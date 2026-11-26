import { useEffect, useState, useMemo, type ReactNode, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  Clock,
  User,
  Truck,
  MapPin,
  ShoppingBag,
  Search,
  Calendar,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  ArrowUpDown,
  DollarSign,
  X,
  Store,
  Building2,
  Loader2,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Check,
  UtensilsCrossed,
  ChefHat,
  RefreshCw,
  ChevronDown,
  LayoutGrid,
  Zap,
  Tag,
  Share2,
  Eraser,
  ClipboardList,
  type LucideProps,
} from "lucide-react";

/** Select trigger with leading icon — full-width, readable on mobile. */
function FilterSelectTrigger({
  icon: Icon,
  children,
  className,
}: {
  icon: ComponentType<LucideProps>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="relative w-full min-w-0">
      <Icon
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <SelectTrigger
        className={cn(
          "h-11 w-full rounded-xl border-border/80 bg-background py-0 pl-9 pr-9 text-left text-sm leading-none shadow-none",
          "[&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:items-center [&>span]:truncate [&>span]:leading-none",
          className,
        )}
      >
        {children}
      </SelectTrigger>
    </div>
  );
}
import { CreateManualOrderDialog } from "@/components/orders/CreateManualOrderDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_COLORS,
  formatCurrency,
  OrderStatus,
} from "@/lib/restaurant";
import { getOrderStatusLabel, formatDate, formatTime } from "@/i18n/formatters";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { orderTakerLabel } from "@/lib/orderTaker";
import {
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  matchesOrderChannel,
  orderChannel,
} from "@/lib/orderChannel";

interface Order {
  id: string;
  restaurant_id?: string;
  order_number: string;
  tracking_code: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_notes: string | null;
  status: OrderStatus;
  source: string;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  tax_amount: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  driver_id: string | null;
  call_id: string | null;
  created_at: string;
  ai_extracted_data: any;
  is_transferred?: boolean;
  transferred_from_restaurant_id?: string | null;
  transfer_reason?: string | null;
  transfer_status?: string | null;
  pending_transfer_to_restaurant_id?: string | null;
  transfer_rejection_reason?: string | null;
  transfer_requested_at?: string | null;
  transfer_responded_at?: string | null;
  auto_assigned?: boolean | null;
  branch_assigned_at?: string | null;
  assigned_by?: string | null;
  fulfillment_type?: string;
  table_id?: string | null;
  table_number?: string | null;
  table_session_id?: string | null;
  reservation_id?: string | null;
}

type DisplayOrder = Order & {
  sittingOrderIds: string[];
  sittingCount: number;
};

interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id?: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
}

interface Driver {
  id: string;
  full_name: string;
  phone: string;
  status: string;
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  assigned: 3,
  out_for_delivery: 4,
  delivered: 5,
  cancelled: 99,
};

function sittingKey(o: Order): string | null {
  const isDineIn = o.fulfillment_type === "dine_in" || Boolean(o.table_number);
  if (!isDineIn) return null;
  if (o.table_session_id) return `session:${o.table_session_id}`;
  const table = String(o.table_number || "")
    .trim()
    .toLowerCase()
    .replace(/^table[\s._-]*/i, "");
  const phone = String(o.customer_phone || "").replace(/\D/g, "");
  const day = String(o.created_at || "").slice(0, 10);
  if (!table) return null;
  return `table:${o.restaurant_id || ""}:${table}:${phone}:${day}`;
}

function sittingStatus(list: Order[]): OrderStatus {
  const active = list.filter((o) => o.status !== "cancelled");
  if (!active.length) return "cancelled";
  return active.reduce((best, o) => ((STATUS_RANK[o.status] ?? 0) < (STATUS_RANK[best.status] ?? 0) ? o : best)).status;
}

interface Category {
  id: string;
  name: string;
}

interface MenuItemRecord {
  id: string;
  name: string;
  category_id: string | null;
}

interface Props {
  /** Filter to a specific status, or array of statuses, or 'all' */
  status?: OrderStatus | OrderStatus[] | "all";
  title: string;
  description?: string;
  icon?: ReactNode;
}

export function OrdersListView({ status = "all", title, description, icon }: Props) {
  const { t } = useTranslation(["orders", "common"]);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { restaurantId, activeRestaurant } = useActiveRestaurant();
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  const isBranch = Boolean(
    activeRestaurant?.is_branch ||
    (activeRestaurant?.parent_restaurant_id != null && activeRestaurant.parent_restaurant_id !== "")
  );

  // Raw data
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRecord[]>([]);
  const [restaurantsMap, setRestaurantsMap] = useState<Record<string, string>>({});
  const [siblingBranches, setSiblingBranches] = useState<
    { id: string; name: string; label?: string; is_hq?: boolean; is_branch?: boolean; is_active?: boolean; is_accepting_orders?: boolean; available?: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Transfer Branch Modal state (HQ Admin)
  const [transferOpen, setTransferOpen] = useState(false);
  const [orderToTransfer, setOrderToTransfer] = useState<Order | null>(null);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Reject Transfer Modal state (Branch)
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [orderToReject, setOrderToReject] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Filter States
  const [search, setSearch] = useState("");
  const [transferFilter, setTransferFilter] = useState<"all" | "transferred" | "direct">("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [syncingMarketplace, setSyncingMarketplace] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "dine_in" | "pickup">("all");
  const [sortBy, setSortBy] = useState("newest");
  const [showFilters, setShowFilters] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  const isStaffRole = role === "staff";
  const isKitchenRole = role === "kitchen" || role === "chef";
  const canCancelOrder = role === "admin" || role === "super_admin" || role === "manager";

  const isAllOrdersPage = status === "all";
  const statuses: OrderStatus[] | null =
    status === "all" ? null : Array.isArray(status) ? status : [status];

  const load = async () => {
    setLoading(true);
    if (!restaurantId) {
      setOrders([]);
      setItems([]);
      setDrivers([]);
      setCategories([]);
      setMenuItems([]);
      setSiblingBranches([]);
      setLoading(false);
      return;
    }

    // Transfer destinations: HQ + all sibling branches (dedicated API — works from branch portals too)
    let familyBranchIds: string[] = [restaurantId];
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const trRes = await fetch(`${getApiBase()}/api/restaurants/${restaurantId}/transfer-targets`, {
        headers,
      });
      const trData = await trRes.json().catch(() => ({}));
      if (trRes.ok) {
        const family = Array.isArray(trData.family) ? trData.family : [];
        const targets = Array.isArray(trData.targets) ? trData.targets : [];
        const map: Record<string, string> = {};
        for (const loc of family) {
          if (loc?.id) map[loc.id] = loc.name;
        }
        map[restaurantId] = map[restaurantId] || activeRestaurant?.name || "This location";
        setRestaurantsMap((prev) => ({ ...prev, ...map }));
        setSiblingBranches(
          targets.map((t: any) => ({
            id: t.id,
            name: t.name,
            label: t.label || t.name,
            is_hq: Boolean(t.is_main || t.is_hq),
            is_branch: Boolean(t.is_branch),
            is_active: t.is_active !== false,
            is_accepting_orders: t.is_accepting_orders !== false,
            available: t.available !== false,
          })),
        );
        familyBranchIds = [restaurantId, ...targets.map((t: any) => t.id).filter(Boolean)];
      } else {
        setSiblingBranches([]);
      }
    } catch {
      setSiblingBranches([]);
    }

    let q = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    // Own orders + inbound transfer requests pending acceptance (HQ or branch)
    q = q.or(`restaurant_id.eq.${restaurantId},pending_transfer_to_restaurant_id.eq.${restaurantId}`);

    if (statuses) q = q.in("status", statuses);

    const [o, i, d, c, m] = await Promise.all([
      q,
      supabase.from("order_items").select("*"),
      supabase.from("drivers").select("id, full_name, phone, status").in("restaurant_id", familyBranchIds).eq("is_active", true),
      supabase.from("menu_categories").select("id, name").in("restaurant_id", familyBranchIds).order("name"),
      supabase.from("menu_items").select("id, name, category_id").in("restaurant_id", familyBranchIds),
    ]);

    if (o.data) setOrders(o.data as any);
    if (i.data) setItems(i.data as any);
    if (d.data) setDrivers(d.data as any);
    if (c.data) setCategories(c.data as any);
    if (m.data) setMenuItems(m.data as any);

    setLoading(false);
  };

  const syncMarketplaceOrders = async () => {
    setSyncingMarketplace(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${getApiBase()}/api/marketplace/sync`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Marketplace sync failed");

      const platforms = Array.isArray(data.platforms) ? data.platforms : [];
      const parts = platforms.map((p: any) => {
        const name =
          p.source === "uber"
            ? "Uber"
            : p.source === "doordash"
              ? "DoorDash"
              : p.source === "deliveroo"
                ? "Deliveroo"
                : p.source === "justeat"
                  ? "Just Eat"
                  : String(p.source || "?");
        if (p.skipped) {
          if (p.reason === "disabled") return `${name}: off`;
          if (p.reason === "not_configured") return `${name}: needs credentials`;
          if (p.reason === "webhook_only") return `${name}: webhook only`;
          return `${name}: skipped`;
        }
        if (p.ok === false) return `${name}: error`;
        if (p.noStores) return `${name}: no stores`;
        return `${name}: ${p.total ?? 0}`;
      });

      toast({
        title: t("orders:syncMarketplaceOk", "Marketplace sync finished"),
        description: parts.length
          ? `${parts.join(" · ")} · ${t("orders:syncMarketplaceTotal", "{{count}} order(s)", { count: data.total ?? 0 })}`
          : t("orders:syncMarketplaceTotal", "{{count}} order(s)", { count: data.total ?? 0 }),
      });
      await load();
    } catch (err: any) {
      toast({
        title: t("common:error", "Error"),
        description: err?.message || "Marketplace sync failed",
        variant: "destructive",
      });
    } finally {
      setSyncingMarketplace(false);
    }
  };

  const handleTransferOrder = async () => {
    if (!orderToTransfer || !targetBranchId) return;
    setTransferring(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/api/orders/${orderToTransfer.id}/reassign-branch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          branch_id: targetBranchId,
          targetBranchId,
          reason: transferReason || "Transferred from branch order list (load balance)",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to transfer order");

      toast({
        title: "Transfer Request Sent",
        description: data.message || "Awaiting branch acceptance.",
      });
      setTransferOpen(false);
      setOrderToTransfer(null);
      setTargetBranchId("");
      setTransferReason("");
      void load();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Transfer Failed",
        description: err.message || "Could not reassign order",
      });
    } finally {
      setTransferring(false);
    }
  };

  const handleAcceptTransfer = async (order: Order) => {
    setActionLoading(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/api/orders/${order.id}/accept-transfer`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept order transfer");

      toast({
        title: "✅ Order Transfer Accepted",
        description: data.message || `Order ${order.order_number} is now assigned to your branch.`,
      });
      void load();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Accept Failed",
        description: err.message || "Could not accept order transfer",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectTransfer = async () => {
    if (!orderToReject) return;
    setActionLoading(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/api/orders/${orderToReject.id}/reject-transfer`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          reason: rejectReason || "Branch kitchen at full capacity",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject order transfer");

      toast({
        title: "Order Transfer Rejected",
        description: "HQ Admin has been notified of the rejection.",
      });
      setRejectModalOpen(false);
      setOrderToReject(null);
      setRejectReason("");
      void load();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Reject Failed",
        description: err.message || "Could not reject order transfer",
      });
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`orders-rt-${restaurantId}-${statuses?.join(",") ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(statuses), restaurantId]);

  const itemCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    menuItems.forEach((m) => {
      if (m.category_id) map[m.id] = m.category_id;
    });
    return map;
  }, [menuItems]);

  const updateStatus = async (id: string | string[], next: OrderStatus, extra: Record<string, any> = {}) => {
    const ids = Array.isArray(id) ? id : [id];
    const { error } = await supabase.from("orders").update({ status: next, ...extra }).in("id", ids);
    if (error) toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    else {
      toast({ title: `Order ${next.replace(/_/g, " ")}` });
      if (next === "confirmed" || next === "out_for_delivery") {
        ids.forEach((oid) => {
          supabase.functions.invoke("send-order-notification", { body: { order_id: oid } }).catch(() => {});
        });
      }
      load();
    }
  };

  const confirmOrder = (o: DisplayOrder) =>
    updateStatus(o.sittingOrderIds, "confirmed", { verified_at: new Date().toISOString() });

  const orderItems = (id: string) => items.filter((i) => i.order_id === id);

  // Filtering & Sorting
  const filtered = useMemo(() => {
    return orders
      .filter((o) => {
        const lines = items.filter((it) => it.order_id === o.id);
        const reservationOnly =
          (role === "kitchen" || role === "chef") &&
          lines.length > 0 &&
          lines.every((it) => /table\s*reserv|book\w*\s+(a\s+)?table/i.test(it.item_name || ""));
        if (reservationOnly) return false;

        // 1. Search filter
        if (search.trim()) {
          const q = search.toLowerCase();
          const matchName = o.customer_name?.toLowerCase().includes(q);
          const matchPhone = o.customer_phone?.includes(q);
          const matchNum = o.order_number?.toLowerCase().includes(q);
          const matchAddr = o.delivery_address?.toLowerCase().includes(q);
          if (!matchName && !matchPhone && !matchNum && !matchAddr) return false;
        }

        // 2. Date filter
        if (datePreset !== "all") {
          const orderDate = new Date(o.created_at);
          const now = new Date();

          if (datePreset === "today") {
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (orderDate < todayStart) return false;
          } else if (datePreset === "yesterday") {
            const yestStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            const yestEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (orderDate < yestStart || orderDate >= yestEnd) return false;
          } else if (datePreset === "last_7_days") {
            const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (orderDate < past7) return false;
          } else if (datePreset === "last_30_days") {
            const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            if (orderDate < past30) return false;
          } else if (datePreset === "this_month") {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            if (orderDate < monthStart) return false;
          } else if (datePreset === "custom") {
            if (fromDate) {
              const fromD = new Date(`${fromDate}T00:00:00`);
              if (orderDate < fromD) return false;
            }
            if (toDate) {
              const toD = new Date(`${toDate}T23:59:59.999`);
              if (orderDate > toD) return false;
            }
          }
        }

        // 3. Category Filter
        if (categoryFilter !== "all") {
          const orderItemRows = items.filter((i) => i.order_id === o.id);
          const hasCategoryItem = orderItemRows.some((oi) => {
            if (oi.menu_item_id && itemCategoryMap[oi.menu_item_id] === categoryFilter) return true;
            // Name fallback
            const mi = menuItems.find((m) => m.name.toLowerCase() === oi.item_name.toLowerCase());
            return mi?.category_id === categoryFilter;
          });
          if (!hasCategoryItem) return false;
        }

        // 4. Channel / app filter
        if (!matchesOrderChannel(sourceFilter, o.source, o.call_id)) return false;

        // 5. Payment Status
        if (paymentStatusFilter !== "all") {
          const ps = (o.payment_status || "").toLowerCase();
          if (paymentStatusFilter === "paid" && ps !== "paid") return false;
          if (paymentStatusFilter === "pending" && ps === "paid") return false;
        }

        // 6. Payment Method
        if (paymentMethodFilter !== "all") {
          const pm = (o.payment_method || "").toLowerCase();
          if (paymentMethodFilter === "cod" && !(pm.includes("cash") || pm.includes("cod"))) return false;
          if (paymentMethodFilter === "card" && !(pm.includes("card") || pm.includes("stripe"))) return false;
          if (paymentMethodFilter === "wallet" && !(pm.includes("wallet") || pm.includes("online"))) return false;
        }

        // 7. Driver Filter
        if (driverFilter !== "all") {
          if (driverFilter === "unassigned" && o.driver_id) return false;
          if (driverFilter !== "unassigned" && o.driver_id !== driverFilter) return false;
        }

        // 8. Order Status Filter (when on All Orders)
        if (isAllOrdersPage && statusFilter !== "all") {
          if (o.status !== statusFilter) return false;
        }

        // 8b. Dine-in / Takeaway
        if (fulfillmentFilter !== "all") {
          const ft = String(o.fulfillment_type || "").toLowerCase();
          const isDine = ft === "dine_in" || Boolean(o.table_number);
          if (fulfillmentFilter === "dine_in" && !isDine) return false;
          if (fulfillmentFilter === "pickup" && isDine) return false;
        }

        // 9. Transfer Filter
        if (transferFilter !== "all") {
          const isTransferred = Boolean(o.is_transferred || (o.branch_assigned_at && !o.auto_assigned));
          if (transferFilter === "transferred" && !isTransferred) return false;
          if (transferFilter === "direct" && isTransferred) return false;
        }

        // 10. Branch Location Filter
        if (branchFilter !== "all") {
          if (o.restaurant_id !== branchFilter) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "oldest") {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }
        if (sortBy === "highest_amount") {
          return Number(b.total_amount || 0) - Number(a.total_amount || 0);
        }
        if (sortBy === "lowest_amount") {
          return Number(a.total_amount || 0) - Number(b.total_amount || 0);
        }
        // default: newest
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [
    orders,
    items,
    menuItems,
    itemCategoryMap,
    search,
    role,
    datePreset,
    fromDate,
    toDate,
    categoryFilter,
    transferFilter,
    branchFilter,
    sourceFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    driverFilter,
    statusFilter,
    fulfillmentFilter,
    sortBy,
    isAllOrdersPage,
  ]);

  const displayRows = useMemo((): DisplayOrder[] => {
    const groups = new Map<string, Order[]>();
    const singles: Order[] = [];
    for (const o of filtered) {
      const key = sittingKey(o);
      if (!key) {
        singles.push(o);
        continue;
      }
      const list = groups.get(key) || [];
      list.push(o);
      groups.set(key, list);
    }

    const grouped: DisplayOrder[] = [];
    for (const list of groups.values()) {
      const chronological = [...list].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const first = chronological[0];
      grouped.push({
        ...first,
        status: sittingStatus(chronological),
        total_amount: chronological.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
        sittingOrderIds: chronological.map((row) => row.id),
        sittingCount: chronological.length,
      });
    }

    const lone: DisplayOrder[] = singles.map((o) => ({
      ...o,
      sittingOrderIds: [o.id],
      sittingCount: 1,
    }));

    const all = [...grouped, ...lone];
    const index = new Map(filtered.map((o, i) => [o.id, i]));
    all.sort((a, b) => {
      const aLatest = Math.min(...a.sittingOrderIds.map((id) => index.get(id) ?? 9999));
      const bLatest = Math.min(...b.sittingOrderIds.map((id) => index.get(id) ?? 9999));
      return aLatest - bLatest;
    });
    return all;
  }, [filtered]);

  const transferCounts = useMemo(() => {
    const transferred = orders.filter((o) => Boolean(o.is_transferred || (o.branch_assigned_at && !o.auto_assigned))).length;
    const direct = orders.length - transferred;
    return { all: orders.length, transferred, direct };
  }, [orders]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count++;
    if (transferFilter !== "all") count++;
    if (branchFilter !== "all") count++;
    if (datePreset !== "all") count++;
    if (categoryFilter !== "all") count++;
    if (sourceFilter !== "all") count++;
    if (paymentStatusFilter !== "all") count++;
    if (paymentMethodFilter !== "all") count++;
    if (driverFilter !== "all") count++;
    if (isAllOrdersPage && statusFilter !== "all") count++;
    if (fulfillmentFilter !== "all") count++;
    if (sortBy !== "newest") count++;
    return count;
  }, [
    search,
    transferFilter,
    branchFilter,
    datePreset,
    categoryFilter,
    sourceFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    driverFilter,
    statusFilter,
    fulfillmentFilter,
    sortBy,
    isAllOrdersPage,
  ]);

  const resetFilters = () => {
    setSearch("");
    setTransferFilter("all");
    setBranchFilter("all");
    setDatePreset("all");
    setFromDate("");
    setToDate("");
    setCategoryFilter("all");
    setSourceFilter("all");
    setPaymentStatusFilter("all");
    setPaymentMethodFilter("all");
    setDriverFilter("all");
    setStatusFilter("all");
    setFulfillmentFilter("all");
    setSortBy("newest");
  };

  const filteredTotalRevenue = useMemo(() => {
    return filtered.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  }, [filtered]);

  const selectedCategoryName = categories.find((c) => c.id === categoryFilter)?.name;
  const selectedDriverName = drivers.find((d) => d.id === driverFilter)?.full_name;

  return (
    <>
      <PageShell className="min-w-0 space-y-3 sm:space-y-4" maxWidth="full">
        {/* Top toolbar */}
        <header className="flex flex-col gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm sm:h-11 sm:w-11 [&>svg]:h-5 [&>svg]:w-5">
              {icon || <ClipboardList className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:text-sm">
                {description || t("orders:viewAndManage", "View and manage your restaurant orders")}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 w-full flex-col gap-2">
            <div className="relative min-w-0 w-full">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("orders:searchPlaceholder", "Search name, phone, #...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-xl border-border/80 bg-card pl-10 pr-9 shadow-xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "h-11 w-full gap-2 rounded-xl border-primary/40 bg-card px-3 text-primary shadow-xs sm:h-10 sm:w-auto sm:rounded-full sm:px-3.5",
                  (role === "kitchen" || role === "chef" || role === "receptionist") &&
                    "col-span-2",
                  showFilters && "bg-primary/5 font-semibold",
                )}
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("orders:filters", "Filters")}</span>
                {activeFiltersCount > 0 && (
                  <Badge className="h-5 shrink-0 rounded-full px-1.5 text-[10px] font-bold">
                    {activeFiltersCount}
                  </Badge>
                )}
                <ChevronDown
                  className={cn(
                    "ml-auto h-4 w-4 shrink-0 transition-transform sm:ml-0",
                    showFilters && "rotate-180",
                  )}
                />
              </Button>

              {role !== "kitchen" && role !== "chef" && role !== "receptionist" ? (
                <>
                  <div className="min-w-0 w-full sm:w-auto [&_button]:h-11 [&_button]:rounded-xl sm:[&_button]:h-10 sm:[&_button]:rounded-full">
                    <CreateManualOrderDialog onOrderCreated={() => void load()} />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="col-span-2 h-11 w-full gap-1.5 rounded-xl border-primary/40 bg-card px-3.5 text-primary shadow-xs sm:col-span-1 sm:h-10 sm:w-auto sm:rounded-full"
                    disabled={syncingMarketplace}
                    onClick={() => void syncMarketplaceOrders()}
                    title={t("orders:syncMarketplace", "Sync")}
                  >
                    {syncingMarketplace ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span>{t("orders:syncMarketplace", "Sync")}</span>
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {/* Filters card */}
        <Card className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
          <CardContent className="space-y-3 p-3 sm:space-y-4 sm:p-5">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-none">
              <Button
                type="button"
                size="sm"
                variant={transferFilter === "all" ? "default" : "outline"}
                className={cn(
                  "h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-xs font-semibold",
                  transferFilter === "all"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "border-primary/35 bg-card text-primary hover:bg-primary/5",
                )}
                onClick={() => setTransferFilter("all")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {t("orders:allOrdersTab", "All Orders")} ({transferCounts.all})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={transferFilter === "direct" ? "default" : "outline"}
                className={cn(
                  "h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-xs font-semibold",
                  transferFilter === "direct"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "border-primary/35 bg-card text-primary hover:bg-primary/5",
                )}
                onClick={() => setTransferFilter("direct")}
              >
                <Zap className="h-3.5 w-3.5" />
                {t("orders:directOrders", "Direct Orders")} ({transferCounts.direct})
              </Button>
            </div>

            {showFilters && (
              <>
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">
                  <div className="min-w-0 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("orders:category", "Category")}
                    </label>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <FilterSelectTrigger icon={Layers}>
                        <SelectValue placeholder={t("orders:allCategories", "All Categories")} />
                      </FilterSelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("orders:allCategories", "All Categories")}</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {siblingBranches.length > 1 && (
                    <div className="min-w-0 space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {t("orders:branchLocation", "Branch Location")}
                      </label>
                      <Select value={branchFilter} onValueChange={setBranchFilter}>
                        <FilterSelectTrigger icon={Building2}>
                          <SelectValue placeholder={t("orders:allBranches", "All Branches")} />
                        </FilterSelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("orders:allBranches", "All Branches")} ({siblingBranches.length})</SelectItem>
                          {siblingBranches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name} {!b.is_accepting_orders ? `(${t("orders:paused", "Paused")})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="min-w-0 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("orders:channel", "Channel")}
                    </label>
                    <Select value={sourceFilter} onValueChange={setSourceFilter}>
                      <FilterSelectTrigger icon={Share2}>
                        <SelectValue placeholder={t("orders:allChannels", "All Channels")} />
                      </FilterSelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("orders:allChannels", "All Channels")}</SelectItem>
                        {ORDER_CHANNELS.map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {t(`orders:channel_${ch}`, ORDER_CHANNEL_LABELS[ch])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("orders:orderType", "Order Type")}
                    </label>
                    <Select
                      value={fulfillmentFilter}
                      onValueChange={(v) => setFulfillmentFilter(v as "all" | "dine_in" | "pickup")}
                    >
                      <FilterSelectTrigger icon={Tag}>
                        <SelectValue placeholder={t("orders:allTypes", "All Types")} />
                      </FilterSelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("orders:allTypes", "All Types")}</SelectItem>
                        <SelectItem value="dine_in">{t("orders:dineIn", "Dine-in")}</SelectItem>
                        <SelectItem value="pickup">{t("orders:takeaway", "Takeaway")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("orders:dateRange", "Date Range")}
                    </label>
                    <Select value={datePreset} onValueChange={setDatePreset}>
                      <FilterSelectTrigger icon={Calendar}>
                        <SelectValue placeholder={t("common:selectDate", "Select date")} />
                      </FilterSelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("orders:allTime", "All Time")}</SelectItem>
                        <SelectItem value="today">{t("orders:today", "Today")}</SelectItem>
                        <SelectItem value="yesterday">{t("orders:yesterday", "Yesterday")}</SelectItem>
                        <SelectItem value="last_7_days">{t("orders:last7Days", "Last 7 Days")}</SelectItem>
                        <SelectItem value="last_30_days">{t("orders:last30Days", "Last 30 Days")}</SelectItem>
                        <SelectItem value="this_month">{t("orders:thisMonth", "This Month")}</SelectItem>
                        <SelectItem value="custom">{t("orders:customRange", "Custom Range...")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("orders:sortBy", "Sort By")}
                    </label>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <FilterSelectTrigger icon={ArrowUpDown}>
                        <SelectValue placeholder={t("orders:sortBy", "Sort by")} />
                      </FilterSelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">{t("orders:newestFirst", "Newest First")}</SelectItem>
                        <SelectItem value="oldest">{t("orders:oldestFirst", "Oldest First")}</SelectItem>
                        <SelectItem value="highest_amount">{t("orders:highestAmount", "Amount: High to Low")}</SelectItem>
                        <SelectItem value="lowest_amount">{t("orders:lowestAmount", "Amount: Low to High")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {datePreset === "custom" && (
                    <>
                      <div className="min-w-0 space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("common:startDate", "From Date")}
                        </label>
                        <Input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("common:endDate", "To Date")}
                        </label>
                        <Input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {t("orders:showingOrders", {
                          count: filtered.length,
                          total: orders.length,
                        })}
                      </span>
                      <span className="hidden sm:inline">•</span>
                      <span>
                        {t("orders:totalLabel", "Total")}:{" "}
                        <span className="font-bold text-primary">
                          {formatCurrency(filteredTotalRevenue)}
                        </span>
                      </span>
                    </div>
                    {activeFiltersCount > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {transferFilter !== "all" && (
                          <Badge
                            variant="secondary"
                            className="gap-1 border-amber-500/30 bg-amber-500/15 font-medium text-amber-700"
                          >
                            {t("orders:directOrders", "Direct Orders")}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setTransferFilter("all")}
                            />
                          </Badge>
                        )}
                        {categoryFilter !== "all" && (
                          <Badge variant="secondary" className="gap-1 font-medium">
                            {selectedCategoryName || categoryFilter}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setCategoryFilter("all")}
                            />
                          </Badge>
                        )}
                        {sourceFilter !== "all" && (
                          <Badge variant="secondary" className="gap-1 font-medium">
                            {t(
                              `orders:channel_${sourceFilter}`,
                              ORDER_CHANNEL_LABELS[
                                sourceFilter as keyof typeof ORDER_CHANNEL_LABELS
                              ] || sourceFilter,
                            )}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setSourceFilter("all")}
                            />
                          </Badge>
                        )}
                        {fulfillmentFilter !== "all" && (
                          <Badge variant="secondary" className="gap-1 font-medium">
                            {fulfillmentFilter === "dine_in"
                              ? t("orders:dineIn", "Dine-in")
                              : t("orders:takeaway", "Takeaway")}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setFulfillmentFilter("all")}
                            />
                          </Badge>
                        )}
                        {datePreset !== "all" && (
                          <Badge
                            variant="secondary"
                            className="gap-1 font-medium capitalize"
                          >
                            {datePreset.replace(/_/g, " ")}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setDatePreset("all")}
                            />
                          </Badge>
                        )}
                        {branchFilter !== "all" && (
                          <Badge variant="secondary" className="gap-1 font-medium">
                            {restaurantsMap[branchFilter] || branchFilter}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() => setBranchFilter("all")}
                            />
                          </Badge>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetFilters}
                    className="h-10 w-full gap-1.5 rounded-xl border-primary/40 px-3 text-primary hover:bg-primary/5 sm:h-9 sm:w-auto sm:rounded-full"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    {t("orders:clearFilters", "Clear Filters")}
                  </Button>
                </div>
              </>
            )}

            {!showFilters && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {t("orders:showingOrders", {
                    count: filtered.length,
                    total: orders.length,
                  })}
                </span>
                <span>
                  {t("orders:totalLabel", "Total")}:{" "}
                  <span className="font-bold text-primary">
                    {formatCurrency(filteredTotalRevenue)}
                  </span>
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Orders List Cards */}
        <div className="grid gap-3 sm:gap-4">
          {displayRows.map((o) => {
            const its = o.sittingOrderIds.flatMap((oid) => orderItems(oid));
            const driver = drivers.find((d) => d.id === o.driver_id);
            const isTransferredOrder = Boolean(o.is_transferred || (o.branch_assigned_at && !o.auto_assigned));
            const isIncomingTransferForMe = Boolean(
              o.pending_transfer_to_restaurant_id === restaurantId &&
              o.transfer_status === "pending"
            );
            const isTransferPendingOutbound = Boolean(
              o.restaurant_id === restaurantId &&
              o.transfer_status === "pending" &&
              o.pending_transfer_to_restaurant_id &&
              o.pending_transfer_to_restaurant_id !== restaurantId
            );
            const isTransferRejected = Boolean(
              o.transfer_status === "rejected" && o.restaurant_id === restaurantId
            );
            const fromLocationName =
              (o.transferred_from_restaurant_id && restaurantsMap[o.transferred_from_restaurant_id]) ||
              t("orders:anotherLocation", "another location");

            return (
              <Card key={o.id} className={cn(
                "overflow-hidden rounded-2xl border border-border/80 shadow-xs transition-all hover:border-primary/50",
                isIncomingTransferForMe && "border-amber-500 bg-amber-500/[0.03] ring-2 ring-amber-500/20",
                isTransferRejected && "border-destructive/40 bg-destructive/[0.02]",
                isTransferredOrder && !isIncomingTransferForMe && "border-primary/30 bg-primary/[0.01]"
              )}>
                <CardContent className="p-3.5 sm:p-5">
                  {/* Incoming Transfer Banner (HQ or any branch) */}
                  {isIncomingTransferForMe && (
                    <div className="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-primary/10 to-amber-500/5 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                          <ArrowRightLeft className="h-4 w-4 animate-pulse" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground">
                              {t("orders:incomingTransferRequest", "🚨 Incoming transfer from {{from}}", { from: fromLocationName })}
                            </span>
                            <Badge variant="outline" className="text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                              {t("orders:actionRequired", "Action Required")}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {o.transfer_reason
                              ? `${t("orders:reason", "Reason")}: "${o.transfer_reason}"`
                              : t("orders:transferPromptGeneric", "Another location requested to transfer this order to you. Accept or reject.")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 shadow-sm text-xs h-8"
                          onClick={() => handleAcceptTransfer(o)}
                          disabled={actionLoading}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("orders:acceptOrder", "Accept Order")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="font-bold gap-1.5 text-xs h-8"
                          onClick={() => {
                            setOrderToReject(o);
                            setRejectReason("");
                            setRejectModalOpen(true);
                          }}
                          disabled={actionLoading}
                        >
                          <XCircle className="h-3.5 w-3.5" /> {t("orders:reject", "Reject")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Transfer rejected — sender can reassign */}
                  {isTransferRejected && (
                    <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                        <span className="text-xs font-semibold text-destructive">
                          {t("orders:transferRejected", "Transfer was rejected:")} {o.transfer_rejection_reason || t("orders:branchUnableToFulfill", "Location unable to fulfill this order.")}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-semibold border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5 shrink-0 h-7"
                        onClick={() => {
                          setOrderToTransfer(o);
                          setTargetBranchId("");
                          setTransferReason("");
                          setTransferOpen(true);
                        }}
                      >
                        <RotateCcw className="h-3 w-3" /> {t("orders:reassignToAnother", "Transfer to another location")}
                      </Button>
                    </div>
                  )}

                  {(() => {
                    const parseItemLabel = (item: (typeof its)[number]) => {
                      const sizeMatch = item.item_name.match(/\(([^)]+)\)/);
                      const addMatch = item.item_name.includes("+")
                        ? item.item_name.split("+")[1]
                        : null;
                      let baseName = item.item_name;
                      if (sizeMatch) baseName = baseName.replace(sizeMatch[0], "").trim();
                      if (addMatch) baseName = baseName.split("+")[0].trim();
                      return { baseName, sizeMatch, addMatch };
                    };

                    const actionButtons = (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                          onClick={() => navigate(`/orders/${o.id}`)}
                        >
                          {t("orders:viewDetails", "View Details")}
                        </Button>
                        {isStaffRole &&
                          o.status !== "delivered" &&
                          o.status !== "cancelled" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-w-[5.5rem] flex-1 gap-1.5 text-xs font-semibold md:flex-none"
                              onClick={() => navigate(`/dashboard?add_to=${o.id}`)}
                            >
                              <UtensilsCrossed className="h-3.5 w-3.5" />
                              {t("orders:addItems", "Add Items")}
                            </Button>
                          )}
                        {!isStaffRole &&
                          !isKitchenRole &&
                          o.status === "pending" &&
                          siblingBranches.some((b) => b.id !== o.restaurant_id) &&
                          !(
                            o.transfer_status === "pending" &&
                            o.pending_transfer_to_restaurant_id
                          ) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-w-[5.5rem] flex-1 gap-1.5 border-primary/25 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/15 md:flex-none"
                              onClick={() => {
                                setOrderToTransfer(o);
                                setTargetBranchId("");
                                setTransferReason("");
                                setTransferOpen(true);
                              }}
                              title="Transfer this order to another available location (before confirm only)"
                            >
                              <Building2 className="h-3.5 w-3.5" />
                              <span>{t("orders:transfer", "Transfer")}</span>
                            </Button>
                          )}
                        {!isStaffRole && o.status === "pending" && (
                          <Button
                            size="sm"
                            className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                            onClick={() => confirmOrder(o)}
                          >
                            {t("orders:confirm", "Confirm")}
                          </Button>
                        )}
                        {!isStaffRole && o.status === "confirmed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                            onClick={() =>
                              updateStatus(o.sittingOrderIds, "preparing")
                            }
                          >
                            {t("orders:startPrep", "Start prep")}
                          </Button>
                        )}
                        {(isKitchenRole || (!isStaffRole && !isKitchenRole)) &&
                          o.status === "preparing" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                              onClick={() =>
                                updateStatus(o.sittingOrderIds, "ready")
                              }
                            >
                              {t("orders:ready", "Ready")}
                            </Button>
                          )}
                        {(isStaffRole || (!isKitchenRole && !isStaffRole)) &&
                          o.status === "ready" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                              onClick={() =>
                                updateStatus(o.sittingOrderIds, "out_for_delivery")
                              }
                            >
                              {o.fulfillment_type === "dine_in"
                                ? t("orders:served", "Served")
                                : t("orders:outForDelivery", "Out for delivery")}
                            </Button>
                          )}
                        {(isStaffRole || (!isKitchenRole && !isStaffRole)) &&
                          o.status === "out_for_delivery" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-w-[5.5rem] flex-1 md:flex-none"
                              onClick={() =>
                                updateStatus(o.sittingOrderIds, "delivered", {
                                  delivered_at: new Date().toISOString(),
                                })
                              }
                            >
                              {o.fulfillment_type === "dine_in"
                                ? t("orders:completed", "Completed")
                                : t("orders:delivered", "Delivered")}
                            </Button>
                          )}
                        {canCancelOrder &&
                          o.status !== "cancelled" &&
                          o.status !== "delivered" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 min-w-[5.5rem] flex-1 text-destructive md:flex-none"
                              onClick={() => {
                                if (
                                  confirm(
                                    t("orders:cancelOrder", "Cancel order?"),
                                  )
                                ) {
                                  updateStatus(o.sittingOrderIds, "cancelled");
                                }
                              }}
                            >
                              {t("orders:cancel", "Cancel")}
                            </Button>
                          )}
                      </>
                    );

                    const customerBlock = (
                      <div className="min-w-0 space-y-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-base font-bold tracking-tight text-foreground md:text-lg">
                            {o.order_number}
                          </span>
                          {(() => {
                            const channel = orderChannel(o.source, o.call_id);
                            if (channel) {
                              return (
                                <Badge
                                  variant="outline"
                                  className="border-sky-500/30 bg-sky-500/10 text-xs font-semibold text-sky-800 dark:text-sky-200"
                                >
                                  {t(
                                    `orders:channel_${channel}`,
                                    ORDER_CHANNEL_LABELS[channel],
                                  )}
                                </Badge>
                              );
                            }
                            const taker = orderTakerLabel(o.source, o.call_id);
                            if (!taker) return null;
                            return (
                              <Badge
                                variant="outline"
                                className="flex items-center gap-1 border-primary/25 bg-primary/10 text-xs font-semibold text-primary"
                              >
                                {taker === "Agent" ? (
                                  <Phone className="h-3 w-3 text-primary" />
                                ) : (
                                  <User className="h-3 w-3 text-primary" />
                                )}
                                <span>{taker}</span>
                              </Badge>
                            );
                          })()}
                          {isTransferPendingOutbound && (
                            <Badge
                              variant="outline"
                              className="flex items-center gap-1 border-amber-500/40 bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400"
                            >
                              <Clock className="h-3 w-3 animate-spin" />
                              <span>
                                {t(
                                  "orders:pendingAcceptance",
                                  "Pending Acceptance",
                                )}{" "}
                                (
                                {restaurantsMap[
                                  o.pending_transfer_to_restaurant_id!
                                ] || t("orders:branch", "Branch")}
                                )
                              </span>
                            </Badge>
                          )}
                          {isTransferredOrder && (
                            <Badge
                              variant="outline"
                              className="flex max-w-full items-center gap-1 border-primary/30 bg-primary/15 text-xs font-bold text-primary"
                            >
                              <ArrowRightLeft className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {o.transferred_from_restaurant_id &&
                                restaurantsMap[o.transferred_from_restaurant_id]
                                  ? t(
                                      "orders:transferredFromShort",
                                      "From {{name}}",
                                      {
                                        name: restaurantsMap[
                                          o.transferred_from_restaurant_id
                                        ],
                                      },
                                    )
                                  : t("orders:transferred", "Transferred")}
                              </span>
                            </Badge>
                          )}
                          {o.fulfillment_type === "dine_in" && (
                            <Badge
                              variant="outline"
                              className="flex items-center gap-1 border-purple-500/30 bg-purple-500/15 text-xs font-bold text-purple-700 dark:text-purple-300"
                            >
                              <UtensilsCrossed className="h-3 w-3" />
                              <span>
                                Dine-In
                                {o.table_number
                                  ? ` · Table ${o.table_number}`
                                  : ""}
                              </span>
                            </Badge>
                          )}
                          {o.sittingCount > 1 && (
                            <Badge
                              variant="outline"
                              className="border-amber-500/30 bg-amber-500/15 text-xs font-bold text-amber-800 dark:text-amber-300"
                            >
                              {o.sittingCount} orders
                            </Badge>
                          )}
                          <Badge
                            className={cn(
                              "px-2.5 py-0.5 text-xs font-semibold",
                              ORDER_STATUS_COLORS[o.status],
                            )}
                            variant="outline"
                          >
                            {o.fulfillment_type === "dine_in" &&
                            o.status === "out_for_delivery"
                              ? "🍽️ Served"
                              : getOrderStatusLabel(o.status)}
                          </Badge>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground md:text-base">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {(o.customer_name || "G").charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate">
                              {o.customer_name ||
                                t("orders:guestCustomer", "Guest Customer")}
                            </span>
                          </div>
                          {o.customer_phone ? (
                            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                              <Phone className="h-3 w-3 shrink-0 text-primary" />
                              <span className="truncate">{o.customer_phone}</span>
                            </div>
                          ) : null}
                        </div>

                        {o.delivery_address ? (
                          <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                            <span className="line-clamp-2 break-words">
                              {o.delivery_address}
                            </span>
                          </div>
                        ) : null}

                        {driver ? (
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <Truck className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {t("orders:driverLabel", "Driver:")}{" "}
                              <strong className="font-semibold">
                                {driver.full_name}
                              </strong>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );

                    const itemsChips = (
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {t("orders:orderItems", "Order Items")} ({its.length})
                          </span>
                        </div>
                        <div className="custom-scrollbar flex max-h-28 flex-wrap content-start items-center gap-2 overflow-y-auto pr-1">
                          {its.length > 0 ? (
                            its.map((item) => {
                              const { baseName, sizeMatch, addMatch } =
                                parseItemLabel(item);
                              return (
                                <div
                                  key={item.id}
                                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-muted/60 px-2.5 py-1 text-xs font-semibold text-foreground shadow-2xs"
                                  title={item.item_name}
                                >
                                  <span className="inline-flex shrink-0 items-center justify-center rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                                    {item.quantity}×
                                  </span>
                                  <span className="truncate">{baseName}</span>
                                  {sizeMatch ? (
                                    <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1 text-[10px] font-bold text-primary">
                                      {sizeMatch[1]}
                                    </span>
                                  ) : null}
                                  {addMatch ? (
                                    <span className="max-w-[7rem] truncate rounded border border-amber-500/20 bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                      +{addMatch.trim()}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })
                          ) : (
                            <span className="rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1 text-xs italic text-muted-foreground">
                              {t("orders:noNotes", "No items recorded")}
                            </span>
                          )}
                        </div>
                      </div>
                    );

                    const priceBlock = (
                      <div className="text-left md:text-right">
                        <span className="block text-xl font-bold tracking-tight text-foreground md:text-2xl">
                          {formatCurrency(o.total_amount)}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground md:justify-end">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {formatDate(o.created_at)} {formatTime(o.created_at)}
                          </span>
                        </span>
                      </div>
                    );

                    return (
                      <>
                        {/* Mobile: stacked */}
                        <div className="space-y-3 md:hidden">
                          {customerBlock}
                          <div className="rounded-xl border border-border/60 bg-muted/15 p-2.5">
                            {itemsChips}
                          </div>
                          <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
                            {priceBlock}
                            <div className="flex w-full flex-wrap gap-2">
                              {actionButtons}
                            </div>
                          </div>
                        </div>

                        {/* Tablet / Laptop / Laptop-L: 3-column horizontal */}
                        <div className="hidden md:flex md:items-center md:justify-between md:gap-4 lg:gap-6">
                          <div className="w-[240px] shrink-0 lg:w-[280px] xl:w-80">
                            {customerBlock}
                          </div>

                          <div className="min-w-0 flex-1 border-l border-r border-border/50 px-4 py-1 lg:px-6">
                            {itemsChips}
                          </div>

                          <div className="flex w-[200px] shrink-0 flex-col items-end gap-3 lg:w-[220px]">
                            {priceBlock}
                            <div className="flex flex-wrap justify-end gap-2">
                              {actionButtons}
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}

          {displayRows.length === 0 && !loading && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground space-y-3">
                <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground/50" />
                <div>
                  <p className="font-semibold text-foreground text-base">{t("orders:noMatchingOrders", "No matching orders found")}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {sourceFilter === "uber"
                      ? t("orders:emptyUber", "No Uber Eats orders in the database. Uber has not linked a store to this app yet.")
                      : sourceFilter === "doordash"
                        ? t("orders:emptyDoordash", "No DoorDash orders yet. Marketplace credentials and Orders webhook are required.")
                        : sourceFilter === "deliveroo"
                          ? t("orders:emptyDeliveroo", "No Deliveroo orders yet. Partner API access is still required.")
                          : sourceFilter === "justeat"
                            ? t("orders:emptyJusteat", "No Just Eat orders yet. Partner API access is still required.")
                            : activeFiltersCount > 0
                              ? t("orders:tryChangingFilters", "Try changing your search query or resetting filters.")
                              : t("orders:noOrdersAvailable", "No orders are currently available in this view.")}
                  </p>
                </div>
                {activeFiltersCount > 0 && (
                  <Button variant="outline" size="sm" onClick={resetFilters} className="gap-1.5 mt-2">
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("orders:resetAllFilters", "Reset all filters")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncingMarketplace}
                  onClick={() => void syncMarketplaceOrders()}
                  className="gap-1.5 mt-2"
                >
                  {syncingMarketplace ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {t("orders:syncMarketplace", "Sync")}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </PageShell>

      {/* Transfer order to HQ or another branch */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> {t("orders:transferOrderTitle", "Transfer Order")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("orders:transferDesc", {
                number: orderToTransfer?.order_number,
                defaultValue: `Send order ${orderToTransfer?.order_number} to another available location. Only unconfirmed orders can be transferred.`,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-xs flex items-center justify-between">
              <span className="text-muted-foreground font-medium">{t("orders:currentlyAssignedTo", "Currently Assigned To:")}</span>
              <span className="font-bold text-foreground">
                {orderToTransfer ? restaurantsMap[orderToTransfer.restaurant_id] || t("orders:branch", "Branch") : "—"}
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">{t("orders:selectDestination", "Available destinations")}</Label>
              <Select value={targetBranchId} onValueChange={setTargetBranchId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder={t("orders:chooseDestination", "Choose destination...")} />
                </SelectTrigger>
                <SelectContent>
                  {siblingBranches
                    .filter((b) => b.id !== orderToTransfer?.restaurant_id)
                    .map((b) => {
                      const isPaused = b.is_accepting_orders === false || b.is_active === false || b.available === false;
                      return (
                        <SelectItem
                          key={b.id}
                          value={b.id}
                          disabled={isPaused}
                          className={isPaused ? "opacity-60 text-muted-foreground" : ""}
                        >
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span>{b.label || b.name}</span>
                            {isPaused && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                {t("orders:pausedNotAccepting", "Paused")}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              {siblingBranches.filter((b) => b.id !== orderToTransfer?.restaurant_id).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("orders:noTransferTargets", "No other locations available in this restaurant family.")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">{t("orders:transferReasonOptional", "Transfer Reason / Note (Optional)")}</Label>
              <Input
                placeholder={t("orders:transferReasonPlaceholder", "e.g. Kitchen rush, customer closer to this branch")}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(false)} disabled={transferring}>
              {t("common:cancel", "Cancel")}
            </Button>
            <Button
              size="sm"
              className="font-semibold bg-primary text-primary-foreground"
              disabled={
                !targetBranchId ||
                targetBranchId === (orderToTransfer?.restaurant_id || restaurantId) ||
                siblingBranches.find((b) => b.id === targetBranchId)?.is_accepting_orders === false ||
                siblingBranches.find((b) => b.id === targetBranchId)?.is_active === false ||
                transferring
              }
              onClick={handleTransferOrder}
            >
              {transferring ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Building2 className="h-4 w-4 mr-1.5" />}
              {t("orders:sendTransfer", "Send Transfer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Order Transfer Modal (Branch) */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> {t("orders:rejectOrderTransfer", "Reject Order Transfer")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("orders:rejectTransferDesc", { number: orderToReject?.order_number, defaultValue: `Decline transfer for order ${orderToReject?.order_number}. HQ Admin will be notified so they can transfer to another branch.` })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">{t("orders:reasonForRejection", "Reason for Rejection")}</Label>
              <Input
                placeholder={t("orders:rejectReasonPlaceholder", "e.g. Kitchen overloaded, missing critical ingredients, power issue")}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                { label: t("orders:kitchenAtFullCapacity", "Kitchen at full capacity"), val: "Kitchen at full capacity" },
                { label: t("orders:itemOutOfStock", "Item out of stock"), val: "Item out of stock" },
                { label: t("orders:outsideDeliveryCoverage", "Outside our delivery coverage"), val: "Outside our delivery coverage" },
                { label: t("orders:staffShortage", "Staff shortage"), val: "Staff shortage" },
              ].map((qr) => (
                <button
                  key={qr.val}
                  type="button"
                  onClick={() => setRejectReason(qr.label)}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80 border border-border text-foreground font-medium transition-colors"
                >
                  {qr.label}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejectModalOpen(false)} disabled={actionLoading}>
              {t("common:cancel", "Cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="font-bold gap-1.5"
              disabled={actionLoading}
              onClick={handleRejectTransfer}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
              {t("orders:confirmRejection", "Confirm Rejection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}