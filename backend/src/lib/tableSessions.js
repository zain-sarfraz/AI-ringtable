import { randomUUID } from "node:crypto";
import { deductStockForOrder } from "./stockDeduction.js";

export function normalizeTableNumber(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^table[\s._-]*/i, "")
    .trim();
}

export async function resolveRestaurantFamilyIds(knex, restaurantId) {
  if (!restaurantId) return [];
  const rest = await knex("restaurants").where({ id: restaurantId }).first();
  if (!rest) return [restaurantId];
  const parentId = rest.parent_restaurant_id || rest.id;
  const family = await knex("restaurants")
    .where({ id: parentId })
    .orWhere({ parent_restaurant_id: parentId })
    .select("id");
  const ids = [...new Set((family || []).map((r) => r.id).filter(Boolean))];
  return ids.length ? ids : [restaurantId];
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

export function isPlaceholderPhone(phone) {
  const raw = String(phone || "").trim();
  const norm = normalizePhone(raw);
  if (!norm) return true;
  if (/^table\b/i.test(raw)) return true;
  if (/^dine[-\s]?in/i.test(raw)) return true;
  if (raw === "—" || raw === "-" || raw === "0000000000") return true;
  return false;
}

export async function loadSessionBill(knex, sessionId) {
  const session = await knex("table_sessions").where({ id: sessionId }).first();
  if (!session) return null;
  const orders = await knex("orders")
    .where({ table_session_id: session.id })
    .whereNot({ status: "cancelled" })
    .orderBy("created_at", "asc");
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await knex("order_items").whereIn("order_id", ids).orderBy("created_at", "asc") : [];
  const itemsByOrder = {};
  for (const item of items) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push(item);
  }
  const billedOrders = orders.map((o) => ({
    ...o,
    items: itemsByOrder[o.id] || [],
  }));
  const totals = billedOrders.reduce(
    (acc, o) => {
      acc.subtotal += Number(o.subtotal || 0);
      acc.tax_amount += Number(o.tax_amount || 0);
      acc.delivery_fee += Number(o.delivery_fee || 0);
      acc.discount_amount += Number(o.discount_amount || 0);
      acc.total_amount += Number(o.total_amount || 0);
      acc.order_count += 1;
      return acc;
    },
    { subtotal: 0, tax_amount: 0, delivery_fee: 0, discount_amount: 0, total_amount: 0, order_count: 0 },
  );
  return { session, orders: billedOrders, totals };
}

export async function findOpenSessionsForTable(trx, { restaurantId, tableId, tableNumber, restaurantIds }) {
  const tableNum = tableNumber ? String(tableNumber).trim() : null;
  const norm = tableNum ? normalizeTableNumber(tableNum) : "";
  const ids = restaurantIds && restaurantIds.length ? restaurantIds : restaurantId ? [restaurantId] : [];
  let q = trx("table_sessions").where({ status: "open" });
  if (ids.length) q = q.whereIn("restaurant_id", ids);
  if (tableId) {
    q = q.andWhere(function () {
      this.where({ table_id: tableId });
      if (tableNum) {
        this.orWhere({ table_number: tableNum });
        if (norm) this.orWhereRaw("LOWER(TRIM(regexp_replace(table_number, '^table[[:space:]_.-]*', '', 'i'))) = ?", [norm]);
      }
    });
  } else if (tableNum) {
    q = q.andWhere(function () {
      this.where({ table_number: tableNum });
      if (norm) this.orWhereRaw("LOWER(TRIM(regexp_replace(table_number, '^table[[:space:]_.-]*', '', 'i'))) = ?", [norm]);
    });
  } else {
    return [];
  }
  return q.orderBy("opened_at", "asc");
}

export async function findOrCreateTableSession(trx, {
  restaurantId,
  tableId,
  tableNumber,
  customerName,
  customerPhone,
  createdBy,
  source,
}) {
  const familyIds = await resolveRestaurantFamilyIds(trx, restaurantId);
  let resolvedTable = null;
  if (tableId) {
    resolvedTable = await trx("restaurant_tables").where({ id: tableId }).first();
  }
  if (!resolvedTable && tableNumber) {
    const norm = normalizeTableNumber(tableNumber);
    const candidates = await trx("restaurant_tables").whereIn("restaurant_id", familyIds.length ? familyIds : [restaurantId]);
    resolvedTable = candidates.find((t) => normalizeTableNumber(t.table_number) === norm) || null;
  }

  const phoneNorm = isPlaceholderPhone(customerPhone) ? "" : normalizePhone(customerPhone);
  const effectiveRestaurantId = resolvedTable?.restaurant_id || restaurantId;
  const effectiveTableId = resolvedTable?.id || tableId || null;
  const tableNum = resolvedTable?.table_number || (tableNumber ? String(tableNumber).trim() : "Unknown");
  const openSessions = await findOpenSessionsForTable(trx, {
    restaurantId: effectiveRestaurantId,
    restaurantIds: familyIds,
    tableId: effectiveTableId,
    tableNumber: tableNum,
  });

  let session = null;
  if (phoneNorm) {
    session = openSessions.find((s) => s.customer_phone_normalized === phoneNorm) || null;
    if (!session) {
      session = openSessions.find((s) => !s.customer_phone_normalized) || null;
    }
  } else if (openSessions.length === 1) {
    session = openSessions[0];
  }

  if (session) {
    const updates = { updated_at: new Date() };
    if (phoneNorm && !session.customer_phone_normalized) {
      updates.customer_phone = String(customerPhone).trim();
      updates.customer_phone_normalized = phoneNorm;
    }
    if (customerName && !session.customer_name) {
      updates.customer_name = String(customerName).trim();
    }
    if (effectiveTableId && !session.table_id) {
      updates.table_id = effectiveTableId;
    }
    if (Object.keys(updates).length > 1) {
      const [updated] = await trx("table_sessions").where({ id: session.id }).update(updates).returning("*");
      return updated;
    }
    return session;
  }

  const [created] = await trx("table_sessions")
    .insert({
      id: randomUUID(),
      restaurant_id: effectiveRestaurantId,
      table_id: effectiveTableId,
      table_number: tableNum,
      customer_name: customerName ? String(customerName).trim() : null,
      customer_phone: phoneNorm ? String(customerPhone).trim() : "",
      customer_phone_normalized: phoneNorm,
      status: "open",
      source: source || (createdBy ? "staff" : "qr"),
      created_by: createdBy || null,
    })
    .returning("*");
  return created;
}

export async function closeTableSession(trx, sessionId, closedBy) {
  const now = new Date();
  const [session] = await trx("table_sessions")
    .where({ id: sessionId })
    .update({
      status: "closed",
      closed_at: now,
      closed_by: closedBy || null,
      updated_at: now,
    })
    .returning("*");

  if (session) {
    const ordersToDeliver = await trx("orders")
      .where({ table_session_id: sessionId })
      .whereNotIn("status", ["cancelled", "delivered"])
      .select("id");

    await trx("orders")
      .where({ table_session_id: sessionId })
      .whereNot({ status: "cancelled" })
      .update({
        payment_status: "paid",
        status: "delivered",
        delivered_at: now,
        updated_at: now,
      });

    for (const o of ordersToDeliver) {
      try {
        await deductStockForOrder(trx, o.id);
      } catch (err) {
        console.warn(`[tableSessions] Stock deduction warning for order ${o.id}:`, err.message);
      }
    }
  }
  return session;
}

/** Close every open sitting on a table and mark its dine-in orders paid. */
export async function closeTableByIdentity(trx, { restaurantId, tableId, tableNumber, orderIds, closedBy }) {
  const familyIds = await resolveRestaurantFamilyIds(trx, restaurantId);
  const ids = familyIds.length ? familyIds : restaurantId ? [restaurantId] : [];
  const now = new Date();

  const openSessions = await findOpenSessionsForTable(trx, {
    restaurantId,
    restaurantIds: ids,
    tableId: tableId || null,
    tableNumber: tableNumber || null,
  });
  for (const session of openSessions) {
    await closeTableSession(trx, session.id, closedBy);
  }

  let closeOrders = trx("orders")
    .whereIn("restaurant_id", ids.length ? ids : [restaurantId])
    .where({ fulfillment_type: "dine_in" })
    .whereNotIn("status", ["cancelled", "delivered"]);

  if (orderIds && orderIds.length) {
    closeOrders = closeOrders.whereIn("id", orderIds);
  } else {
    closeOrders = closeOrders.andWhere(function () {
      if (tableId) this.where({ table_id: tableId });
      if (tableNumber) {
        const norm = normalizeTableNumber(tableNumber);
        this.orWhere({ table_number: tableNumber });
        if (norm) this.orWhereRaw("LOWER(TRIM(regexp_replace(table_number, '^table[[:space:]_.-]*', '', 'i'))) = ?", [norm]);
      }
    });
  }

  const ordersToDeliver = await closeOrders.clone().select("id");

  const updated = await closeOrders.update({
    payment_status: "paid",
    status: "delivered",
    delivered_at: now,
    updated_at: now,
  });

  for (const o of ordersToDeliver) {
    try {
      await deductStockForOrder(trx, o.id);
    } catch (err) {
      console.warn(`[tableSessions] Stock deduction warning for order ${o.id}:`, err.message);
    }
  }

  return { closed_sessions: openSessions.length, closed_orders: Number(updated) || 0 };
}
