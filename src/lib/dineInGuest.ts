const PREFIX = "dinein-guest:";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type DineInGuest = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  order_ids?: string[];
  table_session_id?: string | null;
};

function storageKey(restaurantId: string, tableId?: string | null, tableNumber?: string | null) {
  const table = String(tableId || tableNumber || "")
    .trim()
    .toLowerCase()
    .replace(/^table[\s._-]*/i, "");
  return `${PREFIX}${restaurantId}:${table}`;
}

export function saveDineInGuest(
  restaurantId: string,
  tableId: string | null | undefined,
  tableNumber: string | null | undefined,
  guest: DineInGuest,
) {
  if (!restaurantId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(restaurantId, tableId, tableNumber),
      JSON.stringify({ ...guest, saved_at: Date.now() }),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function loadDineInGuest(
  restaurantId: string,
  tableId?: string | null,
  tableNumber?: string | null,
): DineInGuest | null {
  if (!restaurantId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(restaurantId, tableId, tableNumber));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - Number(parsed.saved_at || 0) > MAX_AGE_MS) {
      localStorage.removeItem(storageKey(restaurantId, tableId, tableNumber));
      return null;
    }
    return {
      customer_name: String(parsed.customer_name || ""),
      customer_phone: String(parsed.customer_phone || ""),
      customer_email: String(parsed.customer_email || ""),
      order_ids: Array.isArray(parsed.order_ids)
        ? parsed.order_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [],
      table_session_id: parsed.table_session_id ? String(parsed.table_session_id) : null,
    };
  } catch {
    return null;
  }
}

/** Remember this browser's dine-in orders for the same table visit. */
export function rememberDineInOrder(
  restaurantId: string,
  tableId: string | null | undefined,
  tableNumber: string | null | undefined,
  orderId: string,
  tableSessionId?: string | null,
) {
  if (!restaurantId || !orderId) return;
  const existing = loadDineInGuest(restaurantId, tableId, tableNumber);
  const order_ids = [...new Set([...(existing?.order_ids || []), orderId])];
  saveDineInGuest(restaurantId, tableId, tableNumber, {
    customer_name: existing?.customer_name || "",
    customer_phone: existing?.customer_phone || "",
    customer_email: existing?.customer_email || "",
    order_ids,
    table_session_id: tableSessionId || existing?.table_session_id || null,
  });
}
