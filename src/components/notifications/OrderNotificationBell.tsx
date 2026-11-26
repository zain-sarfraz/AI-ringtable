import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  BellRing,
  CheckCheck,
  ShoppingBag,
  Clock,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  CalendarCheck,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
  NotificationPrefs,
  playNotificationSound,
  startNotificationLoop,
  stopNotificationLoop,
  unlockNotificationAudio,
} from "@/lib/notificationSound";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/i18n/formatters";
import { toast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";

export interface OrderNotification {
  id: string;
  restaurant_id?: string;
  order_id?: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  created_at: string;
  seen: boolean;
  type?: string;
  title?: string;
  message?: string;
  source?: string | null;
  fulfillment_type?: string | null;
}

const MAX_NOTIFICATIONS = 50;

function getStorageKey(restaurantId: string | null | undefined) {
  return restaurantId ? `order_notifications_list_${restaurantId}` : "order_notifications_list";
}

function getSeenIdsKey(restaurantId: string | null | undefined) {
  return restaurantId ? `order_known_ids_${restaurantId}` : "order_known_ids";
}

function loadStoredNotifications(restaurantId?: string | null): OrderNotification[] {
  try {
    const raw = localStorage.getItem(getStorageKey(restaurantId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: OrderNotification[], restaurantId?: string | null) {
  try {
    localStorage.setItem(getStorageKey(restaurantId), JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    // ignore
  }
}

function loadKnownIds(restaurantId?: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(getSeenIdsKey(restaurantId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveKnownIds(ids: Set<string>, restaurantId?: string | null) {
  try {
    const arr = Array.from(ids).slice(-200);
    localStorage.setItem(getSeenIdsKey(restaurantId), JSON.stringify(arr));
  } catch {
    // ignore
  }
}

const CALL_AGENT_SOURCES = new Set(["phone", "call", "voice", "ai", "synthflow", "elevenlabs"]);

function isCallAgentSource(source?: string | null) {
  return CALL_AGENT_SOURCES.has(String(source || "").trim().toLowerCase());
}

function isTableDiningAlert(n: {
  fulfillment_type?: string | null;
  title?: string | null;
  message?: string | null;
}) {
  const ft = String(n.fulfillment_type || "").trim().toLowerCase().replace(/-/g, "_");
  if (ft === "dine_in") return true;
  if (ft === "pickup" || ft === "delivery") return false;
  const text = `${n.title || ""} ${n.message || ""}`.toLowerCase();
  if (text.includes("pickup") || text.includes("delivery")) return false;
  if (text.includes("dine-in") || text.includes("dine in") || text.includes("table")) return true;
  return false;
}

function canSeeNotification(
  n: {
    type?: string;
    source?: string | null;
    fulfillment_type?: string | null;
    title?: string | null;
    message?: string | null;
  },
  role: string | null,
  isReceptionist: boolean,
) {
  // Role not loaded yet — don't decide visibility (caller must not poison knownIds).
  if (!role) return false;
  const isReservation = n.type === "new_reservation" || n.source === "reservation";
  const isKitchen = role === "kitchen" || role === "chef";
  // Restaurant owners must hear phone/AI order bells (same as admin/manager).
  const isAdmin =
    role === "admin" ||
    role === "manager" ||
    role === "owner" ||
    role === "super_admin";
  const isStaff = role === "staff";
  if (isReservation) return isReceptionist || isAdmin;
  if (isReceptionist) return false;
  // Phone/AI orders: kitchen + management/owner (+ cashier). Floor staff never sees them.
  if (isCallAgentSource(n.source)) {
    return isKitchen || isAdmin || role === "cashier";
  }
  // Floor staff only hears about guests dining at a table.
  if (isStaff) return isTableDiningAlert(n);
  return true;
}

/** Each portal only gets alerts for its own restaurant — admin HQ ≠ branches. */
function getAlertRestaurantIds(
  restaurantId: string | null | undefined,
  _restaurants: { id: string; parent_restaurant_id?: string | null; is_branch?: boolean }[],
  _activeRestaurant: { id?: string; parent_restaurant_id?: string | null; is_branch?: boolean } | null,
): string[] {
  if (!restaurantId) return [];
  return [restaurantId];
}

function tidyLabel(value?: string | null) {
  return String(value || "").replace(/\bTable\s+Table\b/gi, "Table");
}

export function OrderNotificationBell() {
  const { t } = useTranslation(["orders", "common"]);
  const navigate = useNavigate();
  const { role, isReceptionist } = useAuth();
  const { restaurantId, activeRestaurant, restaurants } = useActiveRestaurant();
  const isSuperAdmin = role === "super_admin";
  const isDriver = role === "driver";
  const canAlert = !isDriver;
  const restaurantFamilyKey = restaurants
    .map((r) => `${r.id}:${r.parent_restaurant_id || ""}:${r.is_branch ? 1 : 0}`)
    .join("|");
  const alertRestaurantIds = useMemo(
    () => getAlertRestaurantIds(restaurantId, restaurants, activeRestaurant),
    // restaurantFamilyKey keeps this stable across parent re-renders. A new array
    // every render was restarting the poller and swallowing the bell as "already seen".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurantId, activeRestaurant?.id, activeRestaurant?.is_branch, activeRestaurant?.parent_restaurant_id, restaurantFamilyKey],
  );
  const alertRestaurantIdSet = useMemo(() => new Set(alertRestaurantIds), [alertRestaurantIds]); 

  const [notifications, setNotifications] = useState<OrderNotification[]>(() => loadStoredNotifications(restaurantId));
  const [ringing, setRinging] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => ({
    ...loadNotificationPrefs(restaurantId),
    ringtone: "classic-bell",
  }));
  const knownIdsRef = useRef<Set<string>>(loadKnownIds(restaurantId));
  const prefsRef = useRef<NotificationPrefs>(prefs);
  prefsRef.current = prefs;

  // Reload notifications & known IDs & prefs when restaurantId changes
  useEffect(() => {
    setNotifications(loadStoredNotifications(restaurantId));
    knownIdsRef.current = loadKnownIds(restaurantId);
    const updatedPrefs = { ...loadNotificationPrefs(restaurantId), ringtone: "classic-bell" as const };
    setPrefs(updatedPrefs);
    prefsRef.current = updatedPrefs;
    stopNotificationLoop();
    setRinging(false);
  }, [restaurantId]);

  // Keep unlocking Web Audio on any gesture — browsers mute until resume succeeds.
  useEffect(() => {
    const unlock = () => {
      void unlockNotificationAudio();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  const visibleNotifications = notifications.filter((n) =>
    canSeeNotification(n, role, isReceptionist),
  );
  const unreadCount = visibleNotifications.filter((n) => !n.seen).length;

  // Persist notifications whenever they change for the current restaurant
  useEffect(() => {
    saveNotifications(notifications, restaurantId);
  }, [notifications, restaurantId]);

  // Sync preferences across tabs
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<NotificationPrefs>;
      if (ce.detail) {
        const updated = { ...ce.detail, ringtone: "classic-bell" as const };
        setPrefs(updated);
        prefsRef.current = updated;
      }
    };
    window.addEventListener("notification-prefs-changed", handler);
    return () => window.removeEventListener("notification-prefs-changed", handler);
  }, []);

  const startRinging = useCallback(() => {
    if (!canAlert) return;
    const currentPrefs = prefsRef.current;
    if (!currentPrefs.enabled) return;

    setRinging(true);
    void unlockNotificationAudio().then(() => {
      if (currentPrefs.repeatUntilAcknowledged ?? true) {
        startNotificationLoop("classic-bell", currentPrefs.volume, 2800);
      } else {
        void playNotificationSound("classic-bell", currentPrefs.volume);
      }
    });
  }, [canAlert]);

  const stopRinging = useCallback(() => {
    setRinging(false);
    stopNotificationLoop();
  }, []);

  const addNotification = useCallback(
    (order: Omit<OrderNotification, "seen"> & { seen?: boolean }, triggerAlert = true) => {
      if (!canAlert) return;
      // Wait for auth role — marking knownIds while role is null permanently silences the bell.
      if (!role) return;

      // Accept alerts for the active restaurant or any sibling branch under the same parent HQ.
      if (
        order.restaurant_id &&
        restaurantId &&
        order.restaurant_id !== restaurantId &&
        !alertRestaurantIdSet.has(order.restaurant_id)
      ) {
        return;
      }

      const isReservation = order.type === "new_reservation";

      if (!canSeeNotification(order, role, isReceptionist)) {
        // Role is known and this alert is not for this user — remember so we don't re-toast.
        knownIdsRef.current.add(order.id);
        if (order.order_id) knownIdsRef.current.add(order.order_id);
        saveKnownIds(knownIdsRef.current, restaurantId);
        setNotifications((prev) =>
          prev.filter((n) => n.id !== order.id && n.order_id !== order.order_id && n.id !== order.order_id),
        );
        return;
      }

      const alreadyListed =
        knownIdsRef.current.has(order.id) ||
        Boolean(order.order_id && knownIdsRef.current.has(order.order_id));

      const newNotif: OrderNotification = { ...order, seen: order.seen ?? false };
      let isBrandNew = !alreadyListed;

      setNotifications((prev) => {
        const existingIndex = prev.findIndex(
          (n) =>
            n.id === order.id ||
            (order.order_id &&
              order.type !== "new_reservation" &&
              (n.id === order.order_id || n.order_id === order.order_id)),
        );
        if (existingIndex >= 0) {
          isBrandNew = false;
          const existing = prev[existingIndex];
          if (!order.source || existing.source === order.source) return prev;
          const copy = prev.slice();
          copy[existingIndex] = { ...existing, source: order.source };
          return copy;
        }
        return [newNotif, ...prev];
      });

      knownIdsRef.current.add(order.id);
      if (order.order_id) knownIdsRef.current.add(order.order_id);
      saveKnownIds(knownIdsRef.current, restaurantId);

      if (triggerAlert && isBrandNew) {
        let toastTitle = t("orders:newOrderAlert", "🛒 New Order Received");
        let toastDesc = `${order.order_number} · ${order.customer_name} · ${formatCurrency(order.total_amount)}`;

        if (isReservation) {
          toastTitle = "New reservation";
          toastDesc = order.message || order.title || `${order.customer_name} reserved a table.`;
        } else if (order.type === "transfer_requested") {
          toastTitle = order.title || "🚨 Incoming Order Transfer Request";
          toastDesc = order.message || `Order #${order.order_number} was transferred to your branch.`;
        } else if (order.type === "transfer_accepted") {
          toastTitle = order.title || "✅ Order Transfer Accepted";
          toastDesc = order.message || `Order #${order.order_number} transfer was accepted.`;
        } else if (order.type === "transfer_rejected") {
          toastTitle = order.title || "❌ Order Transfer Rejected";
          toastDesc = order.message || `Order #${order.order_number} transfer was rejected.`;
        } else if (order.title) {
          toastTitle = order.title;
          toastDesc = order.message || toastDesc;
        }

        toast({
          title: toastTitle,
          description: toastDesc,
          duration: 7000,
        });

        const isAdmin =
          role === "admin" ||
          role === "manager" ||
          role === "owner" ||
          role === "super_admin";
        if (prefsRef.current.enabled && (!isReservation || isReceptionist || isAdmin)) {
          startRinging();
        }
      }
    },
    [startRinging, t, canAlert, restaurantId, alertRestaurantIdSet, isReceptionist, role]
  );

  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  // 1. Listen to instant custom event from manual order / cart checkout
  useEffect(() => {
    const handleNewOrderEvent = (e: Event) => {
      if (!canAlert) return;
      const customEvent = e as CustomEvent<Omit<OrderNotification, "seen"> & { restaurant_id?: string }>;
      if (customEvent.detail && customEvent.detail.id) {
        const rid = customEvent.detail.restaurant_id;
        if (rid && restaurantId && rid !== restaurantId && !alertRestaurantIdSet.has(rid)) {
          return;
        }
        addNotificationRef.current(customEvent.detail, true);
      }
    };

    window.addEventListener("new-order-created", handleNewOrderEvent);
    return () => {
      window.removeEventListener("new-order-created", handleNewOrderEvent);
    };
  }, [canAlert, restaurantId, alertRestaurantIdSet]);

  // 2. Periodic background poll
  useEffect(() => {
    // Wait for role so phone-order alerts are not marked "known" while role is still null.
    if (!canAlert || !restaurantId || !role) return;

    let cancelled = false;
    let isInitial = true;
    const scopeIds = alertRestaurantIds.length ? alertRestaurantIds : [restaurantId];
    // Only use eq filters — queryExecutor applyOrString does not support `in.(...)`.
    const orderScopeFilter = scopeIds
      .map((id) => `restaurant_id.eq.${id}`)
      .concat(`pending_transfer_to_restaurant_id.eq.${restaurantId}`)
      .join(",");

    async function checkNewOrders() {
      if (cancelled || !restaurantId || !canAlert || !role) return;
      try {
        const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const { data: orderRows } = await supabase
          .from("orders")
          .select("id, restaurant_id, order_number, customer_name, total_amount, created_at, transfer_status, pending_transfer_to_restaurant_id, source, call_id, fulfillment_type")
          .or(orderScopeFilter)
          .order("created_at", { ascending: false })
          .limit(15);
        const orderSourceById = new Map<string, string>();
        const fulfillmentById = new Map<string, string>();
        for (const row of (orderRows || []) as any[]) {
          if (!row?.id) continue;
          if (row.call_id) orderSourceById.set(row.id, "phone");
          else if (row.source) orderSourceById.set(row.id, row.source);
          if (row.fulfillment_type) fulfillmentById.set(row.id, row.fulfillment_type);
        }

        // Fetch in-app notifications
        try {
          const notifResp = await fetch(
            `${getApiBase()}/api/notifications?restaurant_id=${encodeURIComponent(restaurantId)}&limit=20`,
            { headers }
          );
          if (notifResp.ok) {
            const notifData = await notifResp.json();
            const serverNotifs = (notifData?.notifications || []) as any[];

            if (isInitial) {
              for (const sn of serverNotifs) {
                const createdMs = sn.created_at ? new Date(sn.created_at).getTime() : 0;
                const ringFresh =
                  Number.isFinite(createdMs) &&
                  Date.now() - createdMs < 30000 &&
                  !knownIdsRef.current.has(sn.id);
                if (!ringFresh) knownIdsRef.current.add(sn.id);
                let meta: any = {};
                try {
                  meta = typeof sn.metadata === "string" ? JSON.parse(sn.metadata) : sn.metadata || {};
                } catch {
                  // ignore
                }
                addNotificationRef.current(
                  {
                    id: sn.id,
                    restaurant_id: sn.restaurant_id,
                    order_id: sn.order_id,
                    order_number: meta.order_number || `ORD-${(sn.order_id || sn.id).slice(0, 6)}`,
                    customer_name: meta.customer_name || sn.title,
                    total_amount: Number(meta.total_amount ?? 0),
                    created_at: sn.created_at ?? new Date().toISOString(),
                    type: sn.type,
                    title: sn.title,
                    message: sn.message,
                    source:
                      (sn.order_id && orderSourceById.get(sn.order_id)) ||
                      meta.source ||
                      null,
                    fulfillment_type:
                      meta.fulfillment_type ||
                      (sn.order_id && fulfillmentById.get(sn.order_id)) ||
                      null,
                    seen: Boolean(sn.is_read),
                  },
                  ringFresh
                );
              }
              saveKnownIds(knownIdsRef.current, restaurantId);
            } else {
              for (const sn of serverNotifs) {
                if (!knownIdsRef.current.has(sn.id)) {
                  let meta: any = {};
                  try {
                    meta = typeof sn.metadata === "string" ? JSON.parse(sn.metadata) : sn.metadata || {};
                  } catch {
                    // ignore
                  }

                  addNotificationRef.current(
                    {
                      id: sn.id,
                      restaurant_id: sn.restaurant_id,
                      order_id: sn.order_id,
                      order_number: meta.order_number || `ORD-${(sn.order_id || sn.id).slice(0, 6)}`,
                      customer_name: meta.customer_name || sn.title,
                      total_amount: Number(meta.total_amount ?? 0),
                      created_at: sn.created_at ?? new Date().toISOString(),
                      type: sn.type,
                      title: sn.title,
                      message: sn.message,
                      source:
                        (sn.order_id && orderSourceById.get(sn.order_id)) ||
                        meta.source ||
                        null,
                      fulfillment_type:
                        meta.fulfillment_type ||
                        (sn.order_id && fulfillmentById.get(sn.order_id)) ||
                        null,
                    },
                    true
                  );
                }
              }
            }
          }
        } catch {
          // ignore
        }

        if (isReceptionist || role === "staff") {
          isInitial = false;
          return;
        }

        if (cancelled) return;
        const orderList = (orderRows || []) as any[];

        if (isInitial) {
          for (const o of orderList) {
            const createdMs = o.created_at ? new Date(o.created_at).getTime() : 0;
            const ringFresh =
              Number.isFinite(createdMs) &&
              Date.now() - createdMs < 30000 &&
              !knownIdsRef.current.has(o.id);
            if (!ringFresh) {
              knownIdsRef.current.add(o.id);
              continue;
            }
            const isTransfer = o.pending_transfer_to_restaurant_id === restaurantId && o.transfer_status === "pending";
            addNotificationRef.current(
              {
                id: o.id,
                restaurant_id: o.restaurant_id,
                order_id: o.id,
                order_number: o.order_number || `ORD-${o.id.slice(0, 6)}`,
                customer_name: o.customer_name || "Customer",
                total_amount: Number(o.total_amount ?? 0),
                created_at: o.created_at ?? new Date().toISOString(),
                type: isTransfer ? "transfer_requested" : "new_order",
                title: isTransfer ? "🚨 Incoming Order Transfer Request" : "🛒 New Order Received",
                source: o.call_id ? "phone" : o.source || null,
                fulfillment_type: o.fulfillment_type || null,
              },
              true,
            );
          }
          saveKnownIds(knownIdsRef.current, restaurantId);
          isInitial = false;
          return;
        }

        for (const o of orderList) {
          if (!knownIdsRef.current.has(o.id)) {
            const isTransfer = o.pending_transfer_to_restaurant_id === restaurantId && o.transfer_status === "pending";
            addNotificationRef.current(
              {
                id: o.id,
                restaurant_id: o.restaurant_id,
                order_id: o.id,
                order_number: o.order_number || `ORD-${o.id.slice(0, 6)}`,
                customer_name: o.customer_name || "Customer",
                total_amount: Number(o.total_amount ?? 0),
                created_at: o.created_at ?? new Date().toISOString(),
                type: isTransfer ? "transfer_requested" : "new_order",
                title: isTransfer ? "🚨 Incoming Order Transfer Request" : "🛒 New Order Received",
                source: o.call_id ? "phone" : o.source || null,
                fulfillment_type: o.fulfillment_type || null,
              },
              true
            );
          }
        }
      } catch (err) {
        console.error("Failed to check new orders/notifications:", err);
      }
    }

    checkNewOrders();
    const interval = setInterval(checkNewOrders, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [restaurantId, alertRestaurantIds, canAlert, isReceptionist, role, alertRestaurantIdSet]);

  const handlePopoverChange = (open: boolean) => {
    setPopoverOpen(open);
    if (open) {
      stopRinging();
    }
  };

  const markAllSeen = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, seen: true })));
    const token = getToken();
    if (token && restaurantId) {
      fetch(`${getApiBase()}/api/notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      }).catch(() => {});
    }
  };

  const markOneSeen = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, seen: true } : n))
    );
    const token = getToken();
    if (token) {
      fetch(`${getApiBase()}/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  };

  const clearAll = () => {
    setNotifications([]);
    saveNotifications([], restaurantId);
  };

  const goToOrder = (notif: OrderNotification) => {
    markOneSeen(notif.id);
    stopRinging();
    setPopoverOpen(false);
    if (notif.type === "new_reservation") {
      navigate("/reservations");
      return;
    }
    const targetOrderId = notif.order_id || notif.id;
    navigate(`/orders/${targetOrderId}`);
  };

  const formatTimeAgo = (iso: string) => {
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return "just now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative rounded-xl transition-all duration-300 h-10 w-10",
            ringing
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/20 animate-pulse"
              : unreadCount > 0
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "hover:bg-accent text-muted-foreground hover:text-foreground"
          )}
          aria-label={t("orders:notifications", "Notifications")}
        >
          {/* Animated waves when ringing */}
          {ringing && (
            <span className="absolute inset-0 rounded-xl bg-primary/30 animate-ping pointer-events-none" />
          )}

          {ringing ? (
            <BellRing className="h-5 w-5 animate-bounce" />
          ) : (
            <Bell className={cn("h-5 w-5 transition-transform", unreadCount > 0 && "scale-105 text-primary")} />
          )}

          {/* Unread Counter Badge */}
          {unreadCount > 0 && (
            <Badge
              className={cn(
                "absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center p-0 text-[10px] font-extrabold shadow-md",
                "bg-destructive text-destructive-foreground animate-in zoom-in-50",
                ringing && "animate-pulse"
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="z-[60] w-[min(100vw-1.25rem,22rem)] max-w-[calc(100vw-1.25rem)] p-0 shadow-2xl rounded-2xl border border-border overflow-hidden sm:w-96 sm:max-w-none"
      >
        {/* Clean Header */}
        <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-3 py-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold transition-all",
              ringing ? "bg-primary text-primary-foreground animate-pulse" : "bg-primary/10 text-primary"
            )}>
              {ringing ? <BellRing className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-bold text-foreground">
                  {isReceptionist
                    ? "Reservations"
                    : t("orders:notifications", "Order Notifications")}
                </p>
                {ringing && (
                  <Badge variant="destructive" className="h-4 animate-pulse px-1 py-0 text-[9px]">
                    Alert
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {unreadCount > 0
                  ? isReceptionist
                    ? `${unreadCount} new reservation${unreadCount > 1 ? "s" : ""}`
                    : `${unreadCount} ${t("orders:unread", "unread")} order${unreadCount > 1 ? "s" : ""}`
                  : "All caught up"}
              </p>
            </div>
          </div>

          {visibleNotifications.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllSeen}
                  className="h-7 gap-1 px-2 text-xs text-primary hover:bg-primary/10"
                  title={t("common:markAllRead", "Mark all as read")}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Read</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                {t("common:clearAll", "Clear")}
              </Button>
            </div>
          )}
        </div>

        {/* Notification List */}
        <div className="max-h-[min(60vh,380px)] overflow-y-auto overscroll-contain divide-y divide-border">
          {visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Bell className="h-6 w-6 opacity-30" />
              </div>
              <p className="text-sm font-medium">
                {isReceptionist ? "No reservations yet" : t("orders:noNotifications", "No notifications yet")}
              </p>
              <p className="max-w-[220px] text-center text-xs opacity-60">
                {isReceptionist
                  ? "A new reservation will ring this bell"
                  : t("orders:noNotificationsDesc", "New orders and transfer alerts will appear here in real time")}
              </p>
            </div>
          ) : (
            visibleNotifications.map((n) => {
              const isTransferReq = n.type === "transfer_requested";
              const isTransferAcc = n.type === "transfer_accepted";
              const isTransferRej = n.type === "transfer_rejected";
              const isReservation = n.type === "new_reservation";

              return (
                <button
                  key={n.id}
                  onClick={() => goToOrder(n)}
                  className={cn(
                    "group relative flex w-full items-start gap-2.5 px-3 py-3 text-left transition-all duration-200 sm:gap-3 sm:px-4",
                    n.seen
                      ? "bg-card opacity-75 hover:bg-accent/40 hover:opacity-100"
                      : isTransferReq
                        ? "border-l-4 border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15"
                        : isTransferRej
                          ? "border-l-4 border-l-rose-500 bg-rose-500/10 hover:bg-rose-500/15"
                          : isTransferAcc
                            ? "border-l-4 border-l-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/15"
                            : isReservation
                              ? "border-l-4 border-l-sky-500 bg-sky-500/10 hover:bg-sky-500/15"
                              : "border-l-4 border-l-primary bg-primary/5 hover:bg-primary/10"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {isTransferReq ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        <ArrowRightLeft className="h-3.5 w-3.5 animate-pulse" />
                      </div>
                    ) : isTransferRej ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-600 dark:text-rose-400">
                        <XCircle className="h-3.5 w-3.5" />
                      </div>
                    ) : isTransferAcc ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                    ) : isReservation ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sky-600 dark:text-sky-400">
                        <CalendarCheck className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <ShoppingBag className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "break-all text-xs font-bold",
                            n.seen ? "text-muted-foreground" : "text-foreground"
                          )}
                        >
                          {tidyLabel(n.order_number)}
                        </span>
                        {isTransferReq && (
                          <Badge variant="outline" className="h-4 border-amber-500/30 bg-amber-500/20 px-1 py-0 text-[9px] text-amber-700 dark:text-amber-300">
                            Transfer
                          </Badge>
                        )}
                        {isTransferRej && (
                          <Badge variant="outline" className="h-4 border-rose-500/30 bg-rose-500/20 px-1 py-0 text-[9px] text-rose-700 dark:text-rose-300">
                            Rejected
                          </Badge>
                        )}
                        {isTransferAcc && (
                          <Badge variant="outline" className="h-4 border-emerald-500/30 bg-emerald-500/20 px-1 py-0 text-[9px] text-emerald-700 dark:text-emerald-300">
                            Accepted
                          </Badge>
                        )}
                        {isReservation && (
                          <Badge variant="outline" className="h-4 border-sky-500/30 bg-sky-500/20 px-1 py-0 text-[9px] text-sky-700 dark:text-sky-300">
                            Reservation
                          </Badge>
                        )}
                      </div>
                      {n.total_amount > 0 && (
                        <span
                          className={cn(
                            "shrink-0 text-xs font-extrabold tabular-nums",
                            n.seen ? "text-muted-foreground" : "text-primary"
                          )}
                        >
                          {formatCurrency(n.total_amount)}
                        </span>
                      )}
                    </div>

                    <p
                      className={cn(
                        "mt-0.5 text-xs leading-snug break-words [overflow-wrap:anywhere]",
                        n.seen ? "text-muted-foreground/80" : "font-medium text-foreground"
                      )}
                    >
                      {tidyLabel(n.message || n.customer_name || "Order alert")}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground/60">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>{formatTimeAgo(n.created_at)}</span>
                      {!n.seen && (
                        <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px] font-semibold">
                          New
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {visibleNotifications.length > 0 && (
          <div className="border-t border-border bg-muted/20 p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => {
                setPopoverOpen(false);
                navigate(isReceptionist ? "/reservations" : "/orders");
              }}
            >
              <span className="truncate">
                {isReceptionist
                  ? "View reservations"
                  : t("orders:viewAllOrders", "View all orders")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}