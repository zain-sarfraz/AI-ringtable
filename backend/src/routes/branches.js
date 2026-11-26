import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getKnex } from "../db.js";
import { geocodeAddress, reverseGeocode, haversineDistanceKm } from "../lib/geocoding.js";
import { pushBranchListToAgent } from "../lib/syncAgentBranches.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { resolveRole } from "../middleware/checkPermission.js";
import { createNotification } from "./notifications.js";
import { healBranchMenuFromParent, syncParentItemFullyToBranches } from "../lib/syncMenuToBranches.js";

/** Assert caller has access to this restaurant/branch. Returns 403 if unauthorized */
function assertRestaurantAccess(req, res, restaurantId) {
  if (!restaurantId || !isValidUUID(restaurantId)) return res.status(404).json({ error: "Branch not found" });
  const roles = req.user?.roles || [];
  if (roles.includes("super_admin") || roles.includes("admin")) return null;
  const allowed = req.user?.restaurantIds || [];
  if (allowed.includes(restaurantId)) return null;
  return res.status(403).json({ error: "Access denied to this branch" });
}

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

/** Only owner/admin (not manager) can create new branches under a parent restaurant */
async function canCreateBranches(knex, user, parentRestaurantId) {
  if (!user?.id || !isValidUUID(parentRestaurantId)) return false;
  if (user.roles?.includes("super_admin")) return true;

  const membership = await knex("restaurant_members")
    .where({ restaurant_id: parentRestaurantId, user_id: user.id })
    .whereIn("member_role", ["owner", "admin"])
    .first();
  return !!membership;
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

    const allowed = await canCreateBranches(knex, req.user, parentId);
    if (!allowed) {
      return res.status(403).json({
        error: "Only restaurant owner or admin can create branches. Managers cannot create branches.",
      });
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
      const variantColumns = await columnsOf(trx, "menu_item_variants");

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
        const itemMap = new Map(); // parent item id → branch item id
        for (const pi of parentItems) {
          const newItemId = randomUUID();
          itemMap.set(pi.id, newItemId);
          await trx("menu_items").insert(
            withExistingColumns(
              {
                id: newItemId,
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

        // Clone sizes/flavors (and nested parent_id links) onto the new branch items
        const parentItemIds = parentItems.map((pi) => pi.id);
        if (parentItemIds.length > 0 && variantColumns.size > 0) {
          const parentVariants = await trx("menu_item_variants")
            .whereIn("menu_item_id", parentItemIds)
            .orderBy("sort_order", "asc");
          const variantIdMap = new Map();
          // First pass: create all variant rows with remapped menu_item_id
          for (const pv of parentVariants) {
            const newVarId = randomUUID();
            variantIdMap.set(pv.id, newVarId);
          }
          for (const pv of parentVariants) {
            const newItemId = itemMap.get(pv.menu_item_id);
            if (!newItemId) continue;
            await trx("menu_item_variants").insert(
              withExistingColumns(
                {
                  id: variantIdMap.get(pv.id),
                  menu_item_id: newItemId,
                  name: pv.name,
                  price: Number(pv.price || 0),
                  sort_order: Number(pv.sort_order || 0),
                  is_active: pv.is_active ?? true,
                  variant_type: pv.variant_type || null,
                  measurement: pv.measurement || null,
                  parent_id: pv.parent_id ? variantIdMap.get(pv.parent_id) || null : null,
                  max_order_quantity:
                    pv.max_order_quantity != null ? Number(pv.max_order_quantity) : null,
                },
                variantColumns,
              ),
            );
          }
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

    const callerRole = resolveRole(req);
    const branchesQuery = knex("restaurants")
      .where({ parent_restaurant_id: parentId })
      .where((builder) => {
        builder.whereNull("is_active").orWhere("is_active", true);
      })
      .orderBy("name", "asc");

    if (callerRole === "manager") {
      branchesQuery.whereIn("id", req.user?.restaurantIds || []);
    }

    const branches = await branchesQuery;

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

    const callerRole = resolveRole(req);
    const isManager = callerRole === "manager";
    const allowed = isManager
      ? (req.user?.restaurantIds || []).length > 0
      : await canManageRestaurant(knex, req.user, parentId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized: You cannot view reports for this restaurant" });
    }

    const branchesQuery = knex("restaurants")
      .where({ parent_restaurant_id: parentId, is_active: true })
      .orderBy("name", "asc");

    if (isManager) {
      branchesQuery.whereIn("id", req.user?.restaurantIds || []);
    }

    const branches = await branchesQuery;

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
    const denied = assertRestaurantAccess(req, res, branchId);
    if (denied) return denied;

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
    const denied = assertRestaurantAccess(req, res, branchId);
    if (denied) return denied;

    const knex = getKnex();

    const allowed = await canManageRestaurant(knex, req.user, branchId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized to update this branch" });
    }

    const callerRole = resolveRole(req);
    const isManager = callerRole === "manager";

    // If manager, enforce strict field whitelist: name, phone, address, opening hours (is_accepting_orders)
    // Ignore credentials, status, radius, plan, and commission fields
    if (isManager) {
      delete req.body.owner_email;
      delete req.body.owner_password;
      delete req.body.owner_full_name;
      delete req.body.manager_email;
      delete req.body.manager_password;
      delete req.body.manager_full_name;
      delete req.body.is_active;
      delete req.body.service_radius_km;
      delete req.body.commission_rate;
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
    const callerRole = resolveRole(req);
    if (callerRole === "manager") {
      return res.status(403).json({ error: "Managers cannot delete or deactivate branches" });
    }

    const denied = assertRestaurantAccess(req, res, branchId);
    if (denied) return denied;

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

/** Resolve HQ root id for a restaurant or branch */
async function resolveFamilyRootId(knex, restaurantId) {
  if (!restaurantId) return null;
  const row = await knex("restaurants").where({ id: restaurantId }).first();
  if (!row) return null;
  return row.parent_restaurant_id || row.id;
}

/**
 * All locations in the same restaurant family (HQ + branches).
 * Used for order transfer destination picker.
 */
async function listFamilyLocations(knex, restaurantId) {
  const rootId = await resolveFamilyRootId(knex, restaurantId);
  if (!rootId) return { rootId: null, locations: [] };

  const root = await knex("restaurants").where({ id: rootId }).first();
  const branches = await knex("restaurants")
    .where({ parent_restaurant_id: rootId })
    .orderBy("name", "asc");

  const locations = [];
  if (root) {
    locations.push({
      id: root.id,
      name: root.name,
      is_main: true,
      is_branch: false,
      is_active: root.is_active !== false,
      is_accepting_orders: root.is_accepting_orders !== false,
    });
  }
  for (const b of branches) {
    locations.push({
      id: b.id,
      name: b.name,
      is_main: false,
      is_branch: true,
      is_active: b.is_active !== false,
      is_accepting_orders: b.is_accepting_orders !== false,
    });
  }
  return { rootId, locations };
}

/** Keep (restaurant_id, order_number) unique when moving an order across locations */
async function ensureUniqueOrderNumber(trx, restaurantId, orderNumber, excludeOrderId) {
  const base = String(orderNumber || "ORD").trim() || "ORD";
  let candidate = base;
  let n = 0;
  while (n < 50) {
    const clash = await trx("orders")
      .where({ restaurant_id: restaurantId, order_number: candidate })
      .modify((qb) => {
        if (excludeOrderId) qb.whereNot({ id: excludeOrderId });
      })
      .first();
    if (!clash) return candidate;
    n += 1;
    candidate = n === 1 ? `${base}-T` : `${base}-T${n}`;
  }
  return `${base}-T${Date.now().toString(36).slice(-4)}`;
}

/**
 * PATCH /api/restaurants/:id/delivery-coverage
 * Set how far this location (main restaurant or branch) can deliver.
 * Geocodes address when lat/lng are missing so distance checks work.
 */
router.patch("/restaurants/:id/delivery-coverage", optionalAuth, requireAuth, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    if (!isValidUUID(restaurantId)) {
      return res.status(400).json({ error: "Invalid restaurant id" });
    }
    const denied = assertRestaurantAccess(req, res, restaurantId);
    if (denied) return denied;

    const knex = getKnex();
    const allowed = await canManageRestaurant(knex, req.user, restaurantId);
    if (!allowed) {
      return res.status(403).json({ error: "Unauthorized to update delivery coverage" });
    }

    const restaurant = await knex("restaurants").where({ id: restaurantId }).first();
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const updates = { updated_at: new Date() };
    if (req.body?.service_radius_km !== undefined) {
      const radius = Number(req.body.service_radius_km);
      if (!Number.isFinite(radius) || radius <= 0) {
        return res.status(400).json({ error: "service_radius_km must be a positive number" });
      }
      updates.service_radius_km = Math.min(500, Math.round(radius * 100) / 100);
    }

    let lat =
      req.body?.latitude !== undefined && req.body?.latitude !== "" && req.body?.latitude != null
        ? Number(req.body.latitude)
        : undefined;
    let lng =
      req.body?.longitude !== undefined && req.body?.longitude !== "" && req.body?.longitude != null
        ? Number(req.body.longitude)
        : undefined;

    if (lat !== undefined) updates.latitude = Number.isFinite(lat) ? lat : null;
    if (lng !== undefined) updates.longitude = Number.isFinite(lng) ? lng : null;

    const addressForGeo =
      (req.body?.address != null ? String(req.body.address).trim() : "") ||
      String(restaurant.address || "").trim();

    const needGeo =
      (updates.latitude === undefined || updates.latitude == null) &&
      (updates.longitude === undefined || updates.longitude == null) &&
      (restaurant.latitude == null || restaurant.longitude == null);

    if (needGeo && addressForGeo) {
      const geo = await geocodeAddress(addressForGeo);
      if (geo) {
        updates.latitude = geo.latitude;
        updates.longitude = geo.longitude;
      }
    }

    // When GPS coords are set, optionally reverse-geocode into address
    const fillAddress = req.body?.fill_address !== false;
    const finalLat = updates.latitude !== undefined ? updates.latitude : restaurant.latitude;
    const finalLng = updates.longitude !== undefined ? updates.longitude : restaurant.longitude;
    if (
      fillAddress &&
      finalLat != null &&
      finalLng != null &&
      (req.body?.latitude != null || req.body?.longitude != null || req.body?.use_gps)
    ) {
      const rev = await reverseGeocode(finalLat, finalLng);
      if (rev?.formattedAddress) {
        updates.address = rev.formattedAddress;
        if (rev.city && Object.prototype.hasOwnProperty.call(restaurant, "city")) {
          updates.city = rev.city;
        }
        if (rev.area && Object.prototype.hasOwnProperty.call(restaurant, "area")) {
          updates.area = rev.area;
        }
      }
    }

    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({ error: "No delivery coverage fields to update" });
    }

    await knex("restaurants").where({ id: restaurantId }).update(updates);
    const updated = await knex("restaurants").where({ id: restaurantId }).first();

    return res.json({
      success: true,
      restaurant: {
        id: updated.id,
        name: updated.name,
        address: updated.address,
        city: updated.city,
        area: updated.area,
        service_radius_km: updated.service_radius_km,
        latitude: updated.latitude,
        longitude: updated.longitude,
      },
    });
  } catch (e) {
    console.error("delivery-coverage error:", e);
    return res.status(500).json({ error: e.message || "Failed to update delivery coverage" });
  }
});

/**
 * POST /api/geo/reverse
 * Convert GPS coordinates into a readable address.
 */
router.post("/geo/reverse", optionalAuth, requireAuth, async (req, res) => {
  try {
    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "latitude and longitude are required" });
    }
    const result = await reverseGeocode(lat, lng);
    if (!result?.formattedAddress) {
      return res.status(404).json({ error: "Could not resolve address for these coordinates" });
    }
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("geo reverse error:", e);
    return res.status(500).json({ error: e.message || "Reverse geocode failed" });
  }
});

/**
 * POST /api/restaurants/:id/verify-delivery
 * Check whether a customer address/coords falls inside this location's delivery radius.
 */
router.post("/restaurants/:id/verify-delivery", optionalAuth, requireAuth, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    if (!isValidUUID(restaurantId)) {
      return res.status(400).json({ error: "Invalid restaurant id" });
    }
    const denied = assertRestaurantAccess(req, res, restaurantId);
    if (denied) return denied;

    const knex = getKnex();
    const restaurant = await knex("restaurants").where({ id: restaurantId }).first();
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const originLat = Number(restaurant.latitude);
    const originLng = Number(restaurant.longitude);
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return res.status(400).json({
        error: "This location has no GPS pin yet. Use Auto-GPS or save an address first.",
      });
    }

    const radiusKm = Number(restaurant.service_radius_km || 5);
    let destLat = Number(req.body?.latitude);
    let destLng = Number(req.body?.longitude);
    let resolvedAddress = null;

    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      const address = String(req.body?.address || "").trim();
      if (!address) {
        return res.status(400).json({ error: "Provide a delivery address or latitude/longitude" });
      }
      const geo = await geocodeAddress(address);
      if (!geo) {
        return res.status(404).json({ error: "Could not locate that delivery address" });
      }
      destLat = geo.latitude;
      destLng = geo.longitude;
      resolvedAddress = geo.formattedAddress || address;
    }

    const distanceKm = haversineDistanceKm(originLat, originLng, destLat, destLng);
    const deliverable = Number.isFinite(distanceKm) && distanceKm <= radiusKm;

    return res.json({
      success: true,
      deliverable,
      distance_km: distanceKm,
      service_radius_km: radiusKm,
      remaining_km: deliverable ? Number((radiusKm - distanceKm).toFixed(2)) : null,
      over_by_km: deliverable ? null : Number((distanceKm - radiusKm).toFixed(2)),
      origin: {
        id: restaurant.id,
        name: restaurant.name,
        latitude: originLat,
        longitude: originLng,
      },
      destination: {
        latitude: destLat,
        longitude: destLng,
        address: resolvedAddress || req.body?.address || null,
      },
      message: deliverable
        ? `Within range — ${distanceKm} km of ${radiusKm} km coverage.`
        : `Out of range — ${distanceKm} km away (limit ${radiusKm} km).`,
    });
  } catch (e) {
    console.error("verify-delivery error:", e);
    return res.status(500).json({ error: e.message || "Failed to verify delivery coverage" });
  }
});

/**
 * GET /api/restaurants/:id/transfer-targets
 * List HQ + sibling branches where this location can transfer orders.
 */
router.get("/restaurants/:id/transfer-targets", optionalAuth, requireAuth, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    if (!isValidUUID(restaurantId)) {
      return res.status(400).json({ error: "Invalid restaurant id" });
    }
    const denied = assertRestaurantAccess(req, res, restaurantId);
    if (denied) return denied;

    const knex = getKnex();
    const { rootId, locations } = await listFamilyLocations(knex, restaurantId);
    if (!rootId) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    // Available destinations = family minus current location (main + branches, no HQ label)
    const targets = locations
      .filter((loc) => loc.id !== restaurantId)
      .map((loc) => ({
        ...loc,
        label: loc.name,
        available: loc.is_active && loc.is_accepting_orders,
      }));

    return res.json({
      success: true,
      restaurantId,
      rootId,
      targets,
      family: locations,
    });
  } catch (e) {
    console.error("transfer-targets error:", e);
    return res.status(500).json({ error: e.message || "Failed to load transfer targets" });
  }
});

/**
 * POST /api/orders/:orderId/reassign-branch
 * Send transfer request to another location in the same restaurant family
 * (admin → branch, branch → admin/HQ, branch → branch).
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

    // Transfer only before confirmation — once confirmed, fulfillment stays at that location
    if (String(order.status || "").toLowerCase() !== "pending") {
      return res.status(400).json({
        error: "Orders can only be transferred before they are confirmed.",
      });
    }

    if (order.transfer_status === "pending" && order.pending_transfer_to_restaurant_id) {
      return res.status(400).json({
        error: "This order already has a pending transfer. Wait for accept/reject, or ask the target to reject first.",
      });
    }

    const targetBranch = await knex("restaurants").where({ id: branch_id }).first();
    if (!targetBranch) {
      return res.status(404).json({ error: "Target location not found" });
    }

    if (targetBranch.id === order.restaurant_id) {
      return res.status(400).json({ error: "Order is already at this location" });
    }

    // Must stay inside the same restaurant family (HQ + its branches)
    const fromRoot = await resolveFamilyRootId(knex, order.restaurant_id);
    const toRoot = await resolveFamilyRootId(knex, targetBranch.id);
    if (!fromRoot || !toRoot || fromRoot !== toRoot) {
      return res.status(400).json({
        error: "Can only transfer orders between the HQ and branches of the same restaurant.",
      });
    }

    if (targetBranch.is_accepting_orders === false || targetBranch.is_active === false) {
      return res.status(400).json({
        error: `Cannot transfer order: "${targetBranch.name}" is currently paused and not accepting orders.`,
      });
    }

    // Sender must manage the order's current restaurant (HQ admin or that branch's admin/manager)
    const canManageExisting = await canManageRestaurant(knex, req.user, order.restaurant_id);
    if (!canManageExisting) {
      return res.status(403).json({ error: "Unauthorized to transfer this order" });
    }

    const fromRest = await knex("restaurants").where({ id: order.restaurant_id }).first();
    const fromLabel = fromRest?.name || "another location";

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

      await trx("order_status_history").insert({
        id: randomUUID(),
        order_id: orderId,
        status: order.status,
        notes: `Transfer requested to "${targetBranch.name}" from "${fromLabel}" by ${req.user.email || "staff"}${
          reason ? `: ${reason}` : ""
        }`,
      });
    });

    await createNotification(knex, {
      restaurant_id: targetBranch.id,
      order_id: orderId,
      type: "transfer_requested",
      title: "🚨 Incoming Order Transfer Request",
      message: `Order #${order.order_number} (${order.customer_name || "Customer"}) was transferred to you from "${fromLabel}". Please Accept or Reject.${
        reason ? ` Reason: ${reason}` : ""
      }`,
      metadata: {
        order_number: order.order_number,
        customer_name: order.customer_name,
        total_amount: Number(order.total_amount || 0),
        transfer_reason: reason,
        from_restaurant_id: order.restaurant_id,
        from_restaurant_name: fromLabel,
      },
    });

    const updatedOrder = await knex("orders").where({ id: orderId }).first();
    return res.json({
      success: true,
      message: `Transfer request sent to "${targetBranch.name}". Awaiting confirmation.`,
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
      // Avoid unique (restaurant_id, order_number) clash at destination
      const uniqueNumber = await ensureUniqueOrderNumber(
        trx,
        targetBranch.id,
        order.order_number,
        orderId,
      );

      const patch = {
        restaurant_id: targetBranch.id,
        pending_transfer_to_restaurant_id: null,
        transfer_status: "accepted",
        is_transferred: true,
        branch_assigned_at: new Date(),
        assignment_status: "assigned",
        auto_assigned: false,
        transfer_responded_at: new Date(),
        updated_at: new Date(),
      };
      if (uniqueNumber !== order.order_number) {
        patch.order_number = uniqueNumber;
      }

      await trx("orders").where({ id: orderId }).update(patch);

      await trx("order_status_history").insert({
        id: randomUUID(),
        order_id: orderId,
        status: order.status,
        notes: `Transfer accepted by "${targetBranch.name}".${
          uniqueNumber !== order.order_number
            ? ` Order number adjusted to ${uniqueNumber} (conflict at destination).`
            : ""
        }`,
      });
    });

    // Notify the location that sent the transfer
    const notifyTargetId = order.transferred_from_restaurant_id || targetBranch.parent_restaurant_id;
    if (notifyTargetId) {
      await createNotification(knex, {
        restaurant_id: notifyTargetId,
        order_id: orderId,
        type: "transfer_accepted",
        title: "✅ Order Transfer Accepted",
        message: `"${targetBranch.name}" accepted Order #${order.order_number}. Fulfillment continues there.`,
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

    // Notify the sender (HQ or branch) so they can re-transfer
    const notifySenderId = order.transferred_from_restaurant_id || targetBranch?.parent_restaurant_id;
    if (notifySenderId) {
      await createNotification(knex, {
        restaurant_id: notifySenderId,
        order_id: orderId,
        type: "transfer_rejected",
        title: "❌ Order Transfer Rejected",
        message: `"${targetBranch?.name || "Location"}" rejected transfer for Order #${order.order_number}. Reason: "${reason}". You can transfer it to another available location.`,
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
      message: `Order transfer rejected. The sending location has been notified.`,
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Reject transfer error:", e);
    return res.status(500).json({ error: e.message || "Failed to reject transfer" });
  }
});

/**
 * POST /api/restaurants/:id/heal-menu-from-parent
 * Branch only: copy missing parent items / sizes / flavors / add-ons onto this branch
 * so Create Manual Order shows the same pizza options as HQ.
 */
router.post("/restaurants/:id/heal-menu-from-parent", optionalAuth, requireAuth, async (req, res) => {
  try {
    const branchId = req.params.id;
    if (!isValidUUID(branchId)) {
      return res.status(400).json({ error: "Invalid restaurant id" });
    }
    const denied = assertRestaurantAccess(req, res, branchId);
    if (denied) return denied;

    const knex = getKnex();
    const force = Boolean(req.body?.force);
    const result = await healBranchMenuFromParent(knex, branchId, { forceRebuildVariants: force });
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("heal-menu-from-parent error:", e);
    return res.status(500).json({ error: e.message || "Failed to heal branch menu" });
  }
});

/**
 * POST /api/restaurants/:id/menu-items/:itemId/sync-to-branches
 * Parent HQ: after saving an item (with variants/addons), push the COMPLETE item to all branches.
 */
router.post("/restaurants/:id/menu-items/:itemId/sync-to-branches", optionalAuth, requireAuth, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const itemId = req.params.itemId;
    if (!isValidUUID(restaurantId) || !isValidUUID(itemId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const denied = assertRestaurantAccess(req, res, restaurantId);
    if (denied) return denied;

    const knex = getKnex();
    const item = await knex("menu_items").where({ id: itemId }).first();
    if (!item || item.restaurant_id !== restaurantId) {
      return res.status(404).json({ error: "Menu item not found on this restaurant" });
    }

    const result = await syncParentItemFullyToBranches(knex, itemId);
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("sync-to-branches error:", e);
    return res.status(500).json({ error: e.message || "Failed to sync item to branches" });
  }
});

export default router;

