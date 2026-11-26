import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getKnex } from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { checkPermission } from "../middleware/checkPermission.js";

const router = Router();

async function assertRestaurantAccess(req, res, restaurantId) {
  if (!restaurantId) return res.status(404).json({ error: "Not found" });
  const roles = req.user?.roles ?? [];
  if (roles.includes("super_admin") || roles.includes("admin")) return null;

  const allowed = req.user?.restaurantIds ?? [];
  if (allowed.includes(restaurantId)) return null;

  const directMemberIds = req.user?.directMemberIds ?? [];
  if (directMemberIds.length) {
    const knex = getKnex();
    const row = await knex("restaurants").where({ id: restaurantId }).select("parent_restaurant_id").first();
    if (row?.parent_restaurant_id && directMemberIds.includes(row.parent_restaurant_id)) return null;
  }

  return res.status(403).json({ error: "Forbidden – not a member of this restaurant" });
}

async function getWaitingListEntryWithAccess(req, res, id) {
  const knex = getKnex();
  const row = await knex("waiting_list").where({ id }).first();
  if (!row) return { error: res.status(404).json({ error: "Waiting list entry not found" }) };
  const denied = await assertRestaurantAccess(req, res, row.restaurant_id);
  if (denied) return { error: denied };
  return { row };
}

/** GET /api/restaurants/:id/waiting-list */
router.get(
  "/restaurants/:id/waiting-list",
  optionalAuth, requireAuth,
  checkPermission("waiting_list.manage"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      const status = req.query.status || "waiting";
      let q = knex("waiting_list")
        .where({ restaurant_id: req.params.id })
        .orderBy("created_at", "asc");
      if (status !== "all") {
        q = q.where({ status });
      }
      const list = await q;
      return res.json({ list });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** POST /api/restaurants/:id/waiting-list */
router.post(
  "/restaurants/:id/waiting-list",
  optionalAuth, requireAuth,
  checkPermission("waiting_list.manage"),
  async (req, res) => {
    const denied = await assertRestaurantAccess(req, res, req.params.id);
    if (denied) return denied;
    try {
      const knex = getKnex();
      const { guest_name, phone, party_size = 1, quoted_wait_minutes } = req.body || {};
      if (!party_size || Number(party_size) < 1) {
        return res.status(400).json({ error: "party_size must be at least 1" });
      }
      const [row] = await knex("waiting_list")
        .insert({
          id: randomUUID(),
          restaurant_id: req.params.id,
          guest_name: (guest_name && String(guest_name).trim()) || "Guest",
          phone: phone || null,
          party_size: Number(party_size),
          quoted_wait_minutes: quoted_wait_minutes ? Number(quoted_wait_minutes) : null,
          status: "waiting",
        })
        .returning("*");
      return res.status(201).json({ entry: row });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** PATCH /api/waiting-list/:id */
router.patch(
  "/waiting-list/:id",
  optionalAuth, requireAuth,
  checkPermission("waiting_list.manage"),
  async (req, res) => {
    const { row, error } = await getWaitingListEntryWithAccess(req, res, req.params.id);
    if (error) return error;
    try {
      const knex = getKnex();
      const allowedFields = ["guest_name", "phone", "party_size", "quoted_wait_minutes", "status", "notified_at"];
      const updates = {};
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }
      updates.updated_at = new Date();
      const [updated] = await knex("waiting_list")
        .where({ id: row.id })
        .update(updates)
        .returning("*");
      return res.json({ entry: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/** DELETE /api/waiting-list/:id */
router.delete(
  "/waiting-list/:id",
  optionalAuth, requireAuth,
  checkPermission("waiting_list.manage"),
  async (req, res) => {
    const { row, error } = await getWaitingListEntryWithAccess(req, res, req.params.id);
    if (error) return error;
    try {
      const knex = getKnex();
      const [updated] = await knex("waiting_list")
        .where({ id: row.id })
        .update({ status: "removed", updated_at: new Date() })
        .returning("*");
      return res.json({ success: true, entry: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

export default router;
