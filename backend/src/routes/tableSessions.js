import { Router } from "express";
import { getKnex } from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import {
  findOpenSessionsForTable,
  findOrCreateTableSession,
  loadSessionBill,
  closeTableSession,
  closeTableByIdentity,
  isPlaceholderPhone,
  normalizePhone,
  normalizeTableNumber,
  resolveRestaurantFamilyIds,
} from "../lib/tableSessions.js";
import { nextOrderNumber } from "../lib/orderNumbers.js";
import { notifyNewOrderLater } from "../lib/orderAlerts.js";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === "string" && UUID_REGEX.test(str);
}

function serializeBill(bill) {
  if (!bill) return null;
  return {
    session: bill.session,
    orders: bill.orders,
    totals: bill.totals,
  };
}

function tableKey(tableNumber) {
  return normalizeTableNumber(tableNumber);
}

function syntheticBillFromOrders(orders, itemsByOrder, table) {
  const first = orders[0] || {};
  const billed = orders.map((o) => ({
    ...o,
    items: itemsByOrder[o.id] || [],
  }));
  const totals = billed.reduce(
    (acc, o) => {
      acc.subtotal += Number(o.subtotal || 0);
      acc.tax_amount += Number(o.tax_amount || 0);
      acc.total_amount += Number(o.total_amount || 0);
      acc.order_count += 1;
      return acc;
    },
    { subtotal: 0, tax_amount: 0, total_amount: 0, order_count: 0 },
  );
  return {
    session: {
      id: first.table_session_id || `order-${first.id}`,
      customer_name: first.customer_name,
      customer_phone: first.customer_phone,
      table_number: table?.table_number || first.table_number,
      status: "open",
      opened_at: first.created_at,
    },
    orders: billed,
    totals,
  };
}

/** GET /api/restaurants/:id/floor-tables — catalog + open bills for staff floor view */
router.get("/restaurants/:id/floor-tables", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const restaurantId = req.params.id;
    try {
      const { reconcileReservationAvailability } = await import("../lib/tableReservationService.js");
      await reconcileReservationAvailability(knex, restaurantId);
    } catch (err) {
      console.warn("[floor-tables] reservation reconcile notice:", err?.message || err);
    }
    const familyIds = await resolveRestaurantFamilyIds(knex, restaurantId);

    const tables = await knex("restaurant_tables")
      .whereIn("restaurant_id", familyIds)
      .orderBy("table_number", "asc");

    const openSessions = await knex("table_sessions")
      .whereIn("restaurant_id", familyIds)
      .andWhere({ status: "open" })
      .orderBy("opened_at", "asc");

    const billsByTableId = new Map();
    const billsByNumber = new Map();
    const usedSessionIds = new Set();

    for (const session of openSessions) {
      const bill = serializeBill(await loadSessionBill(knex, session.id));
      if (!bill) continue;
      if (session.table_id) {
        if (!billsByTableId.has(session.table_id)) billsByTableId.set(session.table_id, []);
        billsByTableId.get(session.table_id).push(bill);
      }
      const key = tableKey(session.table_number);
      if (key) {
        if (!billsByNumber.has(key)) billsByNumber.set(key, []);
        billsByNumber.get(key).push(bill);
      }
    }

    const assignedOrderIds = new Set();
    for (const session of openSessions) {
      const sessionOrders = await knex("orders").where({ table_session_id: session.id }).select("id");
      sessionOrders.forEach((o) => assignedOrderIds.add(o.id));
    }

    const orphanOrders = await knex("orders")
      .whereIn("restaurant_id", familyIds)
      .where({ fulfillment_type: "dine_in" })
      .whereNotIn("status", ["cancelled", "delivered"])
      .where(function () {
        this.whereNotNull("table_id").orWhereNotNull("table_number");
      })
      .orderBy("created_at", "asc");

    const orphans = orphanOrders.filter((o) => !assignedOrderIds.has(o.id));
    const orphanIds = orphans.map((o) => o.id);
    const orphanItems = orphanIds.length
      ? await knex("order_items").whereIn("order_id", orphanIds).orderBy("created_at", "asc")
      : [];
    const itemsByOrder = {};
    for (const item of orphanItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }

    const orphanGroups = new Map();
    for (const order of orphans) {
      const key = order.table_id || `num:${tableKey(order.table_number)}`;
      if (!orphanGroups.has(key)) orphanGroups.set(key, []);
      orphanGroups.get(key).push(order);
    }
    for (const [key, group] of orphanGroups.entries()) {
      const table = tables.find((t) => t.id === group[0].table_id)
        || tables.find((t) => tableKey(t.table_number) === tableKey(group[0].table_number));
      const bill = syntheticBillFromOrders(group, itemsByOrder, table);
      if (table?.id) {
        if (!billsByTableId.has(table.id)) billsByTableId.set(table.id, []);
        billsByTableId.get(table.id).push(bill);
      }
      const numKey = tableKey(table?.table_number || group[0].table_number);
      if (numKey) {
        if (!billsByNumber.has(numKey)) billsByNumber.set(numKey, []);
        billsByNumber.get(numKey).push(bill);
      }
    }

    const floor = tables.map((table) => {
      const byId = billsByTableId.get(table.id) || [];
      const byNum = billsByNumber.get(tableKey(table.table_number)) || [];
      const merged = [];
      for (const bill of [...byId, ...byNum]) {
        const sid = bill.session?.id;
        if (!sid || usedSessionIds.has(sid)) continue;
        usedSessionIds.add(sid);
        merged.push(bill);
      }
      return {
        ...table,
        occupied: merged.length > 0,
        sessions: merged,
      };
    });

    const unmatched = [];
    for (const session of openSessions) {
      if (usedSessionIds.has(session.id)) continue;
      const bill = serializeBill(await loadSessionBill(knex, session.id));
      if (bill) {
        usedSessionIds.add(session.id);
        unmatched.push(bill);
      }
    }
    for (const [key, group] of orphanGroups.entries()) {
      const sid = group[0].table_session_id || `order-${group[0].id}`;
      if (usedSessionIds.has(sid)) continue;
      const table = tables.find((t) => t.id === group[0].table_id)
        || tables.find((t) => tableKey(t.table_number) === tableKey(group[0].table_number));
      if (table) continue;
      unmatched.push(syntheticBillFromOrders(group, itemsByOrder, null));
    }

    return res.json({
      tables: floor,
      unmatched_sessions: unmatched,
      summary: {
        total_tables: tables.filter((t) => t.is_active !== false).length,
        occupied: floor.filter((t) => t.occupied).length + unmatched.length,
        available: floor.filter((t) => t.is_active !== false && !t.occupied).length,
        open_bills: openSessions.length + orphanGroups.size,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/restaurants/:id/table-sessions */
router.get("/restaurants/:id/table-sessions", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const status = String(req.query.status || "open").toLowerCase();
    let q = knex("table_sessions").where({ restaurant_id: req.params.id });
    if (status !== "all") q = q.andWhere({ status });
    const sessions = await q.orderBy("opened_at", "desc");
    return res.json({ sessions });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/restaurants/:id/table-sessions/by-table */
router.get("/restaurants/:id/table-sessions/by-table", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const tableId = req.query.table_id && isValidUUID(String(req.query.table_id)) ? String(req.query.table_id) : null;
    const tableNumber = req.query.table_number ? String(req.query.table_number).trim() : null;
    const phone = req.query.phone ? String(req.query.phone).trim() : "";
    const phoneNorm = isPlaceholderPhone(phone) ? "" : normalizePhone(phone);

    const familyIds = await resolveRestaurantFamilyIds(knex, req.params.id);
    const openSessions = await findOpenSessionsForTable(knex, {
      restaurantId: req.params.id,
      restaurantIds: familyIds,
      tableId,
      tableNumber,
    });

    const matched = phoneNorm
      ? openSessions.filter((s) => s.customer_phone_normalized === phoneNorm || !s.customer_phone_normalized)
      : openSessions;

    const bills = [];
    for (const session of matched) {
      const bill = await loadSessionBill(knex, session.id);
      if (bill) bills.push(serializeBill(bill));
    }
    return res.json({ sessions: bills });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/table-sessions/:id */
router.get("/table-sessions/:id", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const bill = await loadSessionBill(knex, req.params.id);
    if (!bill) return res.status(404).json({ error: "Table session not found" });
    return res.json(serializeBill(bill));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/restaurants/:id/close-table — free a table after the bill is paid */
router.post("/restaurants/:id/close-table", optionalAuth, requireAuth, async (req, res) => {
  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const tableId = req.body?.table_id && isValidUUID(String(req.body.table_id)) ? String(req.body.table_id) : null;
    const tableNumber = req.body?.table_number ? String(req.body.table_number).trim() : null;
    const orderIds = Array.isArray(req.body?.order_ids) ? req.body.order_ids.filter((id) => isValidUUID(String(id))) : [];
    if (!tableId && !tableNumber && !orderIds.length) {
      await trx.rollback();
      return res.status(400).json({ error: "Table or orders are required" });
    }
    const result = await closeTableByIdentity(trx, {
      restaurantId: req.params.id,
      tableId,
      tableNumber,
      orderIds,
      closedBy: req.user?.id,
    });
    await trx.commit();
    return res.json({ success: true, ...result });
  } catch (e) {
    await trx.rollback();
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/table-sessions/:id/close */
router.post("/table-sessions/:id/close", optionalAuth, requireAuth, async (req, res) => {
  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const existing = await trx("table_sessions").where({ id: req.params.id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: "Table session not found" });
    }
    const session = await closeTableSession(trx, req.params.id, req.user?.id);
    await trx.commit();
    const knexFresh = getKnex();
    const bill = await loadSessionBill(knexFresh, session.id);
    return res.json({ success: true, ...serializeBill(bill) });
  } catch (e) {
    await trx.rollback();
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/restaurants/:id/staff-orders */
router.post("/restaurants/:id/staff-orders", optionalAuth, requireAuth, async (req, res) => {
  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const restaurantId = req.params.id;
    const {
      customer_name,
      customer_phone,
      customer_email,
      delivery_address,
      notes,
      fulfillment_type = "dine_in",
      table_id,
      table_number,
      payment_method = "cash",
      payment_status = "unpaid",
      lines,
    } = req.body || {};

    const isDineIn = String(fulfillment_type).toLowerCase() === "dine_in";
    const isPickup = String(fulfillment_type).toLowerCase() === "pickup";

    if (!customer_name || !String(customer_name).trim()) {
      await trx.rollback();
      return res.status(400).json({ error: "Customer name is required" });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      await trx.rollback();
      return res.status(400).json({ error: "Add at least one item" });
    }
    if (isDineIn && !table_id && !table_number) {
      await trx.rollback();
      return res.status(400).json({ error: "Select a table number for dine-in orders" });
    }

    const rest = await trx("restaurants").where({ id: restaurantId }).first();
    if (!rest) {
      await trx.rollback();
      return res.status(404).json({ error: "Restaurant not found" });
    }

    let session = null;
    if (isDineIn) {
      session = await findOrCreateTableSession(trx, {
        restaurantId,
        tableId: table_id && isValidUUID(table_id) ? table_id : null,
        tableNumber: table_number,
        customerName: customer_name,
        customerPhone: customer_phone,
        createdBy: req.user.id,
        source: "staff",
      });
    }

    const subtotal = lines.reduce((s, l) => s + Number(l.line_total ?? Number(l.unit_price || 0) * Number(l.quantity || 1)), 0);
    const taxAmount = Number(req.body.tax_amount) || 0;
    const deliveryFee = isDineIn || isPickup ? 0 : Number(req.body.delivery_fee) || 0;
    const totalAmount = Number(req.body.total_amount) || subtotal + taxAmount + deliveryFee;

    const effectivePhone = !isPlaceholderPhone(customer_phone)
      ? String(customer_phone).trim()
      : session?.customer_phone || "";
    if (isDineIn && !effectivePhone && !session?.customer_phone) {
      // Staff may take a first order without a phone; keep blank so QR can attach later.
    }

    const tableNumber = session?.table_number || (table_number ? String(table_number).trim() : null);
    const orderNumber = await nextOrderNumber(trx, restaurantId);
    const trackingCode = "TRK-" + Math.random().toString(36).substring(2, 8).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const [order] = await trx("orders")
      .insert({
        restaurant_id: restaurantId,
        order_number: orderNumber,
        tracking_code: trackingCode,
        customer_name: String(customer_name).trim(),
        customer_phone: effectivePhone || (tableNumber ? `Table ${tableNumber}` : "Walk-in Guest"),
        customer_email: customer_email ? String(customer_email).trim() : null,
        delivery_address: isDineIn
          ? `Dine-in (Table ${tableNumber || "Assigned"})`
          : delivery_address || (isPickup ? "Self Pickup" : ""),
        delivery_notes: notes || null,
        fulfillment_type: isDineIn ? "dine_in" : isPickup ? "pickup" : "delivery",
        table_id: session?.table_id || (table_id && isValidUUID(table_id) ? table_id : null),
        table_number: tableNumber,
        table_session_id: session?.id || null,
        taken_by: req.user.id,
        notes: notes || null,
        source: "staff",
        status: "pending",
        payment_method: payment_method || "cash",
        payment_status: payment_status === "paid" ? "paid" : "pending",
        subtotal,
        tax_amount: taxAmount,
        delivery_fee: deliveryFee,
        discount_amount: 0,
        total_amount: totalAmount,
        auto_assigned: isDineIn || isPickup,
        assignment_status: "assigned",
      })
      .returning("*");

    await trx("order_items").insert(
      lines.map((l) => ({
        order_id: order.id,
        menu_item_id: l.menu_item_id && isValidUUID(l.menu_item_id) ? l.menu_item_id : null,
        item_name: l.item_name || "Item",
        quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0,
        line_total: Number(l.line_total) || Number(l.unit_price || 0) * Number(l.quantity || 1),
        notes: l.notes || null,
      })),
    );

    await trx.commit();
    const knexFresh = getKnex();
    notifyNewOrderLater(knexFresh, order);
    const bill = session ? await loadSessionBill(knexFresh, session.id) : null;
    return res.status(201).json({ order, session, bill: serializeBill(bill) });
  } catch (e) {
    await trx.rollback();
    console.error("staff-orders error:", e);
    return res.status(500).json({ error: e.message || "Failed to create order" });
  }
});

/** GET /api/staff/dashboard */
router.get("/staff/dashboard", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const restaurantId = req.query.restaurant_id ? String(req.query.restaurant_id) : null;
    const familyIds = restaurantId ? await resolveRestaurantFamilyIds(knex, restaurantId) : [];

    let takenQ = knex("orders").where({ taken_by: req.user.id }).whereNot({ status: "cancelled" });
    if (familyIds.length) takenQ = takenQ.whereIn("restaurant_id", familyIds);
    else if (restaurantId) takenQ = takenQ.andWhere({ restaurant_id: restaurantId });
    const orders = await takenQ.orderBy("created_at", "desc");

    let dineInQ = knex("orders")
      .where({ fulfillment_type: "dine_in" })
      .whereNotIn("status", ["cancelled", "delivered"]);
    if (familyIds.length) dineInQ = dineInQ.whereIn("restaurant_id", familyIds);
    else if (restaurantId) dineInQ = dineInQ.andWhere({ restaurant_id: restaurantId });
    const dineInOrders = await dineInQ.orderBy("created_at", "desc");

    const recentMap = new Map();
    for (const o of [...dineInOrders, ...orders]) {
      if (!recentMap.has(o.id)) recentMap.set(o.id, o);
    }
    const recentOrders = [...recentMap.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 15);

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => new Date(o.created_at) >= start);
    const sum = (list) => list.reduce((s, o) => s + Number(o.total_amount || 0), 0);

    let openTablesQ = knex("table_sessions").where({ status: "open" });
    if (familyIds.length) openTablesQ = openTablesQ.whereIn("restaurant_id", familyIds);
    else if (restaurantId) openTablesQ = openTablesQ.andWhere({ restaurant_id: restaurantId });
    const openSessions = await openTablesQ;

    return res.json({
      today_orders: todayOrders.length,
      today_revenue: sum(todayOrders),
      total_orders: orders.length,
      total_revenue: sum(orders),
      open_tables: openSessions.length,
      recent_orders: recentOrders,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
