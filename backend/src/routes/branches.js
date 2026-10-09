import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { getKnex } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { geocodeAddress } from "../lib/geocoding.js";
import { createNotification } from "./notifications.js";
import { pushBranchListToAgent } from "../lib/syncAgentBranches.js";

function refreshAgentBranches(knex, parentRestaurantId) {
  if (!parentRestaurantId) return;
  pushBranchListToAgent(knex, parentRestaurantId).catch((err) => {
    console.warn("Branch list sync to phone agent failed:", err.message);
  });
}

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === "string" && UUID_REGEX.test(str);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function columnsOf(db, table) {
  const result = await db.raw(
    `select column_name from information_schema.columns
     where table_name = ? and table_schema = any (current_schemas(false))`,
    [table],
  );
  return new Set((result.rows || []).map((row) => row.column_name));
}

function withExistingColumns(values, columns) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (columns.has(key)) out[key] = value;
  }
  return out;
}

/** Check if user can manage the given restaurant (parent or branch) */
async function canManageRestaurant(knex, user, restaurantId) {
  if (!user?.id || !isValidUUID(restaurantId)) return false;
  if (user.roles?.includes("super_admin")) return true;

  const target = await knex("restaurants").where({ id: restaurantId }).first();
  if (!target) return false;

  // Direct membership on this restaurant
  const directMembership = await knex("restaurant_members")
    .where({ restaurant_id: restaurantId, user_id: user.id })
    .whereIn("member_role", ["owner", "admin", "manager"])
    .first();
  if (directMembership) return true;

  // If this restaurant is a branch, check if user is owner/admin of parent restaurant
  if (target.is_branch && target.parent_restaurant_id) {
    const parentMembership = await knex("restaurant_members")
      .where({ restaurant_id: target.parent_restaurant_id, user_id: user.id })
      .whereIn("member_role", ["owner", "admin"])
      .first();
    if (parentMembership) return true;
  }

  return false;
}

/**
 * POST /api/restaurants/:parentId/branches
 * Create a new branch under parent restaurant
 */
router.post("/restaurants/:parentId/branches", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { parentId } = req.params;
    const knex = getKnex();

    if (!isValidUUID(parentId)) {
      return res.status(400).json({ error: "Invalid parent restaurant ID" });
    }

    const allowed = await canManageRestaurant(knex, req.user, parentId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized: You cannot add branches to this restaurant" });
    }

    const parent = await knex("restaurants").where({ id: parentId }).first();
    if (!parent) {
      return res.status(404).json({ error: "Parent restaurant not found" });
    }

    const { resolveRestaurantPlan } = await import("../billing/planFeatures.js");
    const planInfo = await resolveRestaurantPlan(knex, parentId);
    if (!planInfo.features.branches) {
      return res.status(403).json({
        error: "Branches are not included in the Starter plan. Upgrade to Growth or Pilot.",
        code: "plan_feature_locked",
        plan: planInfo.plan || "starter",
      });
    }

    const {
      name,
      address,
      latitude,
      longitude,
      service_radius_km,
      owner_email,
      owner_password,
      owner_full_name,
      phone,
      city,
      area,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Branch name is required" });
    }

    let lat = latitude != null && latitude !== "" ? Number(latitude) : null;
    let lng = longitude != null && longitude !== "" ? Number(longitude) : null;

    // Auto geocode address if lat/lng are missing
    if ((lat == null || lng == null) && address) {
      const geo = await geocodeAddress(address);
      if (geo) {
        lat = geo.latitude;
        lng = geo.longitude;
      }
    }

    const baseSlug = slugify(`${parent.slug || parent.name}-${name}`);
    let slug = baseSlug;
    let counter = 1;
    while (await knex("restaurants").where({ slug }).first()) {
      slug = `${baseSlug}-${counter++}`;
    }

    const radius = Number(service_radius_km) > 0 ? Number(service_radius_km) : 5.0;

    const result = await knex.transaction(async (trx) => {
      const restaurantColumns = await columnsOf(trx, "restaurants");
      const settingsColumns = await columnsOf(trx, "restaurant_settings");
      const categoryColumns = await columnsOf(trx, "menu_categories");
      const itemColumns = await columnsOf(trx, "menu_items");

      // 1. Insert branch into restaurants
      const [branch] = await trx("restaurants")
        .insert(
          withExistingColumns(
            {
              id: randomUUID(),
              name: String(name).trim(),
              slug,
              address: address ? String(address).trim() : null,
              city: city ? String(city).trim() : null,
              area: area ? String(area).trim() : null,
              phone: phone ? String(phone).trim() : parent.phone,
              parent_restaurant_id: parentId,
              is_branch: true,
              is_active: true,
              is_accepting_orders: true,
              latitude: Number.isFinite(lat) ? lat : null,
              longitude: Number.isFinite(lng) ? lng : null,
              service_radius_km: radius,
              allows_delivery: parent.allows_delivery ?? true,
              allows_pickup: parent.allows_pickup ?? true,
              commission_rate: parent.commission_rate ?? 0,
              logo_url: parent.logo_url || null,
              cover_image_url: parent.cover_image_url || null,
            },
            restaurantColumns,
          ),
        )
        .returning("*");

      // 2. Clone parent settings for branch defaults
      const parentSettings = await trx("restaurant_settings").where({ restaurant_id: parentId }).first();
      await trx("restaurant_settings").insert(
        withExistingColumns(
          {
            id: randomUUID(),
            restaurant_id: branch.id,
            name: branch.name,
            email: owner_email || parentSettings?.email || null,
            phone: branch.phone || parentSettings?.phone || null,
            address: branch.address || parentSettings?.address || null,
            currency: parentSettings?.currency || "USD",
            tax_rate: parentSettings?.tax_rate ?? 0,
            delivery_fee: parentSettings?.delivery_fee ?? 0,
            min_order_amount: parentSettings?.min_order_amount ?? 0,
            is_open: true,
            logo_url: parentSettings?.logo_url || null,
          },
          settingsColumns,
        ),
      );

      // 3. Provision manager/owner user if email provided
      let managerUserId = null;
      if (owner_email && String(owner_email).trim()) {
        const em = String(owner_email).trim().toLowerCase();
        let profile = await trx("profiles").whereRaw("lower(email) = lower(?)", [em]).first();

        if (!profile) {
          const pwd = owner_password && String(owner_password).length >= 6 ? String(owner_password) : "password123";
          const hash = await bcrypt.hash(pwd, 10);
          const [newProfile] = await trx("profiles")
            .insert({
              id: randomUUID(),
              email: em,
              full_name: owner_full_name ? String(owner_full_name).trim() : em.split("@")[0],
              password_hash: hash,
            })
            .returning("*");
          profile = newProfile;
        }

        managerUserId = profile.id;

        // Assign manager user_role
        const hasRole = await trx("user_roles").where({ user_id: profile.id }).first();
        if (!hasRole) {
          await trx("user_roles").insert({ user_id: profile.id, role: "manager" });
        }

        // Link manager to branch
        await trx("restaurant_members").insert({
          id: randomUUID(),
          user_id: profile.id,
          restaurant_id: branch.id,
          member_role: "manager",
        });
      }

      // 4. Clone parent menu categories and items if requested (default: true)
      const { copy_parent_menu } = req.body || {};
      if (copy_parent_menu !== false) {
        const parentCats = await trx("menu_categories").where({ restaurant_id: parentId });
        const catMap = new Map();
        for (const pc of parentCats) {
          const newCatId = randomUUID();
          catMap.set(pc.id, newCatId);
          await trx("menu_categories").insert(
            withExistingColumns(
              {
                id: newCatId,
                restaurant_id: branch.id,
                name: pc.name,
                sort_order: pc.sort_order ?? 0,
                is_active: pc.is_active ?? true,
                description: pc.description || null,
                image_url: pc.image_url || null,
              },
              categoryColumns,
            ),
          );
        }

        const parentItems = await trx("menu_items").where({ restaurant_id: parentId });
        for (const pi of parentItems) {
          await trx("menu_items").insert(
            withExistingColumns(
              {
                id: randomUUID(),
                restaurant_id: branch.id,
                category_id: pi.category_id ? catMap.get(pi.category_id) || null : null,
                name: pi.name,
                description: pi.description || null,
                price: Number(pi.price || 0),
                image_url: pi.image_url || null,
                is_available: pi.is_available ?? true,
                prep_time_minutes: pi.prep_time_minutes != null ? Number(pi.prep_time_minutes) : 15,
                dietary_tags: Array.isArray(pi.dietary_tags) ? pi.dietary_tags : [],
                spice_level: pi.spice_level != null ? Number(pi.spice_level) : 0,
                sort_order: Number(pi.sort_order || 0),
                track_inventory: Boolean(pi.track_inventory),
                stock_quantity: pi.stock_quantity != null ? Number(pi.stock_quantity) : null,
                max_order_quantity: pi.max_order_quantity != null ? Number(pi.max_order_quantity) : null,
              },
              itemColumns,
            ),
          );
        }
      }

      return { branch, managerUserId };
    });

    refreshAgentBranches(knex, parentId);

    return res.status(201).json({
      success: true,
      branch: result.branch,
      manager_user_id: result.managerUserId,
    });
  } catch (e) {
    console.error("Create branch error:", e);
    return res.status(500).json({ error: e.message || "Failed to create branch" });
  }
});

/**
 * GET /api/restaurants/:parentId/branches
 * List all branches under a parent restaurant with metrics
 */
router.get("/restaurants/:parentId/branches", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { parentId } = req.params;
    if (!isValidUUID(parentId)) {
      return res.json({ branches: [] });
    }
    const knex = getKnex();

    const branches = await knex("restaurants")
      .where({ parent_restaurant_id: parentId })
      .where((builder) => {
        builder.whereNull("is_active").orWhere("is_active", true);
      })
      .orderBy("name", "asc");

    // Enhance with manager info & summary count
    const branchIds = branches.map((b) => b.id);
    let memberMap = new Map();
    let orderStatMap = new Map();
    let menuCountMap = new Map();

    if (branchIds.length) {
      const [members, orderStats, menuStats] = await Promise.all([
        knex("restaurant_members")
          .join("profiles", "restaurant_members.user_id", "profiles.id")
          .whereIn("restaurant_members.restaurant_id", branchIds)
          .select(
            "restaurant_members.restaurant_id",
            "restaurant_members.member_role",
            "profiles.email",
            "profiles.full_name",
          ),
        knex("orders")
          .whereIn("restaurant_id", branchIds)
          .groupBy("restaurant_id")
          .select(
            "restaurant_id",
            knex.raw("count(*) as total_orders"),
            knex.raw("COALESCE(SUM(CASE WHEN status IN ('delivered', 'completed') THEN total_amount ELSE 0 END), 0) as total_revenue"),
            knex.raw("COALESCE(SUM(CASE WHEN status NOT IN ('delivered', 'completed', 'cancelled') THEN 1 ELSE 0 END), 0) as active_orders")
          ),
        knex("menu_items")
          .whereIn("restaurant_id", branchIds)
          .groupBy("restaurant_id")
          .select("restaurant_id")
          .count("* as total_items"),
      ]);

      for (const m of members) {
        if (!memberMap.has(m.restaurant_id)) memberMap.set(m.restaurant_id, []);
        memberMap.get(m.restaurant_id).push(m);
      }

      for (const o of orderStats) {
        orderStatMap.set(o.restaurant_id, {
          total_orders: Number(o.total_orders || 0),
          total_revenue: Number(o.total_revenue || 0),
          active_orders: Number(o.active_orders || 0),
        });
      }

      for (const m of menuStats) {
        menuCountMap.set(m.restaurant_id, Number(m.total_items || 0));
      }
    }

    const payload = branches.map((b) => {
      const o = orderStatMap.get(b.id) || { total_orders: 0, total_revenue: 0, active_orders: 0 };
      return {
        ...b,
        members: memberMap.get(b.id) || [],
        total_orders: o.total_orders,
        total_revenue: o.total_revenue,
        active_orders: o.active_orders,
        total_menu_items: menuCountMap.get(b.id) || 0,
      };
    });

    return res.json({ branches: payload });
  } catch (e) {
    console.error("List branches error:", e);
    return res.status(500).json({ error: e.message || "Failed to list branches" });
  }
});

/**
 * GET /api/restaurants/:parentId/branches-report
 * Get detailed financial and operational report for all branches
 */
router.get("/restaurants/:parentId/branches-report", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { parentId } = req.params;
    if (!isValidUUID(parentId)) {
      return res.json({
        branches: [],
        rollup: { total_branches: 0, total_orders: 0, total_revenue: 0, completed_orders: 0, active_orders: 0 },
      });
    }
    const knex = getKnex();

    const allowed = await canManageRestaurant(knex, req.user, parentId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized: You cannot view reports for this restaurant" });
    }

    const branches = await knex("restaurants")
      .where({ parent_restaurant_id: parentId, is_active: true })
      .orderBy("name", "asc");

    const branchIds = branches.map((b) => b.id);

    const stats = branchIds.length
      ? await knex("orders")
          .whereIn("restaurant_id", branchIds)
          .groupBy("restaurant_id")
          .select(
            "restaurant_id",
            knex.raw("count(*) as total_orders"),
            knex.raw("COALESCE(SUM(CASE WHEN status IN ('delivered', 'completed') THEN total_amount ELSE 0 END), 0) as total_revenue"),
            knex.raw("COALESCE(SUM(CASE WHEN status IN ('delivered', 'completed') THEN 1 ELSE 0 END), 0) as completed_orders"),
            knex.raw("COALESCE(SUM(CASE WHEN status NOT IN ('delivered', 'completed', 'cancelled') THEN 1 ELSE 0 END), 0) as active_orders")
          )
      : [];

    const statMap = new Map(stats.map((s) => [s.restaurant_id, s]));

    const report = branches.map((b) => {
      const s = statMap.get(b.id) || {};
      const totalOrders = Number(s.total_orders || 0);
      const totalRevenue = Number(s.total_revenue || 0);
      const completedOrders = Number(s.completed_orders || 0);
      const activeOrders = Number(s.active_orders || 0);
      const aov = completedOrders > 0 ? totalRevenue / completedOrders : 0;

      return {
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
        service_radius_km: b.service_radius_km,
        is_accepting_orders: b.is_accepting_orders,
        total_orders: totalOrders,
        completed_orders: completedOrders,
        active_orders: activeOrders,
        total_revenue: totalRevenue,
        avg_order_value: aov,
      };
    });

    const rollup = {
      total_branches: branches.length,
      total_orders: report.reduce((sum, r) => sum + r.total_orders, 0),
      total_revenue: report.reduce((sum, r) => sum + r.total_revenue, 0),
      completed_orders: report.reduce((sum, r) => sum + r.completed_orders, 0),
      active_orders: report.reduce((sum, r) => sum + r.active_orders, 0),
    };

    return res.json({ branches: report, rollup });
  } catch (e) {
    console.error("Branches report error:", e);
    return res.status(500).json({ error: e.message || "Failed to generate branches report" });
  }
});

/**
 * GET /api/branches/:branchId
 * Get a single branch details
 */
router.get("/branches/:branchId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { branchId } = req.params;
    const knex = getKnex();

    const branch = await knex("restaurants").where({ id: branchId }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const settings = await knex("restaurant_settings").where({ restaurant_id: branchId }).first();
    const members = await knex("restaurant_members")
      .join("profiles", "restaurant_members.user_id", "profiles.id")
      .where("restaurant_members.restaurant_id", branchId)
      .select("restaurant_members.member_role", "profiles.id as user_id", "profiles.email", "profiles.full_name");

    return res.json({ branch, settings: settings || null, members });
  } catch (e) {
    console.error("Get branch error:", e);
    return res.status(500).json({ error: e.message || "Failed to get branch" });
  }
});

/**
 * PATCH /api/branches/:branchId
 * Update branch fields
 */
router.patch("/branches/:branchId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { branchId } = req.params;
    const knex = getKnex();

    const allowed = await canManageRestaurant(knex, req.user, branchId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized to update this branch" });
    }

    const branch = await knex("restaurants").where({ id: branchId }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const {
      name,
      address,
      latitude,
      longitude,
      service_radius_km,
      is_accepting_orders,
      is_active,
      phone,
      owner_email,
      owner_password,
      owner_full_name,
      manager_email,
      manager_password,
      manager_full_name,
      city,
      area,
    } = req.body || {};

    const targetEmail = manager_email !== undefined ? manager_email : owner_email;
    const targetPassword = manager_password !== undefined ? manager_password : owner_password;
    const targetFullName = manager_full_name !== undefined ? manager_full_name : owner_full_name;

    const updates = {};
    if (name !== undefined && String(name).trim()) updates.name = String(name).trim();
    if (phone !== undefined) updates.phone = phone ? String(phone).trim() : null;
    if (is_accepting_orders !== undefined) updates.is_accepting_orders = Boolean(is_accepting_orders);
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (service_radius_km !== undefined) updates.service_radius_km = Number(service_radius_km) || 5.0;

    let newLat = latitude !== undefined ? (latitude != null && latitude !== "" ? Number(latitude) : null) : undefined;
    let newLng = longitude !== undefined ? (longitude != null && longitude !== "" ? Number(longitude) : null) : undefined;

    if (city !== undefined) updates.city = city ? String(city).trim() : null;
    if (area !== undefined) updates.area = area ? String(area).trim() : null;
    if (address !== undefined) {
      updates.address = address ? String(address).trim() : null;
      if (newLat === undefined && newLng === undefined && updates.address) {
        const geo = await geocodeAddress(updates.address);
        if (geo) {
          updates.latitude = geo.latitude;
          updates.longitude = geo.longitude;
        }
      }
    }

    if (newLat !== undefined) updates.latitude = newLat;
    if (newLng !== undefined) updates.longitude = newLng;

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      await knex("restaurants").where({ id: branchId }).update(updates);
    }

    // Handle Manager Email / Password update
    if (targetEmail !== undefined || (targetPassword && String(targetPassword).trim().length > 0)) {
      const existingMember = await knex("restaurant_members")
        .where({ restaurant_id: branchId })
        .first();

      if (existingMember) {
        const existingProfile = await knex("profiles").where({ id: existingMember.user_id }).first();
        const profileUpdates = {};

        if (targetEmail !== undefined && String(targetEmail).trim()) {
          const cleanEmail = String(targetEmail).trim().toLowerCase();
          if (!existingProfile || existingProfile.email.toLowerCase() !== cleanEmail) {
            const emailTaken = await knex("profiles")
              .whereRaw("lower(email) = lower(?)", [cleanEmail])
              .andWhereNot({ id: existingMember.user_id })
              .first();
            if (emailTaken) {
              await knex("restaurant_members")
                .where({ id: existingMember.id })
                .update({ user_id: emailTaken.id });
            } else {
              profileUpdates.email = cleanEmail;
            }
          }
        }

        if (targetFullName !== undefined && String(targetFullName).trim()) {
          profileUpdates.full_name = String(targetFullName).trim();
        }

        if (targetPassword && String(targetPassword).trim().length >= 6) {
          profileUpdates.password_hash = await bcrypt.hash(String(targetPassword).trim(), 10);
        }

        if (Object.keys(profileUpdates).length > 0) {
          profileUpdates.updated_at = new Date();
          await knex("profiles").where({ id: existingMember.user_id }).update(profileUpdates);
        }
      } else if (targetEmail && String(targetEmail).trim()) {
        const cleanEmail = String(targetEmail).trim().toLowerCase();
        let profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [cleanEmail]).first();

        if (!profile) {
          const pwd = targetPassword && String(targetPassword).length >= 6 ? String(targetPassword) : "password123";
          const hash = await bcrypt.hash(pwd, 10);
          const [newProfile] = await knex("profiles")
            .insert({
              id: randomUUID(),
              email: cleanEmail,
              full_name: targetFullName ? String(targetFullName).trim() : cleanEmail.split("@")[0],
              password_hash: hash,
            })
            .returning("*");
          profile = newProfile;
        } else if (targetPassword && String(targetPassword).trim().length >= 6) {
          const hash = await bcrypt.hash(String(targetPassword).trim(), 10);
          await knex("profiles").where({ id: profile.id }).update({ password_hash: hash, updated_at: new Date() });
        }

        const hasRole = await knex("user_roles").where({ user_id: profile.id }).first();
        if (!hasRole) {
          await knex("user_roles").insert({ user_id: profile.id, role: "manager" });
        }

        await knex("restaurant_members").insert({
          id: randomUUID(),
          user_id: profile.id,
          restaurant_id: branchId,
          member_role: "manager",
        });
      }
    }

    const updated = await knex("restaurants").where({ id: branchId }).first();
    refreshAgentBranches(knex, updated?.parent_restaurant_id || branch.parent_restaurant_id);
    return res.json({ success: true, branch: updated });
  } catch (e) {
    console.error("Update branch error:", e);
    return res.status(500).json({ error: e.message || "Failed to update branch" });
  }
});

/**
 * DELETE /api/branches/:branchId
 * Soft delete / deactivate branch
 */
router.delete("/branches/:branchId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { branchId } = req.params;
    const knex = getKnex();

    const allowed = await canManageRestaurant(knex, req.user, branchId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized to deactivate this branch" });
    }

    const branch = await knex("restaurants").where({ id: branchId }).first();
    await knex("restaurants").where({ id: branchId }).update({
      is_active: false,
      is_accepting_orders: false,
      updated_at: new Date(),
    });

    refreshAgentBranches(knex, branch?.parent_restaurant_id);

    return res.json({ success: true, message: "Branch deactivated successfully" });
  } catch (e) {
    console.error("Deactivate branch error:", e);
    return res.status(500).json({ error: e.message || "Failed to deactivate branch" });
  }
});

/**
 * POST /api/orders/:orderId/reassign-branch
 * Send transfer request to a different branch of the same restaurant family
 */
router.post("/orders/:orderId/reassign-branch", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const branch_id = req.body?.branch_id || req.body?.targetBranchId || req.body?.target_branch_id;
    const reason = req.body?.reason;

    if (!branch_id) {
      return res.status(400).json({ error: "branch_id is required" });
    }

    const knex = getKnex();
    const order = await knex("orders").where({ id: orderId }).first();
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const targetBranch = await knex("restaurants").where({ id: branch_id }).first();
    if (!targetBranch) {
      return res.status(404).json({ error: "Target branch not found" });
    }

    if (!targetBranch.is_branch && !targetBranch.parent_restaurant_id) {
      return res.status(400).json({
        error: `Cannot transfer order: "${targetBranch.name}" is the parent restaurant account, not an operational branch location.`,
      });
    }

    if (targetBranch.is_accepting_orders === false || targetBranch.is_active === false) {
      return res.status(400).json({
        error: `Cannot transfer order: Branch "${targetBranch.name}" is currently paused and not accepting orders.`,
      });
    }

    // Check permission on existing order restaurant or target branch
    const canManageExisting = await canManageRestaurant(knex, req.user, order.restaurant_id);
    const canManageTarget = await canManageRestaurant(knex, req.user, targetBranch.id);
    if (!canManageExisting && !canManageTarget) {
      return res.status(403).json({ error: "Unauthorized to reassign this order" });
    }

    await knex.transaction(async (trx) => {
      await trx("orders").where({ id: orderId }).update({
        pending_transfer_to_restaurant_id: targetBranch.id,
        transferred_from_restaurant_id: order.restaurant_id,
        transfer_status: "pending",
        transfer_reason: reason || null,
        transfer_rejection_reason: null,
        transfer_requested_at: new Date(),
        assigned_by: req.user.id,
        updated_at: new Date(),
      });

      // Add status history record
      await trx("order_status_history").insert({
        id: randomUUID(),
        order_id: orderId,
        status: order.status,
        notes: `Transfer requested to branch "${targetBranch.name}" by ${req.user.email || "staff"}${
          reason ? `: ${reason}` : ""
        }`,
      });
    });

    // Send in-app notification to the target branch
    await createNotification(knex, {
      restaurant_id: targetBranch.id,
      order_id: orderId,
      type: "transfer_requested",
      title: "🚨 Incoming Order Transfer Request",
      message: `Order #${order.order_number} (${order.customer_name || "Customer"}) has been transferred to your branch by HQ Admin. Please Accept or Reject.${
        reason ? ` Reason: ${reason}` : ""
      }`,
      metadata: {
        order_number: order.order_number,
        customer_name: order.customer_name,
        total_amount: Number(order.total_amount || 0),
        transfer_reason: reason,
        from_restaurant_id: order.restaurant_id,
      },
    });

    const updatedOrder = await knex("orders").where({ id: orderId }).first();
    return res.json({
      success: true,
      message: `Transfer request sent to "${targetBranch.name}". Awaiting branch confirmation.`,
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Reassign branch error:", e);
    return res.status(500).json({ error: e.message || "Failed to send transfer request" });
  }
});

/**
 * POST /api/orders/:orderId/accept-transfer
 * Target branch accepts the transferred order
 */
router.post("/orders/:orderId/accept-transfer", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const knex = getKnex();

    const order = await knex("orders").where({ id: orderId }).first();
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const targetBranchId = order.pending_transfer_to_restaurant_id || order.restaurant_id;
    const targetBranch = await knex("restaurants").where({ id: targetBranchId }).first();
    if (!targetBranch) {
      return res.status(404).json({ error: "Assigned branch not found" });
    }

    // Check permission
    const canManage = await canManageRestaurant(knex, req.user, targetBranch.id);
    if (!canManage) {
      return res.status(403).json({ error: "Unauthorized to accept this order transfer" });
    }

    await knex.transaction(async (trx) => {
      await trx("orders").where({ id: orderId }).update({
        restaurant_id: targetBranch.id,
        pending_transfer_to_restaurant_id: null,
        transfer_status: "accepted",
        is_transferred: true,
        branch_assigned_at: new Date(),
        assignment_status: "assigned",
        auto_assigned: false,
        transfer_responded_at: new Date(),
        updated_at: new Date(),
      });

      await trx("order_status_history").insert({
        id: randomUUID(),
        order_id: orderId,
        status: order.status,
        notes: `Transfer accepted by branch "${targetBranch.name}". Order fulfillment is in progress.`,
      });
    });

    // Notify Parent / From Restaurant
    const notifyTargetId = order.transferred_from_restaurant_id || targetBranch.parent_restaurant_id;
    if (notifyTargetId) {
      await createNotification(knex, {
        restaurant_id: notifyTargetId,
        order_id: orderId,
        type: "transfer_accepted",
        title: "✅ Order Transfer Accepted",
        message: `Branch "${targetBranch.name}" has accepted Order #${order.order_number}. Order is now being fulfilled by the branch.`,
        metadata: {
          order_number: order.order_number,
          branch_name: targetBranch.name,
          branch_id: targetBranch.id,
        },
      });
    }

    const updatedOrder = await knex("orders").where({ id: orderId }).first();
    return res.json({
      success: true,
      message: `Order transfer accepted by "${targetBranch.name}".`,
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Accept transfer error:", e);
    return res.status(500).json({ error: e.message || "Failed to accept transfer" });
  }
});

/**
 * POST /api/orders/:orderId/reject-transfer
 * Target branch rejects the transferred order with a reason
 */
router.post("/orders/:orderId/reject-transfer", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const reason = req.body?.reason || req.body?.rejection_reason || "Kitchen at full capacity / unable to fulfill";
    const knex = getKnex();

    const order = await knex("orders").where({ id: orderId }).first();
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const targetBranchId = order.pending_transfer_to_restaurant_id || order.restaurant_id;
    const targetBranch = await knex("restaurants").where({ id: targetBranchId }).first();

    const canManageTarget = await canManageRestaurant(knex, req.user, targetBranchId);
    const canManageParent = order.restaurant_id ? await canManageRestaurant(knex, req.user, order.restaurant_id) : false;
    if (!canManageTarget && !canManageParent) {
      return res.status(403).json({ error: "Unauthorized to reject this order transfer" });
    }

    await knex.transaction(async (trx) => {
      await trx("orders").where({ id: orderId }).update({
        pending_transfer_to_restaurant_id: null,
        transfer_status: "rejected",
        transfer_rejection_reason: reason,
        transfer_responded_at: new Date(),
        updated_at: new Date(),
      });

      await trx("order_status_history").insert({
        id: randomUUID(),
        order_id: orderId,
        status: order.status,
        notes: `Transfer rejected by branch "${targetBranch?.name || "Branch"}": ${reason}`,
      });
    });

    // Notify Parent / HQ Restaurant Admin so they can re-transfer
    const parentRestaurantId = targetBranch?.parent_restaurant_id || order.transferred_from_restaurant_id;
    if (parentRestaurantId) {
      await createNotification(knex, {
        restaurant_id: parentRestaurantId,
        order_id: orderId,
        type: "transfer_rejected",
        title: "❌ Order Transfer Rejected",
        message: `Branch "${targetBranch?.name || "Branch"}" rejected transfer for Order #${order.order_number}. Reason: "${reason}". Please reassign to another branch.`,
        metadata: {
          order_number: order.order_number,
          branch_name: targetBranch?.name,
          branch_id: targetBranchId,
          rejection_reason: reason,
        },
      });
    }

    const updatedOrder = await knex("orders").where({ id: orderId }).first();
    return res.json({
      success: true,
      message: `Order transfer rejected. Parent Admin has been notified.`,
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Reject transfer error:", e);
    return res.status(500).json({ error: e.message || "Failed to reject transfer" });
  }
});

export default router;

