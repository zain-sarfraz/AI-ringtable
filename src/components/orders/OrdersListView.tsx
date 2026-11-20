import { useEffect, useState, useMemo } from "react";
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
} from "lucide-react";
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
  icon?: React.ReactNode;
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
  const [siblingBranches, setSiblingBranches] = useState<{ id: string; name: string; is_active?: boolean; is_accepting_orders?: boolean }[]>([]);
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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const isStaffRole = role === "staff";
  const isKitchenRole = role === "kitchen" || role === "chef";

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

    // 1. Fetch all restaurants in system to resolve restaurant family and map
    const allRestsRes = await supabase
      .from("restaurants")
      .select("id, name, parent_restaurant_id, is_branch, is_active, is_accepting_orders")
      .limit(200);

    let familyBranchIds: string[] = [restaurantId];

    if (allRestsRes.data) {
      const allR = allRestsRes.data as { id: string; name: string; parent_restaurant_id?: string | null; is_branch?: boolean; is_active?: boolean; is_accepting_orders?: boolean }[];
      const map: Record<string, string> = {};
      allR.forEach((res) => {
        map[res.id] = res.name;
      });
      setRestaurantsMap(map);

      // Find all sibling branches under same parent restaurant family
      const currentRest = allR.find((r) => r.id === restaurantId);
      if (currentRest) {
        const rootId = currentRest.parent_restaurant_id || currentRest.id;

        // If current is branch -> only include this branch in familyBranchIds
        if (isBranch) {
          familyBranchIds = [restaurantId];
        } else {
          // Parent Admin -> include parent + all branches
          const allFamily = allR.filter((r) => r.id === rootId || r.parent_restaurant_id === rootId);
          familyBranchIds = allFamily.map((s) => s.id);
        }

        // Only include actual operational branches (exclude the parent restaurant admin itself)
        const actualBranches = allR.filter(
          (r) => (r.is_branch || r.parent_restaurant_id != null) && r.parent_restaurant_id === rootId && r.is_active !== false
        );
        setSiblingBranches(
          actualBranches.map((s) => ({
            id: s.id,
            name: s.name,
            is_active: s.is_active ?? true,
            is_accepting_orders: s.is_accepting_orders ?? true,
          }))
        );
      }
    }

    let q = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (isBranch) {
      q = q.or(`restaurant_id.eq.${restaurantId},pending_transfer_to_restaurant_id.eq.${restaurantId}`);
    } else {
      q = q.in("restaurant_id", familyBranchIds);
    }

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
      <PageShell className="space-y-5">
        {/* Header Title and Search Bar */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl flex items-center gap-2">
                {icon}
                {title}
              </h1>
              {role === "kitchen" || role === "chef" ? (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-300 gap-1 text-xs font-semibold py-0.5">
                  <ChefHat className="h-3 w-3" /> Kitchen Display
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1 text-xs font-medium py-0.5 bg-muted/30">
                  <ChefHat className="h-3 w-3 text-primary" /> Fulfillments routed to Kitchen Staff
                </Badge>
              )}
            </div>
            {description && (
              <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</p>
            )}
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("orders:searchPlaceholder", "Search name, phone, #...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-8 h-10 rounded-lg"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Button
              variant={showAdvancedFilters || activeFiltersCount > 0 ? "secondary" : "outline"}
              onClick={() => setShowAdvancedFilters((v) => !v)}
              className={cn(
                "h-10 w-full rounded-lg gap-2 border-border/80 sm:w-auto",
                activeFiltersCount > 0 && "border-primary/40 text-primary font-semibold"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>{t("orders:filters", "Filters")}</span>
              {activeFiltersCount > 0 && (
                <Badge variant="default" className="h-5 px-1.5 text-xs font-bold rounded-full ml-0.5">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>

            {activeFiltersCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-10 text-muted-foreground hover:text-foreground gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("common:reset", "Reset")}
              </Button>
            )}

            {role !== "kitchen" && role !== "chef" && role !== "receptionist" && (
              <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:min-w-[9.5rem]">
                <CreateManualOrderDialog onOrderCreated={() => void load()} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full rounded-lg gap-1.5 sm:w-auto"
                  disabled={syncingMarketplace}
                  onClick={() => void syncMarketplaceOrders()}
                >
                  {syncingMarketplace ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {t("orders:syncMarketplace", "Sync")}
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Quick Transfer Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={transferFilter === "all" ? "default" : "outline"}
            className={cn(
              "h-8 text-xs font-semibold rounded-lg",
              transferFilter === "all" && "bg-primary text-primary-foreground font-bold shadow-xs"
            )}
            onClick={() => setTransferFilter("all")}
          >
            {t("orders:allOrdersTab", "All Orders")} ({transferCounts.all})
          </Button>
          <Button
            size="sm"
            variant={transferFilter === "direct" ? "default" : "outline"}
            className={cn(
              "h-8 text-xs font-semibold rounded-lg",
              transferFilter === "direct" && "bg-primary text-primary-foreground font-bold shadow-xs"
            )}
            onClick={() => setTransferFilter("direct")}
          >
            {t("orders:directOrders", "Direct Orders")} ({transferCounts.direct})
          </Button>
        </div>

        {/* Primary Filter Bar */}
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <CardContent className="p-4 space-y-4">
            <div className={cn(
              "grid grid-cols-1 gap-3",
              siblingBranches.length > 1 ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4"
            )}>
              {/* 1. Food Category Filter (Most Left) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                  {t("orders:category", "Category")}
                </label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-9.5">
                    <SelectValue placeholder={t("orders:allCategories", "All Categories")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("orders:allCategories", "All Categories")}</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Branch Filter (when multiple sibling branches exist) */}
              {siblingBranches.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                    {t("orders:branchLocation", "Branch Location")}
                  </label>
                  <Select value={branchFilter} onValueChange={setBranchFilter}>
                    <SelectTrigger className="h-9.5">
                      <SelectValue placeholder={t("orders:allBranches", "All Branches")} />
                    </SelectTrigger>
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

              {/* Channel / app filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                  {t("orders:channel", "Channel")}
                </label>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="h-9.5">
                    <SelectValue placeholder={t("orders:allChannels", "All Channels")} />
                  </SelectTrigger>
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

              {/* Order type: Dine-in / Takeaway */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                  {t("orders:orderType", "Order Type")}
                </label>
                <Select
                  value={fulfillmentFilter}
                  onValueChange={(v) => setFulfillmentFilter(v as "all" | "dine_in" | "pickup")}
                >
                  <SelectTrigger className="h-9.5">
                    <SelectValue placeholder={t("orders:allTypes", "All Types")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("orders:allTypes", "All Types")}</SelectItem>
                    <SelectItem value="dine_in">{t("orders:dineIn", "Dine-in")}</SelectItem>
                    <SelectItem value="pickup">{t("orders:takeaway", "Takeaway")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 3. Date Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                  {t("orders:dateRange", "Date Range")}
                </label>
                <Select value={datePreset} onValueChange={setDatePreset}>
                  <SelectTrigger className="h-9.5">
                    <SelectValue placeholder={t("common:selectDate", "Select date")} />
                  </SelectTrigger>
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

              {/* 4. Sort By */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                  {t("orders:sortBy", "Sort By")}
                </label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-9.5">
                    <SelectValue placeholder={t("orders:sortBy", "Sort by")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("orders:newestFirst", "Newest First")}</SelectItem>
                    <SelectItem value="oldest">{t("orders:oldestFirst", "Oldest First")}</SelectItem>
                    <SelectItem value="highest_amount">{t("orders:highestAmount", "Amount: High to Low")}</SelectItem>
                    <SelectItem value="lowest_amount">{t("orders:lowestAmount", "Amount: Low to High")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Custom Date Pickers (when custom range is selected) */}
            {datePreset === "custom" && (
              <div className="pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{t("common:startDate", "From Date")}</label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{t("common:endDate", "To Date")}</label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            {/* Advanced / Secondary Filters Row */}
            {showAdvancedFilters && (
              <div className="pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
                {/* 5. Order Status (for all orders view) */}
                {isAllOrdersPage && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                      {t("common:status", "Order Status")}
                    </label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-9.5">
                        <SelectValue placeholder={t("orders:filterByStatus", "All Statuses")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("orders:all", "All Statuses")}</SelectItem>
                        <SelectItem value="pending">{t("orders:newOrders", "New / Pending")}</SelectItem>
                        <SelectItem value="confirmed">{t("orders:confirmed", "Confirmed")}</SelectItem>
                        <SelectItem value="preparing">{t("orders:preparing", "Preparing")}</SelectItem>
                        <SelectItem value="ready">{t("orders:ready", "Ready")}</SelectItem>
                        <SelectItem value="out_for_delivery">{t("orders:outForDelivery", "Out for Delivery")}</SelectItem>
                        <SelectItem value="delivered">{t("orders:delivered", "Delivered")}</SelectItem>
                        <SelectItem value="cancelled">{t("orders:cancelled", "Cancelled")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 8. Driver Filter */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block leading-5">
                    {t("drivers:title", "Rider / Driver")}
                  </label>
                  <Select value={driverFilter} onValueChange={setDriverFilter}>
                    <SelectTrigger className="h-9.5">
                      <SelectValue placeholder={t("orders:selectDriver", "All Drivers")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common:all", "All Drivers")}</SelectItem>
                      <SelectItem value="unassigned">{t("orders:noDriverAssigned", "Unassigned Only")}</SelectItem>
                      {drivers.map((drv) => (
                        <SelectItem key={drv.id} value={drv.id}>
                          {drv.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Filter Summary & Active Badges Bar */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">
                  {t("orders:showingOrders", { count: filtered.length, total: orders.length })}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="font-bold text-foreground">
                  {t("orders:totalLabel", "Total")}: {formatCurrency(filteredTotalRevenue)}
                </span>

                {/* Active Filter Chips */}
                {transferFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                    <ArrowRightLeft className="h-3 w-3" />
                    {t("orders:type", "Type")}: {transferFilter === "transferred" ? t("orders:transferredOrders", "Transferred Orders") : t("orders:directOrders", "Direct Orders")}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setTransferFilter("all")} />
                  </Badge>
                )}
                {branchFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium bg-primary/10 text-primary border-primary/25">
                    <Building2 className="h-3 w-3" />
                    {t("orders:branch", "Branch")}: {restaurantsMap[branchFilter] || branchFilter}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setBranchFilter("all")} />
                  </Badge>
                )}
                {categoryFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium">
                    {t("orders:category", "Category")}: {selectedCategoryName || categoryFilter}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setCategoryFilter("all")} />
                  </Badge>
                )}
                {datePreset !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium capitalize">
                    {t("orders:dateRange", "Date")}: {datePreset.replace(/_/g, " ")}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setDatePreset("all")} />
                  </Badge>
                )}
                {sourceFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium">
                    {t("orders:channel", "Channel")}:{" "}
                    {t(`orders:channel_${sourceFilter}`, ORDER_CHANNEL_LABELS[sourceFilter as keyof typeof ORDER_CHANNEL_LABELS] || sourceFilter)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setSourceFilter("all")} />
                  </Badge>
                )}
                {paymentStatusFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium capitalize">
                    {t("orders:paymentStatus", "Payment")}: {paymentStatusFilter}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setPaymentStatusFilter("all")} />
                  </Badge>
                )}
                {driverFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium">
                    {t("drivers:driver", "Driver")}: {selectedDriverName || (driverFilter === "unassigned" ? t("orders:noDriverAssigned", "Unassigned") : driverFilter)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setDriverFilter("all")} />
                  </Badge>
                )}
                {statusFilter !== "all" && (
                  <Badge variant="secondary" className="gap-1 font-medium capitalize">
                    {t("common:status", "Status")}: {getOrderStatusLabel(statusFilter as OrderStatus)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setStatusFilter("all")} />
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Orders List Cards */}
        <div className="grid gap-4">
          {displayRows.map((o) => {
            const its = o.sittingOrderIds.flatMap((oid) => orderItems(oid));
            const driver = drivers.find((d) => d.id === o.driver_id);
            const isTransferredOrder = Boolean(o.is_transferred || (o.branch_assigned_at && !o.auto_assigned));
            const isIncomingTransferForMe = Boolean(
              isBranch &&
              o.pending_transfer_to_restaurant_id === restaurantId &&
              o.transfer_status === "pending"
            );
            const isTransferPendingForAdmin = Boolean(
              !isBranch &&
              o.transfer_status === "pending" &&
              o.pending_transfer_to_restaurant_id
            );
            const isTransferRejected = Boolean(
              o.transfer_status === "rejected"
            );

            return (
              <Card key={o.id} className={cn(
                "overflow-hidden rounded-2xl border border-border/80 shadow-xs hover:border-primary/50 transition-all",
                isIncomingTransferForMe && "border-amber-500 ring-2 ring-amber-500/20 bg-amber-500/[0.03]",
                isTransferRejected && "border-destructive/40 bg-destructive/[0.02]",
                isTransferredOrder && !isIncomingTransferForMe && "border-primary/30 bg-primary/[0.01]"
              )}>
                <CardContent className="p-5">
                  {/* Branch Incoming Transfer Banner */}
                  {isIncomingTransferForMe && (
                    <div className="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-primary/10 to-amber-500/5 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                          <ArrowRightLeft className="h-4 w-4 animate-pulse" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground">{t("orders:transferRequestFromHq", "🚨 Transfer Request from HQ Admin")}</span>
                            <Badge variant="outline" className="text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                              {t("orders:actionRequired", "Action Required")}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {o.transfer_reason ? `${t("orders:reason", "Reason")}: "${o.transfer_reason}"` : t("orders:hqTransferPrompt", "HQ Admin has requested to transfer this order to your branch for fulfillment.")}
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

                  {/* HQ Admin Transfer Rejected Banner */}
                  {!isBranch && isTransferRejected && (
                    <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                        <span className="text-xs font-semibold text-destructive">
                          {t("orders:transferRejected", "Transfer was rejected:")} {o.transfer_rejection_reason || t("orders:branchUnableToFulfill", "Branch unable to fulfill this order.")}
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
                        <RotateCcw className="h-3 w-3" /> {t("orders:reassignToAnotherBranch", "Reassign to Another Branch")}
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left Column: Order Number, Customer, Address & Driver */}
                    <div className="space-y-2.5 w-full lg:w-72 xl:w-80 shrink-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold font-mono text-foreground tracking-tight">
                          {o.order_number}
                        </span>

                        {(() => {
                          const channel = orderChannel(o.source, o.call_id);
                          if (channel) {
                            return (
                              <Badge variant="outline" className="bg-sky-500/10 text-sky-800 dark:text-sky-200 border-sky-500/30 text-xs font-semibold">
                                {t(`orders:channel_${channel}`, ORDER_CHANNEL_LABELS[channel])}
                              </Badge>
                            );
                          }
                          const taker = orderTakerLabel(o.source, o.call_id);
                          if (!taker) return null;
                          return (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25 text-xs font-semibold flex items-center gap-1">
                              {taker === "Agent" ? (
                                <Phone className="h-3 w-3 text-primary" />
                              ) : (
                                <User className="h-3 w-3 text-primary" />
                              )}
                              <span>{taker}</span>
                            </Badge>
                          );
                        })()}

                        {isTransferPendingForAdmin && (
                          <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 text-xs font-bold flex items-center gap-1">
                            <Clock className="h-3 w-3 animate-spin" />
                            <span>{t("orders:pendingAcceptance", "Pending Acceptance")} ({restaurantsMap[o.pending_transfer_to_restaurant_id!] || t("orders:branch", "Branch")})</span>
                          </Badge>
                        )}

                        {isTransferredOrder && (
                          <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 text-xs font-bold flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" />
                            <span>{t("orders:transferred", "Transferred")}</span>
                          </Badge>
                        )}

                        {o.fulfillment_type === "dine_in" && (
                          <Badge variant="outline" className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-xs font-bold flex items-center gap-1">
                            <UtensilsCrossed className="h-3 w-3" />
                            <span>Dine-In{o.table_number ? ` · Table ${o.table_number}` : ""}</span>
                          </Badge>
                        )}
                        {o.sittingCount > 1 && (
                          <Badge variant="outline" className="bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 text-xs font-bold">
                            {o.sittingCount} orders
                          </Badge>
                        )}

                        <Badge
                          className={cn("text-xs font-semibold px-2.5 py-0.5", ORDER_STATUS_COLORS[o.status])}
                          variant="outline"
                        >
                          {o.fulfillment_type === "dine_in" && o.status === "out_for_delivery"
                            ? "🍽️ Served"
                            : getOrderStatusLabel(o.status)}
                        </Badge>
                      </div>

                      {/* Customer info + Phone */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 font-semibold text-sm sm:text-base text-foreground">
                          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                            {(o.customer_name || "G").charAt(0).toUpperCase()}
                          </div>
                          <span className="truncate max-w-[150px]">{o.customer_name || t("orders:guestCustomer", "Guest Customer")}</span>
                        </div>

                        {o.customer_phone && (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 bg-muted/60 px-2 py-0.5 rounded-md border border-border/70">
                            <Phone className="h-3 w-3 text-primary shrink-0" />
                            <span>{o.customer_phone}</span>
                          </div>
                        )}
                      </div>

                      {o.delivery_address && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
                          <span className="truncate">{o.delivery_address}</span>
                        </div>
                      )}

                      {driver && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-xs font-medium">
                          <Truck className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {t("orders:driverLabel", "Driver:")} <strong className="font-semibold">{driver.full_name}</strong>
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Center Column: Order Items with scrollable container */}
                    <div className="flex-1 min-w-0 w-full lg:px-6 lg:border-l lg:border-r border-border/50 py-3 lg:py-1 border-t lg:border-t-0 border-b lg:border-b-0 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <ShoppingBag className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-[11px] font-bold uppercase tracking-wider">
                          {t("orders:orderItems", "Order Items")} ({its.length})
                        </span>
                      </div>
                      <div className="max-h-24 sm:max-h-28 overflow-y-auto custom-scrollbar flex flex-wrap gap-2 pr-1 items-center content-start">
                        {its.length > 0 ? (
                          its.map((item) => {
                            const sizeMatch = item.item_name.match(/\(([^)]+)\)/);
                            const addMatch = item.item_name.includes("+") ? item.item_name.split("+")[1] : null;
                            let baseName = item.item_name;
                            if (sizeMatch) baseName = baseName.replace(sizeMatch[0], "").trim();
                            if (addMatch) baseName = baseName.split("+")[0].trim();

                            return (
                              <div
                                key={item.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/80 text-xs sm:text-sm font-semibold text-foreground shadow-2xs hover:bg-muted transition-colors flex-wrap"
                              >
                                <span className="inline-flex items-center justify-center bg-primary text-primary-foreground font-bold rounded px-1.5 py-0.2 text-[11px]">
                                  {item.quantity}×
                                </span>
                                <span>{baseName}</span>
                                {sizeMatch && (
                                  <span className="bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold px-1 py-0.2 rounded">
                                    {sizeMatch[1]}
                                  </span>
                                )}
                                {addMatch && (
                                  <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[10px] font-medium px-1 py-0.2 rounded">
                                    +{addMatch.trim()}
                                  </span>
                                )}
                                {item.notes && (
                                  <span className="text-[11px] font-normal text-muted-foreground italic">
                                    ({item.notes})
                                  </span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <span className="text-xs text-muted-foreground italic bg-muted/30 px-2.5 py-1 rounded-md border border-dashed border-border">
                            {t("orders:noNotes", "No items recorded")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Amount, Time & Action Buttons */}
                    <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between gap-3 shrink-0 w-full lg:w-auto">
                      <div className="text-left lg:text-right">
                        <span className="text-xl sm:text-2xl font-bold text-foreground tracking-tight block">
                          {formatCurrency(o.total_amount)}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground flex items-center lg:justify-end gap-1 mt-0.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDate(o.created_at)} {formatTime(o.created_at)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => navigate(`/orders/${o.id}`)}>
                          {t("orders:viewDetails", "Details")}
                        </Button>
                        {isStaffRole &&
                          o.status !== "delivered" &&
                          o.status !== "cancelled" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs font-semibold"
                              onClick={() => navigate(`/dashboard?add_to=${o.id}`)}
                            >
                              <UtensilsCrossed className="h-3.5 w-3.5" />
                              {t("orders:addItems", "Add Items")}
                            </Button>
                          )}
                        {!isStaffRole &&
                          siblingBranches.length > 1 &&
                          o.status !== "delivered" &&
                          o.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs font-semibold bg-primary/5 hover:bg-primary/15 text-primary border-primary/25"
                            onClick={() => {
                              setOrderToTransfer(o);
                              setTargetBranchId("");
                              setTransferReason("");
                              setTransferOpen(true);
                            }}
                            title="Transfer / send this order to another branch"
                          >
                            <Building2 className="h-3.5 w-3.5" />
                            <span>{t("orders:transfer", "Transfer")}</span>
                          </Button>
                        )}
                        {/* Kitchen: prep → ready. Waiter: served → completed. Admins: full flow. */}
                        {!isStaffRole && o.status === "pending" && (
                          <Button size="sm" onClick={() => confirmOrder(o)}>
                            {t("orders:confirm", "Confirm")}
                          </Button>
                        )}
                        {!isStaffRole && o.status === "confirmed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(o.sittingOrderIds, "preparing")}
                          >
                            {t("orders:startPrep", "Start prep")}
                          </Button>
                        )}
                        {(isKitchenRole || (!isStaffRole && !isKitchenRole)) &&
                          o.status === "preparing" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(o.sittingOrderIds, "ready")}
                          >
                            {t("orders:ready", "Ready")}
                          </Button>
                        )}
                        {(isStaffRole || (!isKitchenRole && !isStaffRole)) &&
                          o.status === "ready" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(o.sittingOrderIds, "out_for_delivery")}
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
                        {!isStaffRole &&
                          !isKitchenRole &&
                          o.status !== "cancelled" &&
                          o.status !== "delivered" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm(t("orders:cancelOrder", "Cancel order?"))) updateStatus(o.sittingOrderIds, "cancelled");
                            }}
                          >
                            {t("orders:cancel", "Cancel")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
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

      {/* Quick Transfer Order to Branch Modal (HQ Admin) */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> {t("orders:transferOrderToBranch", "Transfer Order to Branch")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("orders:transferDesc", { number: orderToTransfer?.order_number, defaultValue: `Send order ${orderToTransfer?.order_number} to another branch for fulfillment.` })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Currently Assigned Branch Banner */}
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-xs flex items-center justify-between">
              <span className="text-muted-foreground font-medium">{t("orders:currentlyAssignedTo", "Currently Assigned To:")}</span>
              <span className="font-bold text-foreground">
                {orderToTransfer ? restaurantsMap[orderToTransfer.restaurant_id] || t("orders:branch", "Branch") : "—"}
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">{t("orders:selectDestinationBranch", "Select Destination Branch")}</Label>
              <Select value={targetBranchId} onValueChange={setTargetBranchId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder={t("orders:chooseDestinationBranch", "Choose destination branch...")} />
                </SelectTrigger>
                <SelectContent>
                  {siblingBranches
                    .filter((b) => b.id !== orderToTransfer?.restaurant_id)
                    .map((b) => {
                      const isPaused = b.is_accepting_orders === false || b.is_active === false;
                      return (
                        <SelectItem
                          key={b.id}
                          value={b.id}
                          disabled={isPaused}
                          className={isPaused ? "opacity-60 text-muted-foreground" : ""}
                        >
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span>{b.name}</span>
                            {isPaused && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                {t("orders:pausedNotAccepting", "⚠️ Paused (Not Accepting)")}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
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
              {t("orders:sendToBranch", "Send to Branch")}
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