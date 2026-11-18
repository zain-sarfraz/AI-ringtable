import { OrderStatus } from "@/lib/restaurant";
import i18n from "./index";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧", locale: "en-US" },
  { code: "fr", name: "Français", flag: "🇫🇷", locale: "fr-FR" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export function getActiveLanguage(): SupportedLanguage {
  const lang = i18n.language?.split("-")[0];
  return lang === "fr" ? "fr" : "en";
}

export function getActiveLocale(): string {
  const lang = getActiveLanguage();
  return lang === "fr" ? "fr-FR" : "en-US";
}

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

export function getCurrencySymbol(currency?: string): string {
  const c = (currency && currency.trim()) || defaultAppCurrency || "USD";
  try {
    const parts = new Intl.NumberFormat(getActiveLocale(), { style: "currency", currency: c }).formatToParts(0);
    const symbolPart = parts.find((p) => p.type === "currency");
    return symbolPart ? symbolPart.value : c;
  } catch {
    return c === "USD" ? "$" : c;
  }
}

export function formatCurrency(
  amount: number | string | null | undefined,
  currency?: string,
  locale?: string
): string {
  const c = (currency && currency.trim()) || defaultAppCurrency || "USD";
  const n = typeof amount === "string" ? parseFloat(amount) : amount ?? 0;
  const targetLocale = locale || getActiveLocale();
  try {
    return new Intl.NumberFormat(targetLocale, {
      style: "currency",
      currency: c,
    }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}

export function formatDate(
  date: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  locale?: string
): string {
  if (!date) return "";
  const d = typeof date === "object" ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const targetLocale = locale || getActiveLocale();
  try {
    return new Intl.DateTimeFormat(targetLocale, options).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatTime(
  date: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  },
  locale?: string
): string {
  if (!date) return "";
  const d = typeof date === "object" ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const targetLocale = locale || getActiveLocale();
  try {
    return new Intl.DateTimeFormat(targetLocale, options).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatNumber(
  num: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
  locale?: string
): string {
  const n = typeof num === "string" ? parseFloat(num) : num ?? 0;
  const targetLocale = locale || getActiveLocale();
  try {
    return new Intl.NumberFormat(targetLocale, options).format(n || 0);
  } catch {
    return String(n || 0);
  }
}

export function getOrderStatusLabel(
  status: OrderStatus | string,
  t?: (key: string, defaultVal?: string) => string
): string {
  const map: Record<string, string> = {
    pending: "orders:newOrders",
    confirmed: "orders:confirmed",
    preparing: "orders:preparing",
    ready: "orders:ready",
    assigned: "orders:assigned",
    out_for_delivery: "orders:outForDelivery",
    delivered: "orders:delivered",
    cancelled: "orders:cancelled",
  };
  const key = map[status];
  if (!key) return status;
  if (typeof t === "function") return t(key);
  return i18n.t(key);
}

