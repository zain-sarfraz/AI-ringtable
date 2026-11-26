import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getKnex } from "../db.js";
import { notifyNewReservationLater } from "../lib/orderAlerts.js";
import {
  diningOccupancyBlocksSlot,
  getOccupiedDiningTableIds,
  localDateStr,
  reconcileReservationAvailability,
  timeToMins,
  toDateOnlyString,
  toTimeOnlyString,
} from "../lib/tableReservationService.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { checkPermission, resolveRole } from "../middleware/checkPermission.js";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === "string" && UUID_REGEX.test(str);
}

// ─────────────────────────────────────────────────────────
// OWNERSHIP HELPER
// ─────────────────────────────────────────────────────────

/**
 * Assert that restaurantId belongs to the caller's accessible restaurants.
 * Uses the same branch-aware set that GET /reservations already uses
 * (req.user.restaurantIds is built by optionalAuth with parent+branch expansion).
 *
 * Returns 403 if not a member, 404 if the row was not found.
 * Returns the row on success so callers can avoid a second DB round-trip.
 */
async function assertRestaurantAccess(req, res, restaurantId) {
  if (!restaurantId) return res.status(404).json({ error: "Not found" });
  const roles = req.user?.roles ?? [];
  // super_admin and admin: unrestricted
  if (roles.includes("super_admin") || roles.includes("admin")) return null;

  const allowed = req.user?.restaurantIds ?? [];
  if (allowed.includes(restaurantId)) return null;

  // Manager whose direct membership is on a parent: check if restaurantId is a child
  const directMemberIds = req.user?.directMemberIds ?? [];
}

/**
 * Fetch a table row and check the caller owns its restaurant.
 * Returns { error: response } on failure or { row } on success.
 */
async function getTableWithAccess(req, res, tableId) {
  const knex = getKnex();
  const row = await knex("restaurant_tables").where({ id: tableId }).first();
  if (!row) return { error: res.status(404).json({ error: "Table not found" }) };
  const denied = await assertRestaurantAccess(req, res, row.restaurant_id);
  if (denied) return { error: denied };
  return { row };
}

/**
 * Fetch a reservation row and check the caller owns its restaurant.
 * Returns { error: response } on failure or { row } on success.
 */
async function getReservationWithAccess(req, res, reservationId) {
  const knex = getKnex();
  const row = await knex("table_reservations").where({ id: reservationId }).first();
  if (!row) return { error: res.status(404).json({ error: "Reservation not found" }) };
  const denied = await assertRestaurantAccess(req, res, row.restaurant_id);
  if (denied) return { error: denied };
  return { row };
}

// ─────────────────────────────────────────────────────────
// RESTAURANT TABLES (the physical table catalog)
// ─────────────────────────────────────────────────────────

/** GET /api/restaurants/:id/tables */
router.get(
  "/restaurants/:id/tables",
  optionalAuth, requireAuth,
  checkPermission("tables.view"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      try {
        await reconcileReservationAvailability(knex, req.params.id);
      } catch (err) {
        console.warn("[tables] reconcile notice:", err?.message || err);
      }
      const tables = await knex("restaurant_tables")
        .where({ restaurant_id: req.params.id })
        .orderBy("table_number", "asc");

      const occupiedSet = await getOccupiedDiningTableIds(knex, req.params.id);

      const today = localDateStr();
      const todayRes = await knex("table_reservations")
        .where({ restaurant_id: req.params.id })
        .whereRaw("reservation_date::date = ?::date", [today])
        .whereIn("status", ["pending", "confirmed", "seated"])
        .select("table_id", "status");

      const reservedTableIds = new Set();
      const seatedResTableIds = new Set();
      for (const r of todayRes) {
        if (!r.table_id) continue;
        if (r.status === "seated") {
          seatedResTableIds.add(r.table_id);
        } else if (r.status === "confirmed" || r.status === "pending") {
          reservedTableIds.add(r.table_id);
        }
      }

      const enriched = tables.map((t) => {
        const isOccupied = occupiedSet.has(t.id) || seatedResTableIds.has(t.id);
        let status = "available";
        if (isOccupied) {
          status = "occupied";
        } else if (t.cleaning_since) {
          status = "cleaning";
        } else if (reservedTableIds.has(t.id)) {
          status = "reserved";
        }
        return {
          ...t,
          occupied: isOccupied,
          status,
        };
      });

      return res.json({ tables: enriched });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** POST /api/restaurants/:id/tables — requires tables.manage (receptionist blocked) */
router.post(
  "/restaurants/:id/tables",
  optionalAuth, requireAuth,
  checkPermission("tables.manage"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
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
  }
);

/** PATCH /api/tables/:tableId — requires tables.manage (receptionist blocked) */
router.patch(
  "/tables/:tableId",
  optionalAuth, requireAuth,
  checkPermission("tables.manage"),
  async (req, res) => {
    const { row, error } = await getTableWithAccess(req, res, req.params.tableId);
    if (error) return error;
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
      const [updated] = await knex("restaurant_tables").where({ id: row.id }).update(updates).returning("*");
      return res.json({ table: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** DELETE /api/tables/:tableId — requires tables.manage (receptionist blocked) */
router.delete(
  "/tables/:tableId",
  optionalAuth, requireAuth,
  checkPermission("tables.manage"),
  async (req, res) => {
    const { row, error } = await getTableWithAccess(req, res, req.params.tableId);
    if (error) return error;
    try {
      const knex = getKnex();
      await knex("restaurant_tables")
        .where({ id: row.id })
        .update({ is_active: false, updated_at: new Date() });
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

// ─────────────────────────────────────────────────────────
// TABLE STATUS (cleaning endpoint — receptionist only via tables.update_status)
// ─────────────────────────────────────────────────────────

/**
 * PATCH /api/tables/:tableId/status
 * Body: { status: 'cleaning' | 'available' }
 * Requires tables.update_status (receptionist has it; manager/admin pass through).
 * 'cleaning' → sets cleaning_since = now()
 * 'available' → sets cleaning_since = NULL
 */
router.patch(
  "/tables/:tableId/status",
  optionalAuth, requireAuth,
  checkPermission("tables.update_status"),
  async (req, res) => {
    const { row, error } = await getTableWithAccess(req, res, req.params.tableId);
    if (error) return error;
    const { status } = req.body || {};
    if (!["cleaning", "available"].includes(status)) {
      return res.status(400).json({ error: "status must be 'cleaning' or 'available'" });
    }
    try {
      const knex = getKnex();
      const [updated] = await knex("restaurant_tables")
        .where({ id: row.id })
        .update({
          cleaning_since: status === "cleaning" ? new Date() : null,
          updated_at: new Date(),
        })
        .returning("*");
      return res.json({ table: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

// ─────────────────────────────────────────────────────────
// TABLE RESERVATIONS
// ─────────────────────────────────────────────────────────

/** GET /api/restaurants/:id/reservations */
router.get(
  "/restaurants/:id/reservations",
  optionalAuth, requireAuth,
  checkPermission("reservations.view"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      const { date, status } = req.query;
      try {
        await reconcileReservationAvailability(knex, req.params.id);
      } catch (err) {
        console.warn("[reservations] reconcile notice:", err?.message || err);
      }
      const children = await knex("restaurants").where({ parent_restaurant_id: req.params.id }).select("id");
      const restaurantIds = [req.params.id, ...children.map((r) => r.id)];
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
      if (date) q = q.whereRaw("table_reservations.reservation_date::date = ?::date", [String(date)]);
      if (status) q = q.where("table_reservations.status", status);
      const rows = await q;
      const reservations = rows.map((r) => ({
        ...r,
        reservation_date: toDateOnlyString(r.reservation_date) || r.reservation_date,
        start_time: toTimeOnlyString(r.start_time) || r.start_time,
        status: String(r.status || "").toLowerCase(),
      }));
      return res.json({ reservations });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** POST /api/restaurants/:id/reservations */
router.post(
  "/restaurants/:id/reservations",
  optionalAuth, requireAuth,
  checkPermission("reservations.create"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      const {
        table_id, customer_name, customer_phone, customer_email,
        party_size, reservation_date, start_time, slot_duration_hours = 1, notes, status, source,
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
          source: source || "online",
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
  }
);

/** POST /api/restaurants/:id/walk-in */
router.post(
  "/restaurants/:id/walk-in",
  optionalAuth, requireAuth,
  checkPermission("walk_in.create"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      const { table_id, customer_name, customer_phone, party_size = 1, notes } = req.body || {};
      if (!table_id) return res.status(400).json({ error: "table_id is required" });

      const table = await knex("restaurant_tables")
        .where({ id: table_id, restaurant_id: req.params.id, is_active: true })
        .first();
      if (!table) return res.status(404).json({ error: "Table not found" });

      // Check if table is occupied
      const occupiedSet = await getOccupiedDiningTableIds(knex, req.params.id);
      if (occupiedSet.has(table.id)) {
        return res.status(409).json({ error: "Table is currently occupied" });
      }

      const today = localDateStr();
      const now = new Date();
      const nowH = String(now.getHours()).padStart(2, "0");
      const nowM = String(now.getMinutes()).padStart(2, "0");
      const currentTime = `${nowH}:${nowM}`;

      // Check if table already has an active seated reservation today
      const activeRes = await knex("table_reservations")
        .where({ table_id: table.id, restaurant_id: req.params.id })
        .whereRaw("reservation_date::date = ?::date", [today])
        .whereIn("status", ["seated"])
        .first();
      if (activeRes) {
        return res.status(409).json({ error: "Table already has an active seated guest" });
      }

      const [row] = await knex("table_reservations")
        .insert({
          id: randomUUID(),
          restaurant_id: req.params.id,
          table_id: table.id,
          customer_name: (customer_name && String(customer_name).trim()) || "Walk-in Guest",
          customer_phone: customer_phone || null,
          party_size: Number(party_size) || 1,
          reservation_date: today,
          start_time: currentTime,
          slot_duration_hours: 1,
          status: "seated",
          source: "walk_in",
          seated_at: now,
          notes: notes || null,
        })
        .returning("*");

      // Clear any cleaning_since on the table
      if (table.cleaning_since) {
        await knex("restaurant_tables")
          .where({ id: table.id })
          .update({ cleaning_since: null, updated_at: now });
      }

      return res.status(201).json({ reservation: row, table });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** PATCH /api/reservations/:id */
router.patch(
  "/reservations/:id",
  optionalAuth, requireAuth,
  async (req, res, next) => {
    // Permission depends on what is being changed:
    // status=seated → reservations.seat
    // status=no_show → reservations.mark_noshow
    // any other status change or field change → reservations.update
    const { status } = req.body || {};
    let permission = "reservations.update";
    if (status === "seated") permission = "reservations.seat";
    else if (status === "no_show") permission = "reservations.mark_noshow";
    return checkPermission(permission)(req, res, next);
  },
  async (req, res) => {
    const { row, error } = await getReservationWithAccess(req, res, req.params.id);
    if (error) return error;
    try {
      const knex = getKnex();
      const allowedFields = [
        "table_id", "customer_name", "customer_phone", "customer_email",
        "party_size", "reservation_date", "start_time", "slot_duration_hours", "status", "notes",
      ];
      const updates = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Audit timestamps
      const now = new Date();
      if (updates.status === "seated" && !row.seated_at) updates.seated_at = now;
      if (updates.status === "completed" && !row.completed_at) updates.completed_at = now;
      if (updates.status === "no_show") updates.no_show_reason = req.body.no_show_reason || null;
      updates.updated_at = now;

      const [updated] = await knex("table_reservations")
        .where({ id: row.id })
        .update(updates)
        .returning("*");

      // When a reservation completes, mark its table as cleaning
      if (updates.status === "completed" && updated.table_id) {
        await knex("restaurant_tables")
          .where({ id: updated.table_id })
          .update({ cleaning_since: now, updated_at: now });
      }

      // When a reservation is seated, clear cleaning_since on its table
      if (updates.status === "seated" && updated.table_id) {
        await knex("restaurant_tables")
          .where({ id: updated.table_id })
          .update({ cleaning_since: null, updated_at: now });
      }

      return res.json({ reservation: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** DELETE /api/reservations/:id — soft cancel */
router.delete(
  "/reservations/:id",
  optionalAuth, requireAuth,
  checkPermission("reservations.cancel"),
  async (req, res) => {
    const { row, error } = await getReservationWithAccess(req, res, req.params.id);
    if (error) return error;
    try {
      const knex = getKnex();
      const now = new Date();
      await knex("table_reservations").where({ id: row.id }).update({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: req.user.id,
        updated_at: now,
      });
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** GET /api/restaurants/:id/reservations/availability */
router.get(
  "/restaurants/:id/reservations/availability",
  optionalAuth, requireAuth,
  checkPermission("reservations.view"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
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
  }
);

export default router;
