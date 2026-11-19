import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getKnex } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  getOccupiedDiningTableIds,
  diningOccupancyBlocksSlot,
  localDateStr,
  timeToMins,
  reconcileReservationAvailability,
} from "../lib/tableReservationService.js";
import { notifyNewReservationLater } from "../lib/orderAlerts.js";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === "string" && UUID_REGEX.test(str);
}

// ─────────────────────────────────────────────────────────
// RESTAURANT TABLES (the physical table catalog)
// ─────────────────────────────────────────────────────────

/** GET /api/restaurants/:id/tables */
router.get("/restaurants/:id/tables", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const tables = await knex("restaurant_tables")
      .where({ restaurant_id: req.params.id })
      .orderBy("table_number", "asc");
    return res.json({ tables });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/restaurants/:id/tables */
router.post("/restaurants/:id/tables", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { table_number, capacity, location, notes } = req.body || {};
    if (!table_number) return res.status(400).json({ error: "table_number is required" });
    if (!capacity || Number(capacity) < 1) return res.status(400).json({ error: "capacity must be >= 1" });

    const [row] = await knex("restaurant_tables")
      .insert({
        id: randomUUID(),
        restaurant_id: req.params.id,
        table_number: String(table_number).trim(),
        capacity: Number(capacity),
        location: location ? String(location).trim() : null,
        notes: notes || null,
      })
      .returning("*");
    return res.status(201).json({ table: row });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A table with that number already exists." });
    return res.status(500).json({ error: e.message });
  }
});

/** PATCH /api/tables/:tableId */
router.patch("/tables/:tableId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { table_number, capacity, location, is_active, notes } = req.body || {};
    const updates = {};
    if (table_number !== undefined) updates.table_number = String(table_number).trim();
    if (capacity !== undefined) updates.capacity = Number(capacity);
    if (location !== undefined) updates.location = location ? String(location).trim() : null;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (notes !== undefined) updates.notes = notes || null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });
    updates.updated_at = new Date();
    const [row] = await knex("restaurant_tables").where({ id: req.params.tableId }).update(updates).returning("*");
    return res.json({ table: row });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/tables/:tableId */
router.delete("/tables/:tableId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    await knex("restaurant_tables").where({ id: req.params.tableId }).update({ is_active: false, updated_at: new Date() });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────
// TABLE RESERVATIONS
// ─────────────────────────────────────────────────────────

/** GET /api/restaurants/:id/reservations */
router.get("/restaurants/:id/reservations", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { date, status } = req.query;
    try {
      await reconcileReservationAvailability(knex, req.params.id);
    } catch (err) {
      console.warn("[reservations] reconcile notice:", err?.message || err);
    }
    const children = await knex("restaurants").where({ parent_restaurant_id: req.params.id }).select("id");
    const restaurantIds = [req.params.id, ...children.map((row) => row.id)];
    let q = knex("table_reservations")
      .leftJoin("restaurant_tables", "table_reservations.table_id", "restaurant_tables.id")
      .leftJoin("calls", "table_reservations.call_id", "calls.id")
      .whereIn("table_reservations.restaurant_id", restaurantIds)
      .select(
        "table_reservations.*",
        "restaurant_tables.table_number",
        "restaurant_tables.capacity as table_capacity",
        "restaurant_tables.location as table_location",
        "calls.transcript as call_transcript",
        "calls.recording_url as call_recording_url",
        "calls.notes as call_notes",
        "calls.duration_seconds as call_duration_seconds"
      )
      .orderBy(["reservation_date", "start_time"]);
    if (date) q = q.where("table_reservations.reservation_date", date);
    if (status) q = q.where("table_reservations.status", status);
    const reservations = await q;
    return res.json({ reservations });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/restaurants/:id/reservations */
router.post("/restaurants/:id/reservations", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const {
      table_id, customer_name, customer_phone, customer_email,
      party_size, reservation_date, start_time, slot_duration_hours = 1, notes, status
    } = req.body || {};
    if (!customer_name || !reservation_date || !start_time || !party_size) {
      return res.status(400).json({ error: "customer_name, reservation_date, start_time, and party_size are required" });
    }
    const [row] = await knex("table_reservations")
      .insert({
        id: randomUUID(),
        restaurant_id: req.params.id,
        table_id: table_id && isValidUUID(table_id) ? table_id : null,
        customer_name: String(customer_name).trim(),
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        party_size: Number(party_size),
        reservation_date,
        start_time,
        slot_duration_hours: Number(slot_duration_hours),
        status: status || "confirmed",
        notes: notes || null,
        source: "online",
      })
      .returning("*");
    let tableNumber = null;
    if (row.table_id) {
      const table = await knex("restaurant_tables").where({ id: row.table_id }).select("table_number").first();
      tableNumber = table?.table_number || null;
    }
    notifyNewReservationLater(knex, row, { table_number: tableNumber });
    return res.status(201).json({ reservation: row });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** PATCH /api/reservations/:id */
router.patch("/reservations/:id", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const allowed = ["table_id", "customer_name", "customer_phone", "customer_email",
      "party_size", "reservation_date", "start_time", "slot_duration_hours", "status", "notes"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date();
    const [row] = await knex("table_reservations").where({ id: req.params.id }).update(updates).returning("*");
    return res.json({ reservation: row });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/reservations/:id */
router.delete("/reservations/:id", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    await knex("table_reservations").where({ id: req.params.id }).update({ status: "cancelled", updated_at: new Date() });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/restaurants/:id/reservations/availability
 *  Query: date, party_size, slot_duration_hours
 */
router.get("/restaurants/:id/reservations/availability", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { date, party_size = 1, slot_duration_hours = 1 } = req.query;
    if (!date) return res.status(400).json({ error: "date query param is required" });

    const tables = await knex("restaurant_tables")
      .where({ restaurant_id: req.params.id, is_active: true })
      .where("capacity", ">=", Number(party_size))
      .orderBy("capacity", "asc");

    try {
      await reconcileReservationAvailability(knex, req.params.id);
    } catch (err) {
      console.warn("[reservations] reconcile notice:", err?.message || err);
    }

    const diningOccupied = String(date) === localDateStr()
      ? await getOccupiedDiningTableIds(knex, req.params.id)
      : new Set();

    const existing = await knex("table_reservations")
      .where({ restaurant_id: req.params.id, reservation_date: date })
      .whereIn("status", ["pending", "confirmed", "seated"])
      .whereIn("table_id", tables.map((t) => t.id))
      .select("table_id", "start_time", "slot_duration_hours");

    const busyMap = {};
    for (const r of existing) {
      if (!busyMap[r.table_id]) busyMap[r.table_id] = [];
      busyMap[r.table_id].push({
        s: timeToMins(r.start_time),
        e: timeToMins(r.start_time) + Number(r.slot_duration_hours) * 60,
      });
    }

    // Generate half-hour slots from 09:00 to 22:00
    const slots = [];
    const durationHours = Number(slot_duration_hours) || 1;
    const duration = durationHours * 60;
    for (let start = 9 * 60; start + duration <= 22 * 60; start += 30) {
      const slotEnd = start + duration;
      const h = Math.floor(start / 60).toString().padStart(2, "0");
      const m = (start % 60).toString().padStart(2, "0");
      const slotTime = `${h}:${m}`;
      const occupyBlocks = diningOccupied.size > 0 && diningOccupancyBlocksSlot(slotTime, durationHours);
      const availTables = tables.filter((t) => {
        if (occupyBlocks && diningOccupied.has(t.id)) return false;
        const busy = busyMap[t.id] || [];
        return !busy.some(({ s, e }) => start < e && slotEnd > s);
      });
      slots.push({ time: slotTime, available: availTables.length > 0, available_tables: availTables.length });
    }

    return res.json({ date, party_size: Number(party_size), slot_duration_hours: Number(slot_duration_hours), slots, tables });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
