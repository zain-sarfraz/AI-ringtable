import { getActiveLocale } from "@/i18n/formatters";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "assigned",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Sequential stages for admin timeline (excludes cancelled and assigned-to-driver). */
export const ORDER_FULFILLMENT_FLOW: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
] as const;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  assigned: "Assigned to driver",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  confirmed: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  preparing: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  ready: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  assigned: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30",
  out_for_delivery: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  delivered: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
};

let defaultAppCurrency = (() => {
  try {
    return localStorage.getItem("active_restaurant_currency") || "USD";
  } catch {
    return "USD";
  }
})();

export function setDefaultCurrency(currency?: string | null) {
  if (currency && typeof currency === "string") {
    const cleaned = currency.trim().toUpperCase();
    if (cleaned) {
      defaultAppCurrency = cleaned;
      try {
        localStorage.setItem("active_restaurant_currency", cleaned);
      } catch {
        /* ignore */
      }
    }
  }
}

export function getDefaultCurrency(): string {
  return defaultAppCurrency;
}

export function formatCurrency(amount: number | string | null | undefined, currency?: string) {
  const c = (currency && currency.trim()) || defaultAppCurrency || "USD";
  const n = typeof amount === "string" ? parseFloat(amount) : amount ?? 0;
  try {
    return new Intl.NumberFormat(getActiveLocale(), { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}

export function getCurrencySymbol(currency?: string): string {
  const c = (currency && currency.trim()) || defaultAppCurrency || "USD";
  try {
    const parts = new Intl.NumberFormat(getActiveLocale(), { style: "currency", currency: c }).formatToParts(0);
    const symbolPart = parts.find((p) => p.type === "currency");
    return symbolPart ? symbolPart.value : c;
  } catch {
    return "$";
  }
}