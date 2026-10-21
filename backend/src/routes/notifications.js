import { Router } from "express";
import { getKnex } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { randomUUID } from "crypto";
import { resolveRestaurantFamilyIds } from "../lib/tableSessions.js";

const router = Router();

const CALL_AGENT_SOURCES = new Set(["phone", "call", "voice", "ai", "synthflow", "elevenlabs"]);

/** Parent HQ sees parent + all branches; a branch only sees itself. */
async function restaurantIdsForNotificationScope(knex, restaurantId) {
  if (!restaurantId) return [];
  const rest = await knex("restaurants")
    .where({ id: restaurantId })
    .select("id", "parent_restaurant_id", "is_branch")
    .first();
  if (!rest) return [restaurantId];
  const isBranch = Boolean(rest.is_branch || rest.parent_restaurant_id);
  if (isBranch) return [restaurantId];
  return resolveRestaurantFamilyIds(knex, restaurantId);
}

function readMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) || {};
    } catch {
      return {};
    }
  }
  return metadata;
}

function isCallAgentSource(source) {
  return CALL_AGENT_SOURCES.has(String(source || "").trim().toLowerCase());
}

function isTableDiningAlert(fulfillment, title, message) {
  const ft = String(fulfillment || "").trim().toLowerCase().replace(/-/g, "_");
  if (ft === "dine_in") return true;
  if (ft === "pickup" || ft === "delivery") return false;
  const text = `${title || ""} ${message || ""}`.toLowerCase();
  if (text.includes("pickup") || text.includes("delivery")) return false;
  if (text.includes("dine-in") || text.includes("dine in") || text.includes("table")) return true;
  return false;
}

function isFloorStaffOnly(roles) {
  const list = roles || [];
  if (!list.includes("staff")) return false;
  return !list.some((role) =>
    ["kitchen", "chef", "admin", "manager", "super_admin"].includes(role),
  );
}

/**
 * Helper to dispatch in-app notifications
 */
export async function createNotification(knex, {
  restaurant_id,
  user_id = null,
  order_id = null,
  type = "info",
  title,
  message,
  metadata = {}
}) {
  try {
    const id = randomUUID();
    const [notif] = await knex("notifications")
      .insert({
        id,
        restaurant_id: restaurant_id || null,
        user_id: user_id || null,
        order_id: order_id || null,
        type,
        title,
        message,
        // jsonb column — pass object (stringify would double-encode)
        metadata: metadata || {},
        is_read: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    return notif;
  } catch (err) {
    console.error("Failed to create notification:", err);
    return null;
  }
}

/**
 * GET /api/notifications
 * Fetch notifications for caller's active restaurant or user
 */
router.get("/", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { restaurant_id, limit = 50, unread_only } = req.query;

    let q = knex("notifications as n")
      .leftJoin("orders as o", "o.id", "n.order_id")
      .select(
        "n.*",
        "o.source as order_source",
        "o.call_id as order_call_id",
        "o.fulfillment_type as order_fulfillment_type",
      )
      .orderBy("n.created_at", "desc")
      .limit(Math.min(parseInt(limit, 10) || 50, 100));

    if (restaurant_id) {
      const scopeIds = await restaurantIdsForNotificationScope(knex, String(restaurant_id));
      q = q.whereIn("n.restaurant_id", scopeIds.length ? scopeIds : [String(restaurant_id)]);
    } else if (req.user?.restaurantIds?.length) {
      q = q.whereIn("n.restaurant_id", req.user.restaurantIds);
    } else {
      q = q.where("n.user_id", req.user.id);
    }

    if (unread_only === "true" || unread_only === "1") {
      q = q.where("n.is_read", false);
    }

    const hideCallOrdersFromStaff = isFloorStaffOnly(req.user?.roles);
    const notifications = (await q)
      .map((row) => {
        const { order_source, order_call_id, order_fulfillment_type, ...notif } = row;
        const meta = readMetadata(notif.metadata);
        if (!meta.source && order_source) meta.source = order_source;
        if (!meta.fulfillment_type && order_fulfillment_type) meta.fulfillment_type = order_fulfillment_type;
        if (order_call_id) meta.call_id = order_call_id;
        return { ...notif, metadata: meta, order_source, order_call_id, order_fulfillment_type };
      })
      .filter((row) => {
        if (!hideCallOrdersFromStaff) return true;
        const meta = readMetadata(row.metadata);
        if (row.type === "new_reservation" || meta.source === "reservation") return false;
        if (row.order_call_id || isCallAgentSource(row.order_source) || isCallAgentSource(meta.source)) {
          return false;
        }
        return isTableDiningAlert(
          meta.fulfillment_type || row.order_fulfillment_type,
          row.title,
          row.message,
        );
      })
      .map(({ order_source, order_call_id, order_fulfillment_type, ...notif }) => notif);

    // Count unread
    let unreadCountQ = knex("notifications").where("is_read", false);
    if (restaurant_id) {
      const scopeIds = await restaurantIdsForNotificationScope(knex, String(restaurant_id));
      unreadCountQ = unreadCountQ.whereIn(
        "restaurant_id",
        scopeIds.length ? scopeIds : [String(restaurant_id)],
      );
    } else if (req.user?.restaurantIds?.length) {
      unreadCountQ = unreadCountQ.whereIn("restaurant_id", req.user.restaurantIds);
    } else {
      unreadCountQ = unreadCountQ.where("user_id", req.user.id);
    }

    const [{ count: unreadCount }] = await unreadCountQ.count("* as count");

    return res.json({
      notifications,
      unread_count: Number(unreadCount || 0),
    });
  } catch (err) {
    console.error("GET /notifications error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch notifications" });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read
 */
router.post("/:id/read", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { id } = req.params;

    await knex("notifications")
      .where({ id })
      .update({ is_read: true, updated_at: new Date() });

    return res.json({ success: true, id });
  } catch (err) {
    console.error("POST /notifications/:id/read error:", err);
    return res.status(500).json({ error: err.message || "Failed to mark notification as read" });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for current restaurant / user
 */
router.post("/read-all", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body;

    let q = knex("notifications").where("is_read", false);
    if (restaurant_id) {
      const scopeIds = await restaurantIdsForNotificationScope(knex, String(restaurant_id));
      q = q.whereIn("restaurant_id", scopeIds.length ? scopeIds : [String(restaurant_id)]);
    } else if (req.user?.restaurantIds?.length) {
      q = q.whereIn("restaurant_id", req.user.restaurantIds);
    } else {
      q = q.where("user_id", req.user.id);
    }

    await q.update({ is_read: true, updated_at: new Date() });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /notifications/read-all error:", err);
    return res.status(500).json({ error: err.message || "Failed to mark all notifications as read" });
  }
});

export default router;
