import { Router } from "express";
import { getKnex } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

const router = Router();

const COMPLETED_STATUSES = ["delivered", "completed"];

function isSuperAdmin(user) {
  return user?.roles?.includes("super_admin");
}

async function canAccessBranchReports(knex, userId, branchRestaurantId) {
  const branch = await knex("restaurants").where({ id: branchRestaurantId }).first();
  if (!branch?.is_branch) return true; // not a branch, normal rules apply

  const isBranchMember = await knex("restaurant_members")
    .where({ restaurant_id: branchRestaurantId, user_id: userId })
    .first();
  const isParentOwner = branch.parent_restaurant_id
    ? await knex("restaurant_members")
        .where({ restaurant_id: branch.parent_restaurant_id, user_id: userId })
        .whereIn("member_role", ["owner", "admin"])
        .first()
    : false;

  return Boolean(isBranchMember || isParentOwner);
  // Note: deliberately does NOT check for super_admin role here.
}

/** Resolve which restaurant IDs the caller may read in reports. */
async function resolveReportRestaurantIds(knex, user, queryRestaurantId) {
  const requested =
    typeof queryRestaurantId === "string" && queryRestaurantId.trim() ? queryRestaurantId.trim() : null;

  if (requested) {
    const target = await knex("restaurants").where({ id: requested }).first();
    if (!target) {
      return { allowed: false, restaurantIds: [], scopeAll: false };
    }

    if (target.is_branch) {
      // Direct branch report request -> check branch RBAC explicitly (super_admin is NOT exempt)
      const allowed = await canAccessBranchReports(knex, user.id, requested);
      if (!allowed) {
        return { allowed: false, restaurantIds: [], scopeAll: false, forbidden: true };
      }
      return { allowed: true, restaurantIds: [requested], scopeAll: false, isBranch: true };
    }

    // Target is a parent or standalone restaurant
    if (isSuperAdmin(user)) {
      return { allowed: true, restaurantIds: [requested], scopeAll: false };
    }

    const memberIds = [...new Set(user?.restaurantIds || [])];
    if (!memberIds.includes(requested)) {
      return { allowed: false, restaurantIds: [], scopeAll: false };
    }

    // Parent rollup: If user is owner/admin of parent restaurant, rollup parent + all active branches
    const isParentOwner = (user?.memberships || []).some(
      (m) => m.restaurant_id === requested && (m.member_role === "owner" || m.member_role === "admin")
    );

    if (isParentOwner) {
      const branches = await knex("restaurants")
        .where({ parent_restaurant_id: requested, is_active: true })
        .select("id");
      const familyIds = [requested, ...branches.map((b) => b.id)];
      return { allowed: true, restaurantIds: familyIds, scopeAll: false, isParentRollup: true };
    }

    return { allowed: true, restaurantIds: [requested], scopeAll: false };
  }

  // No specific restaurant requested
  if (isSuperAdmin(user)) {
    return { allowed: true, restaurantIds: null, scopeAll: true };
  }

  const memberIds = [...new Set(user?.restaurantIds || [])];
  if (!memberIds.length) {
    return { allowed: false, restaurantIds: [], scopeAll: false };
  }

  // Check if any of user's restaurants are parent restaurants -> expand to include active child branches
  const parentRestaurants = await knex("restaurants")
    .whereIn("id", memberIds)
    .whereNull("parent_restaurant_id")
    .where({ is_branch: false });

  if (parentRestaurants.length > 0) {
    const parentIds = parentRestaurants.map((p) => p.id);
    const childBranches = await knex("restaurants")
      .whereIn("parent_restaurant_id", parentIds)
      .where({ is_active: true })
      .select("id");
    const allExpandedIds = [...new Set([...memberIds, ...childBranches.map((b) => b.id)])];
    return { allowed: true, restaurantIds: allExpandedIds, scopeAll: allExpandedIds.length > 1, isParentRollup: true };
  }

  return { allowed: true, restaurantIds: memberIds, scopeAll: memberIds.length > 1 };
}

function applyRestaurantScope(qb, knex, column, scope) {
  if (!scope.allowed) {
    qb.whereRaw("1 = 0");
    return;
  }
  if (scope.restaurantIds?.length) {
    qb.whereIn(column, scope.restaurantIds);
  }
}

function parsePositiveInt(value, fallback, max = 500) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

router.get("/global", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();

    // Check if super_admin via DB (more reliable than JWT payload)
    const roleRow = await knex("user_roles")
      .where({ user_id: req.user.id })
      .whereIn("role", ["super_admin"])
      .first();

    const isSuperAdmin = !!roleRow;
    const restaurantIds = req.user.restaurantIds || [];

    let totalRestaurants = 0;
    let totalMenuItems = 0;
    let totalDeals = 0;
    let totalDrivers = 0;
    let totalVehicles = 0;

    if (isSuperAdmin) {
      const [rr, mr, dr, drv, veh] = await Promise.all([
        knex("restaurants").count("* as cnt"),
        knex("menu_items").count("* as cnt"),
        knex("deals").count("* as cnt"),
        knex("drivers").count("* as cnt"),
        knex("vehicles").count("* as cnt"),
      ]);
      totalRestaurants = Number(rr[0]?.cnt || 0);
      totalMenuItems = Number(mr[0]?.cnt || 0);
      totalDeals = Number(dr[0]?.cnt || 0);
      totalDrivers = Number(drv[0]?.cnt || 0);
      totalVehicles = Number(veh[0]?.cnt || 0);
    } else if (restaurantIds.length > 0) {
      const [rr, mr, dr, drvRow, veh] = await Promise.all([
        knex("restaurants").whereIn("id", restaurantIds).count("* as cnt"),
        knex("menu_items").whereIn("restaurant_id", restaurantIds).count("* as cnt"),
        knex("deals").whereIn("restaurant_id", restaurantIds).count("* as cnt"),
        knex("driver_restaurants")
          .whereIn("restaurant_id", restaurantIds)
          .countDistinct("driver_id as cnt")
          .first(),
        knex("vehicles").whereIn("restaurant_id", restaurantIds).count("* as cnt"),
      ]);
      totalRestaurants = Number(rr[0]?.cnt || 0);
      totalMenuItems = Number(mr[0]?.cnt || 0);
      totalDeals = Number(dr[0]?.cnt || 0);
      totalDrivers = Number((drvRow && drvRow.cnt) ?? 0);
      totalVehicles = Number(veh[0]?.cnt || 0);
    }

    return res.json({ totalRestaurants, totalMenuItems, totalDeals, totalDrivers, totalVehicles });
  } catch (e) {
    console.error("STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/earnings", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      if (scope.forbidden) {
        return res.status(403).json({ error: "Access denied: Branch reports are private to the branch and parent owner." });
      }
      return res.json({
        restaurants: [],
        summary: {
          total_sales: 0,
          total_orders: 0,
          total_admin_earning: 0,
          total_restaurant_earning: 0,
        },
      });
    }

    const stats = await knex("orders")
      .join("restaurants", "orders.restaurant_id", "restaurants.id")
      .select(
        "restaurants.id as restaurant_id",
        "restaurants.name as restaurant_name",
        "restaurants.commission_rate",
        knex.raw("SUM(orders.total_amount) as total_sales"),
        knex.raw("COUNT(orders.id) as order_count")
      )
      .whereIn("orders.status", ["delivered", "completed"])
      .modify((qb) => {
        applyRestaurantScope(qb, knex, "restaurants.id", scope);
      })
      .groupBy("restaurants.id", "restaurants.name", "restaurants.commission_rate")
      .orderBy("total_sales", "desc");

    let totalAdminEarning = 0;
    let totalRestaurantEarning = 0;
    let totalSales = 0;
    let totalOrders = 0;

    const formattedStats = stats.map((s) => {
      const sales = Number(s.total_sales || 0);
      const rate = Number(s.commission_rate || 10);
      const adminPart = (sales * rate) / 100;
      const restPart = sales - adminPart;

      totalSales += sales;
      totalAdminEarning += adminPart;
      totalRestaurantEarning += restPart;
      totalOrders += Number(s.order_count || 0);

      return {
        restaurant_id: s.restaurant_id,
        restaurant_name: s.restaurant_name,
        commission_rate: rate,
        total_sales: sales,
        order_count: Number(s.order_count || 0),
        admin_earning: adminPart,
        restaurant_earning: restPart,
      };
    });

    res.json({
      restaurants: formattedStats,
      summary: {
        total_sales: totalSales,
        total_orders: totalOrders,
        total_admin_earning: totalAdminEarning,
        total_restaurant_earning: totalRestaurantEarning,
      },
    });
  } catch (e) {
    console.error("EARNINGS STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Menu item sales (line items) for delivered / completed orders with date, item, category, search & sort filters. */
router.get("/item-reports", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      if (scope.forbidden) {
        return res.status(403).json({ error: "Access denied: Branch reports are private to the branch and parent owner." });
      }
      return res.json({ items: [], categories: [], menu_items: [], summary: { total_revenue: 0, total_units: 0, total_orders: 0, sku_count: 0 } });
    }

    const {
      from,
      to,
      days,
      period,
      category_id,
      menu_item_id,
      search,
      sort_by = "revenue",
      sort_order = "desc",
      min_revenue,
      min_quantity,
    } = req.query;

    const q = knex("order_items")
      .join("orders", "order_items.order_id", "orders.id")
      .join("restaurants", "orders.restaurant_id", "restaurants.id")
      .leftJoin("menu_items", "order_items.menu_item_id", "menu_items.id")
      .leftJoin("menu_categories", "menu_items.category_id", "menu_categories.id")
      .select(
        "restaurants.id as restaurant_id",
        "restaurants.name as restaurant_name",
        knex.raw("COALESCE(menu_items.id, order_items.menu_item_id) as menu_item_id"),
        knex.raw("COALESCE(menu_items.name, order_items.item_name) as item_name"),
        knex.raw("menu_categories.id as category_id"),
        knex.raw("COALESCE(menu_categories.name, 'Uncategorized') as category_name"),
        knex.raw("SUM(order_items.quantity::integer) as quantity_sold"),
        knex.raw("COUNT(DISTINCT orders.id) as order_count"),
        knex.raw("SUM(order_items.line_total) as revenue"),
        knex.raw("ROUND(AVG(order_items.unit_price), 2) as avg_price")
      )
      .whereIn("orders.status", ["delivered", "completed"])
      .modify((qb) => {
        applyRestaurantScope(qb, knex, "restaurants.id", scope);

        // Date range filters
        if (from && from.trim()) {
          qb.where("orders.created_at", ">=", `${from.trim()}T00:00:00.000Z`);
        }
        if (to && to.trim()) {
          qb.where("orders.created_at", "<=", `${to.trim()}T23:59:59.999Z`);
        }
        if (!from && !to) {
          if (period === "today" || days === "1") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE"));
          } else if (period === "yesterday") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
              .where("orders.created_at", "<", knex.raw("CURRENT_DATE"));
          } else if (period === "this_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (period === "last_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW() - INTERVAL '1 month')"))
              .where("orders.created_at", "<", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (days && Number(days) > 0) {
            const numDays = Math.min(parseInt(days, 10), 3650);
            qb.where("orders.created_at", ">=", knex.raw("NOW() - ?::interval", [`${numDays} days`]));
          }
        }

        // Category filter
        if (category_id && category_id !== "all") {
          qb.where("menu_categories.id", category_id);
        }

        // Specific Item filter
        if (menu_item_id && menu_item_id !== "all") {
          qb.where(function () {
            this.where("menu_items.id", menu_item_id).orWhere("order_items.menu_item_id", menu_item_id);
          });
        }

        // Search item name
        if (search && search.trim()) {
          const s = `%${search.trim().toLowerCase()}%`;
          qb.whereRaw("LOWER(COALESCE(menu_items.name, order_items.item_name)) LIKE ?", [s]);
        }
      })
      .groupBy([
        "restaurants.id",
        "restaurants.name",
        knex.raw("COALESCE(menu_items.id, order_items.menu_item_id)"),
        knex.raw("COALESCE(menu_items.name, order_items.item_name)"),
        "menu_categories.id",
        "menu_categories.name",
      ])
      .modify((qb) => {
        if (min_revenue && Number(min_revenue) > 0) {
          qb.having(knex.raw("SUM(order_items.line_total) >= ?", [Number(min_revenue)]));
        }
        if (min_quantity && Number(min_quantity) > 0) {
          qb.having(knex.raw("SUM(order_items.quantity::integer) >= ?", [Number(min_quantity)]));
        }
      });

    // Sorting
    const validSortCols = {
      revenue: "revenue",
      quantity: "quantity_sold",
      orders: "order_count",
      name: knex.raw("COALESCE(menu_items.name, order_items.item_name)"),
      price: "avg_price",
    };
    const orderCol = validSortCols[sort_by] || "revenue";
    const orderDir = String(sort_order).toLowerCase() === "asc" ? "asc" : "desc";
    q.orderBy(orderCol, orderDir);

    const rows = await q;

    // Category breakdown aggregation
    const categoryMap = new Map();
    for (const r of rows) {
      const catKey = r.category_name || "Uncategorized";
      const catId = r.category_id || "uncategorized";
      if (!categoryMap.has(catKey)) {
        categoryMap.set(catKey, {
          id: catId,
          name: catKey,
          revenue: 0,
          units_sold: 0,
          item_count: 0,
          percentage: 0,
        });
      }
      const catObj = categoryMap.get(catKey);
      catObj.revenue += Number(r.revenue || 0);
      catObj.units_sold += Number(r.quantity_sold || 0);
      catObj.item_count += 1;
    }

    // Daily sales trend aggregation for charts
    const baseItemsTrendQuery = knex("order_items")
      .join("orders", "order_items.order_id", "orders.id")
      .join("restaurants", "orders.restaurant_id", "restaurants.id")
      .leftJoin("menu_items", "order_items.menu_item_id", "menu_items.id")
      .leftJoin("menu_categories", "menu_items.category_id", "menu_categories.id")
      .whereIn("orders.status", ["delivered", "completed"])
      .modify((qb) => {
        applyRestaurantScope(qb, knex, "restaurants.id", scope);

        // Date range filters
        if (from && from.trim()) {
          qb.where("orders.created_at", ">=", `${from.trim()}T00:00:00.000Z`);
        }
        if (to && to.trim()) {
          qb.where("orders.created_at", "<=", `${to.trim()}T23:59:59.999Z`);
        }
        if (!from && !to) {
          if (period === "today" || days === "1") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE"));
          } else if (period === "yesterday") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
              .where("orders.created_at", "<", knex.raw("CURRENT_DATE"));
          } else if (period === "this_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (period === "last_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW() - INTERVAL '1 month')"))
              .where("orders.created_at", "<", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (days && Number(days) > 0) {
            const numDays = Math.min(parseInt(days, 10), 3650);
            qb.where("orders.created_at", ">=", knex.raw("NOW() - ?::interval", [`${numDays} days`]));
          }
        }

        if (category_id && category_id !== "all") {
          qb.where("menu_categories.id", category_id);
        }
        if (menu_item_id && menu_item_id !== "all") {
          qb.where(function () {
            this.where("menu_items.id", menu_item_id).orWhere("order_items.menu_item_id", menu_item_id);
          });
        }
        if (search && search.trim()) {
          const s = `%${search.trim().toLowerCase()}%`;
          qb.whereRaw("LOWER(COALESCE(menu_items.name, order_items.item_name)) LIKE ?", [s]);
        }
      });

    const dailyTrendRows = await baseItemsTrendQuery
      .select(
        knex.raw("TO_CHAR(orders.created_at, 'YYYY-MM-DD') as date_str"),
        knex.raw("TO_CHAR(orders.created_at, 'Mon DD') as formatted_date"),
        knex.raw("SUM(order_items.line_total) as revenue"),
        knex.raw("SUM(order_items.quantity::integer) as units_sold"),
        knex.raw("COUNT(DISTINCT orders.id) as order_count")
      )
      .groupByRaw("TO_CHAR(orders.created_at, 'YYYY-MM-DD'), TO_CHAR(orders.created_at, 'Mon DD')")
      .orderBy("date_str", "asc");

    const dailyTrend = dailyTrendRows.map((r) => ({
      date: r.date_str,
      formatted_date: r.formatted_date,
      revenue: Number(r.revenue || 0),
      units_sold: Number(r.units_sold || 0),
      order_count: Number(r.order_count || 0),
    }));

    // Also get categories for the filter dropdown
    let catQuery = knex("menu_categories")
      .select("id", "name")
      .where("is_active", true)
      .orderBy("sort_order", "asc");
    if (scope.restaurantIds?.length) {
      catQuery = catQuery.whereIn("restaurant_id", scope.restaurantIds);
    }
    const categories = await catQuery;

    // Also get all menu items for the item dropdown
    let menuItemsQuery = knex("menu_items")
      .select("id", "name", "category_id")
      .orderBy("name", "asc");
    if (scope.restaurantIds?.length) {
      menuItemsQuery = menuItemsQuery.whereIn("restaurant_id", scope.restaurantIds);
    }
    const menuItems = await menuItemsQuery;

    const items = rows.map((r) => ({
      restaurant_id: r.restaurant_id,
      restaurant_name: r.restaurant_name,
      menu_item_id: r.menu_item_id,
      item_name: r.item_name || "Unknown item",
      category_id: r.category_id || null,
      category_name: r.category_name || "Uncategorized",
      quantity_sold: Number(r.quantity_sold || 0),
      order_count: Number(r.order_count || 0),
      revenue: Number(r.revenue || 0),
      avg_price: Number(r.avg_price || 0),
    }));

    const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
    const totalUnits = items.reduce((s, i) => s + i.quantity_sold, 0);
    const totalOrders = items.reduce((s, i) => s + i.order_count, 0);
    const avgPrice = totalUnits > 0 ? totalRevenue / totalUnits : 0;

    // Calculate category percentages and format list
    const categoryBreakdown = Array.from(categoryMap.values()).map((c) => ({
      ...c,
      percentage: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 100) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    const topProduct = items.length > 0 ? [...items].sort((a, b) => b.revenue - a.revenue)[0] : null;
    const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;

    res.json({
      items,
      categories,
      menu_items: menuItems,
      category_breakdown: categoryBreakdown,
      daily_trend: dailyTrend,
      summary: {
        total_revenue: totalRevenue,
        total_units: totalUnits,
        total_orders: totalOrders,
        sku_count: items.length,
        avg_price: avgPrice,
        top_product: topProduct ? {
          name: topProduct.item_name,
          revenue: topProduct.revenue,
          units_sold: topProduct.quantity_sold,
        } : null,
        top_category: topCategory ? {
          name: topCategory.name,
          revenue: topCategory.revenue,
          percentage: topCategory.percentage,
        } : null,
      },
    });
  } catch (e) {
    console.error("ITEM REPORTS STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Restaurants available in report filters for the current user. */
router.get("/accessible-restaurants", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    let q = knex("restaurants")
      .select("id as restaurant_id", "name as restaurant_name")
      .where("is_active", true)
      .orderBy("name", "asc");

    if (!isSuperAdmin(req.user)) {
      const ids = req.user.restaurantIds || [];
      if (!ids.length) return res.json({ restaurants: [] });
      q = q.whereIn("id", ids);
    }

    const rows = await q;
    res.json({ restaurants: rows });
  } catch (e) {
    console.error("ACCESSIBLE RESTAURANTS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** All restaurants with full details — Super Admin only. */
router.get("/all-restaurants", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const roleRow = await knex("user_roles")
      .where({ user_id: req.user.id, role: "super_admin" })
      .first();
    if (!roleRow) return res.status(403).json({ error: "Super admin only." });

    // Repair bad data: one email → one restaurant portal (except super_admin)
    try {
      const multi = await knex("restaurant_members")
        .select("user_id")
        .groupBy("user_id")
        .havingRaw("count(*) > 1");
      for (const row of multi) {
        const isSuper = await knex("user_roles")
          .where({ user_id: row.user_id, role: "super_admin" })
          .first();
        if (isSuper) continue;
        const memberships = await knex("restaurant_members")
          .where({ user_id: row.user_id })
          .select("*");
        const rank = (role) =>
          role === "owner" ? 0 : role === "admin" ? 1 : role === "manager" ? 2 : 3;
        memberships.sort((a, b) => {
          const byRole = rank(a.member_role) - rank(b.member_role);
          if (byRole !== 0) return byRole;
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });
        const keep = memberships[0];
        if (keep) {
          await knex("restaurant_members")
            .where({ user_id: row.user_id })
            .whereNot({ id: keep.id })
            .del();
        }
      }
    } catch (repairErr) {
      console.warn("Membership exclusivity repair skipped:", repairErr.message);
    }

    // Every restaurant row (parents + branches) so Super Admin sees the full tenant count
    const hasBranchCol = await knex.schema.hasColumn("restaurants", "is_branch");
    const hasParentCol = await knex.schema.hasColumn("restaurants", "parent_restaurant_id");
    const selectCols = [
      "id", "name", "slug", "phone", "contact_email", "address",
      "logo_url", "cover_image_url", "twilio_phone_number", "elevenlabs_agent_id",
      "is_active", "created_at", "agent_language", "agent_voice_id",
      "agent_first_message", "agent_system_prompt", "commission_rate",
      "allows_delivery", "allows_pickup",
    ];
    if (hasBranchCol) selectCols.push("is_branch");
    if (hasParentCol) selectCols.push("parent_restaurant_id");

    const restaurants = await knex("restaurants")
      .select(...selectCols)
      .orderBy("created_at", "desc");

    const ids = restaurants.map((r) => r.id);
    const ownerEmailByRestaurant = {};
    const cuisineMap = {};

    if (ids.length) {
      const members = await knex("restaurant_members")
        .select("restaurant_id", "user_id", "member_role")
        .whereIn("restaurant_id", ids)
        .orderByRaw(`case when member_role = 'owner' then 0 when member_role = 'admin' then 1 else 2 end`);

      const userIds = [...new Set(members.map((m) => m.user_id))];
      if (userIds.length) {
        const profiles = await knex("profiles").select("id", "email").whereIn("id", userIds);
        const emailByUser = Object.fromEntries(profiles.map((p) => [p.id, p.email]));
        for (const m of members) {
          if (ownerEmailByRestaurant[m.restaurant_id] !== undefined) continue;
          ownerEmailByRestaurant[m.restaurant_id] = emailByUser[m.user_id] ?? "";
        }
      }

      const links = await knex("restaurant_cuisines")
        .select("restaurant_id", "cuisine_id")
        .whereIn("restaurant_id", ids);
      const cuisineIds = [...new Set(links.map((l) => l.cuisine_id))];
      if (cuisineIds.length) {
        const cuisines = await knex("cuisines").select("id", "name").whereIn("id", cuisineIds);
        const nameById = Object.fromEntries(cuisines.map((c) => [c.id, c.name]));
        for (const l of links) {
          if (!cuisineMap[l.restaurant_id]) cuisineMap[l.restaurant_id] = [];
          const name = nameById[l.cuisine_id];
          if (name) cuisineMap[l.restaurant_id].push(name);
        }
      }
    }

    const result = restaurants.map((r) => ({
      ...r,
      owner_login_email: ownerEmailByRestaurant[r.id] ?? "",
      cuisines: cuisineMap[r.id] ?? [],
    }));

    res.json({ restaurants: result });
  } catch (e) {
    console.error("ALL RESTAURANTS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Top-selling menu items (quantity or revenue). Available to members + super admin. */
router.get("/best-sellers", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      return res.status(403).json({ error: scope.forbidden ? "Access denied: Branch reports are private to the branch and parent owner." : "Access denied for this restaurant." });
    }

    const limit = parsePositiveInt(req.query.limit, 10, 100);
    const days = parsePositiveInt(req.query.days, 0, 3650);
    const sortBy = req.query.sort === "quantity" ? "quantity" : "revenue";

    const q = knex("order_items")
      .join("orders", "order_items.order_id", "orders.id")
      .join("restaurants", "orders.restaurant_id", "restaurants.id")
      .leftJoin("menu_items", "order_items.menu_item_id", "menu_items.id")
      .leftJoin("menu_categories", "menu_items.category_id", "menu_categories.id")
      .select(
        "restaurants.id as restaurant_id",
        "restaurants.name as restaurant_name",
        knex.raw("COALESCE(menu_items.id, order_items.menu_item_id) as menu_item_id"),
        knex.raw("COALESCE(menu_items.name, order_items.item_name) as item_name"),
        knex.raw("menu_categories.name as category_name"),
        knex.raw("SUM(order_items.quantity::integer) as quantity_sold"),
        knex.raw("COUNT(DISTINCT orders.id) as order_count"),
        knex.raw("SUM(order_items.line_total) as revenue"),
      )
      .whereIn("orders.status", COMPLETED_STATUSES)
      .modify((qb) => {
        applyRestaurantScope(qb, knex, "orders.restaurant_id", scope);
        if (days > 0) {
          qb.where("orders.created_at", ">=", knex.raw("NOW() - ?::interval", [`${days} days`]));
        }
      })
      .groupBy([
        "restaurants.id",
        "restaurants.name",
        knex.raw("COALESCE(menu_items.id, order_items.menu_item_id)"),
        knex.raw("COALESCE(menu_items.name, order_items.item_name)"),
        "menu_categories.name",
      ])
      .orderBy(sortBy === "quantity" ? "quantity_sold" : "revenue", "desc")
      .limit(limit);

    const rows = await q;
    const totalRevenue = rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);

    const items = rows.map((r, idx) => {
      const revenue = Number(r.revenue || 0);
      return {
        rank: idx + 1,
        restaurant_id: r.restaurant_id,
        restaurant_name: r.restaurant_name,
        menu_item_id: r.menu_item_id,
        item_name: r.item_name || "Unknown item",
        category_name: r.category_name || null,
        quantity_sold: Number(r.quantity_sold || 0),
        order_count: Number(r.order_count || 0),
        revenue,
        revenue_share_pct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0,
      };
    });

    res.json({
      items,
      summary: {
        total_revenue: totalRevenue,
        total_units: items.reduce((s, i) => s + i.quantity_sold, 0),
        period_days: days || null,
        sort_by: sortBy,
      },
    });
  } catch (e) {
    console.error("BEST SELLERS STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Stock levels and inventory health per menu item. */
router.get("/inventory", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      return res.status(403).json({ error: scope.forbidden ? "Access denied: Branch reports are private to the branch and parent owner." : "Access denied for this restaurant." });
    }

    const lowStockThreshold = parsePositiveInt(req.query.low_stock_threshold, 10, 1000);

    const q = knex("menu_items")
      .join("restaurants", "menu_items.restaurant_id", "restaurants.id")
      .leftJoin("menu_categories", "menu_items.category_id", "menu_categories.id")
      .select(
        "restaurants.id as restaurant_id",
        "restaurants.name as restaurant_name",
        "menu_items.id as menu_item_id",
        "menu_items.name as item_name",
        "menu_categories.name as category_name",
        "menu_items.price",
        "menu_items.is_available",
        "menu_items.track_inventory",
        "menu_items.stock_quantity",
        "menu_items.max_order_quantity",
      )
      .modify((qb) => applyRestaurantScope(qb, knex, "menu_items.restaurant_id", scope))
      .orderBy([
        { column: "menu_items.track_inventory", order: "desc" },
        { column: "menu_items.stock_quantity", order: "asc", nulls: "last" },
        { column: "menu_items.name", order: "asc" },
      ]);

    const rows = await q;

    const items = rows.map((r) => {
      const tracked = Boolean(r.track_inventory);
      const stock = r.stock_quantity == null ? null : Number(r.stock_quantity);
      let stock_status = "not_tracked";
      if (tracked) {
        if (stock == null || stock <= 0) stock_status = "out_of_stock";
        else if (stock <= lowStockThreshold) stock_status = "low_stock";
        else stock_status = "in_stock";
      }

      return {
        restaurant_id: r.restaurant_id,
        restaurant_name: r.restaurant_name,
        menu_item_id: r.menu_item_id,
        item_name: r.item_name,
        category_name: r.category_name || null,
        price: Number(r.price || 0),
        is_available: Boolean(r.is_available),
        track_inventory: tracked,
        stock_quantity: stock,
        max_order_quantity: r.max_order_quantity == null ? null : Number(r.max_order_quantity),
        stock_status,
      };
    });

    const trackedItems = items.filter((i) => i.track_inventory);
    const summary = {
      total_items: items.length,
      tracked_items: trackedItems.length,
      in_stock: trackedItems.filter((i) => i.stock_status === "in_stock").length,
      low_stock: trackedItems.filter((i) => i.stock_status === "low_stock").length,
      out_of_stock: trackedItems.filter((i) => i.stock_status === "out_of_stock").length,
      unavailable_items: items.filter((i) => !i.is_available).length,
      low_stock_threshold: lowStockThreshold,
    };

    res.json({ items, summary });
  } catch (e) {
    console.error("INVENTORY REPORT STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Customer spend and repeat-order analytics from orders with date, category, customer type, search & sort filters. */
router.get("/customer-analytics", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      return res.status(403).json({ error: scope.forbidden ? "Access denied: Branch reports are private to the branch and parent owner." : "Access denied for this restaurant." });
    }

    const {
      from,
      to,
      days,
      period,
      category_id,
      customer_type,
      fulfillment_type,
      search,
      sort_by = "total_spent",
      sort_order = "desc",
    } = req.query;

    const limit = parsePositiveInt(req.query.limit, 2000, 5000);
    const fulfillmentFilter = String(fulfillment_type || "").trim().toLowerCase();
    const CUSTOMER_KEY_SQL = `COALESCE(
      NULLIF(TRIM(orders.customer_phone), ''),
      NULLIF(LOWER(TRIM(COALESCE(orders.customer_email, ''))), ''),
      CONCAT('guest:', LOWER(TRIM(COALESCE(NULLIF(orders.customer_name, ''), 'unknown'))))
    )`;

    const baseOrders = knex("orders")
      .whereNot("status", "cancelled")
      .modify((qb) => {
        applyRestaurantScope(qb, knex, "orders.restaurant_id", scope);

        // Date range filters
        if (from && from.trim()) {
          qb.where("orders.created_at", ">=", `${from.trim()}T00:00:00.000Z`);
        }
        if (to && to.trim()) {
          qb.where("orders.created_at", "<=", `${to.trim()}T23:59:59.999Z`);
        }
        if (!from && !to) {
          if (period === "today" || days === "1") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE"));
          } else if (period === "yesterday") {
            qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
              .where("orders.created_at", "<", knex.raw("CURRENT_DATE"));
          } else if (period === "this_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (period === "last_month") {
            qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW() - INTERVAL '1 month')"))
              .where("orders.created_at", "<", knex.raw("DATE_TRUNC('month', NOW())"));
          } else if (days && Number(days) > 0) {
            const numDays = Math.min(parseInt(days, 10), 3650);
            qb.where("orders.created_at", ">=", knex.raw("NOW() - ?::interval", [`${numDays} days`]));
          }
        }

        if (["dine_in", "delivery", "pickup"].includes(fulfillmentFilter)) {
          qb.where("orders.fulfillment_type", fulfillmentFilter);
        }

        // Category filter (orders that contain items belonging to category_id)
        if (category_id && category_id !== "all") {
          qb.whereExists(function () {
            this.select("*")
              .from("order_items")
              .join("menu_items", "order_items.menu_item_id", "menu_items.id")
              .whereRaw("order_items.order_id = orders.id")
              .where("menu_items.category_id", category_id);
          });
        }

        // Search by customer name, phone, email, or table
        if (search && search.trim()) {
          const s = `%${search.trim().toLowerCase()}%`;
          qb.where(function () {
            this.whereRaw("LOWER(COALESCE(orders.customer_name, '')) LIKE ?", [s])
              .orWhereRaw("LOWER(COALESCE(orders.customer_phone, '')) LIKE ?", [s])
              .orWhereRaw("LOWER(COALESCE(orders.customer_email, '')) LIKE ?", [s])
              .orWhereRaw("LOWER(COALESCE(orders.table_number, '')) LIKE ?", [s]);
          });
        }
      });

    // Customer rows query — include dine-in guests even when phone is missing
    let customerQuery = baseOrders
      .clone()
      .select(
        "orders.restaurant_id",
        knex.raw(`${CUSTOMER_KEY_SQL} as customer_key`),
        knex.raw("MAX(NULLIF(TRIM(orders.customer_phone), '')) as customer_phone"),
        knex.raw("MAX(orders.customer_name) as customer_name"),
        knex.raw("MAX(orders.customer_email) as customer_email"),
        knex.raw("COUNT(*)::int as order_count"),
        knex.raw("SUM(orders.total_amount) as total_spent"),
        knex.raw("AVG(orders.total_amount) as avg_order_value"),
        knex.raw("MAX(orders.created_at) as last_order_at"),
        knex.raw("MIN(orders.created_at) as first_order_at"),
        knex.raw("COUNT(*) FILTER (WHERE orders.fulfillment_type = 'dine_in')::int as dine_in_orders"),
        knex.raw("COUNT(*) FILTER (WHERE COALESCE(orders.fulfillment_type, 'delivery') = 'delivery')::int as delivery_orders"),
        knex.raw("COUNT(*) FILTER (WHERE orders.fulfillment_type = 'pickup')::int as pickup_orders"),
        knex.raw("MAX(CASE WHEN orders.fulfillment_type = 'dine_in' THEN orders.table_number END) as table_number")
      )
      .groupBy("orders.restaurant_id", knex.raw(CUSTOMER_KEY_SQL));

    // Filter by Customer Segment / Type
    if (customer_type === "repeat") {
      customerQuery.having(knex.raw("COUNT(*) > 1"));
    } else if (customer_type === "single" || customer_type === "one_time") {
      customerQuery.having(knex.raw("COUNT(*) = 1"));
    } else if (customer_type === "vip") {
      customerQuery.having(knex.raw("SUM(orders.total_amount) >= 100"));
    } else if (customer_type === "new") {
      customerQuery.having(knex.raw("MIN(orders.created_at) >= NOW() - INTERVAL '30 days'"));
    }

    // Sorting
    const sortColMap = {
      total_spent: "total_spent",
      order_count: "order_count",
      avg_order_value: "avg_order_value",
      last_order_at: "last_order_at",
      first_order_at: "first_order_at",
      customer_name: knex.raw("MAX(orders.customer_name)"),
    };
    const orderCol = sortColMap[sort_by] || "total_spent";
    const orderDir = String(sort_order).toLowerCase() === "asc" ? "asc" : "desc";
    customerQuery.orderBy(orderCol, orderDir).limit(limit);

    const customerRows = await customerQuery;

    const restaurantIds = [...new Set(customerRows.map((r) => r.restaurant_id))];
    const restaurantNameById = new Map();
    if (restaurantIds.length) {
      const rests = await knex("restaurants").select("id", "name").whereIn("id", restaurantIds);
      for (const r of rests) restaurantNameById.set(r.id, r.name);
    }

    const customers = customerRows.map((r) => {
      const dineIn = Number(r.dine_in_orders || 0);
      const delivery = Number(r.delivery_orders || 0);
      const pickup = Number(r.pickup_orders || 0);
      const orderTypes = [];
      if (dineIn > 0) orderTypes.push("dine_in");
      if (delivery > 0) orderTypes.push("delivery");
      if (pickup > 0) orderTypes.push("pickup");
      return {
        restaurant_id: r.restaurant_id,
        restaurant_name: restaurantNameById.get(r.restaurant_id) || "—",
        customer_key: r.customer_key,
        customer_phone: r.customer_phone || "—",
        customer_name: r.customer_name || "—",
        customer_email: r.customer_email || null,
        order_count: Number(r.order_count || 0),
        total_spent: Number(r.total_spent || 0),
        avg_order_value: Number(r.avg_order_value || 0),
        last_order_at: r.last_order_at,
        first_order_at: r.first_order_at,
        is_repeat: Number(r.order_count || 0) > 1,
        dine_in_orders: dineIn,
        delivery_orders: delivery,
        pickup_orders: pickup,
        table_number: r.table_number || null,
        has_dine_in: dineIn > 0,
        order_types: orderTypes,
      };
    });

    // Categories query for filter
    let catQuery = knex("menu_categories")
      .select("id", "name")
      .where("is_active", true)
      .orderBy("sort_order", "asc");
    if (scope.restaurantIds?.length) {
      catQuery = catQuery.whereIn("restaurant_id", scope.restaurantIds);
    }
    const categories = await catQuery;

    const [totalsRow] = await baseOrders
      .clone()
      .select(
        knex.raw("COUNT(*)::int as total_orders"),
        knex.raw("SUM(orders.total_amount) as total_revenue"),
        knex.raw("AVG(orders.total_amount) as avg_order_value"),
        knex.raw(`COUNT(DISTINCT ${CUSTOMER_KEY_SQL})::int as unique_customers`)
      );

    const repeatRow = await knex
      .from(
        baseOrders
          .clone()
          .select(
            knex.raw(`${CUSTOMER_KEY_SQL} as customer_key`),
            knex.raw("COUNT(*)::int as order_count")
          )
          .groupBy(knex.raw(CUSTOMER_KEY_SQL))
          .having(knex.raw("COUNT(*) > 1"))
          .as("repeat_customers")
      )
      .count("* as cnt");

    const newCustomersSubq = baseOrders
      .clone()
      .select(knex.raw(`${CUSTOMER_KEY_SQL} as customer_key`))
      .select(knex.raw("MIN(orders.created_at) as first_order_at"))
      .groupBy(knex.raw(CUSTOMER_KEY_SQL))
      .havingRaw("MIN(orders.created_at) >= NOW() - INTERVAL '30 days'")
      .as("new_customers");

    const newCustomersRow = await knex.count("* as cnt").from(newCustomersSubq);

    const totalOrders = Number(totalsRow?.total_orders || 0);
    const uniqueCustomers = Number(totalsRow?.unique_customers || 0);

    // Precise calculation of Repeat vs One-Time breakdown
    const customerAggSubq = baseOrders
      .clone()
      .select(
        knex.raw(`${CUSTOMER_KEY_SQL} as customer_key`),
        knex.raw("COUNT(*)::int as order_count"),
        knex.raw("SUM(orders.total_amount) as total_spent")
      )
      .groupBy(knex.raw(CUSTOMER_KEY_SQL))
      .as("cust_agg");

    const breakdownRows = await knex
      .from(customerAggSubq)
      .select(
        knex.raw("CASE WHEN order_count > 1 THEN 'repeat' ELSE 'one_time' END as cust_type"),
        knex.raw("COUNT(*)::int as customer_count"),
        knex.raw("SUM(order_count)::int as total_orders"),
        knex.raw("SUM(total_spent) as total_revenue")
      )
      .groupBy(knex.raw("CASE WHEN order_count > 1 THEN 'repeat' ELSE 'one_time' END"));

    let oneTimeBreakdown = {
      customer_count: 0,
      total_orders: 0,
      total_revenue: 0,
      avg_order_value: 0,
      percentage: 0,
    };
    let repeatBreakdown = {
      customer_count: 0,
      total_orders: 0,
      total_revenue: 0,
      avg_order_value: 0,
      percentage: 0,
    };

    for (const b of breakdownRows) {
      const cCount = Number(b.customer_count || 0);
      const oCount = Number(b.total_orders || 0);
      const rev = Number(b.total_revenue || 0);
      const avg = oCount > 0 ? rev / oCount : 0;
      const pct = uniqueCustomers > 0 ? Math.round((cCount / uniqueCustomers) * 100) : 0;

      if (b.cust_type === "repeat") {
        repeatBreakdown = {
          customer_count: cCount,
          total_orders: oCount,
          total_revenue: rev,
          avg_order_value: avg,
          percentage: pct,
        };
      } else {
        oneTimeBreakdown = {
          customer_count: cCount,
          total_orders: oCount,
          total_revenue: rev,
          avg_order_value: avg,
          percentage: pct,
        };
      }
    }

    // Ensure percentages sum to 100% if we have customers
    if (uniqueCustomers > 0 && repeatBreakdown.customer_count > 0 && oneTimeBreakdown.customer_count > 0) {
      oneTimeBreakdown.percentage = 100 - repeatBreakdown.percentage;
    }

    // Daily revenue trend for One-time vs Repeat orders
    const dailyTrendRows = await knex
      .from(
        baseOrders
          .clone()
          .join(customerAggSubq, knex.raw(CUSTOMER_KEY_SQL), "cust_agg.customer_key")
          .select(
            knex.raw("TO_CHAR(orders.created_at, 'YYYY-MM-DD') as date_str"),
            knex.raw("TO_CHAR(orders.created_at, 'Mon DD') as formatted_date"),
            knex.raw("CASE WHEN cust_agg.order_count > 1 THEN 'repeat' ELSE 'one_time' END as cust_type"),
            knex.raw("SUM(orders.total_amount) as revenue"),
            knex.raw("COUNT(orders.id)::int as order_count")
          )
          .groupByRaw("TO_CHAR(orders.created_at, 'YYYY-MM-DD'), TO_CHAR(orders.created_at, 'Mon DD'), CASE WHEN cust_agg.order_count > 1 THEN 'repeat' ELSE 'one_time' END")
          .as("daily_agg")
      )
      .select("*")
      .orderBy("date_str", "asc");

    const trendMap = new Map();
    for (const r of dailyTrendRows) {
      if (!trendMap.has(r.date_str)) {
        trendMap.set(r.date_str, {
          date: r.date_str,
          formatted_date: r.formatted_date,
          one_time_revenue: 0,
          repeat_revenue: 0,
          total_revenue: 0,
        });
      }
      const entry = trendMap.get(r.date_str);
      const rev = Number(r.revenue || 0);
      if (r.cust_type === "repeat") {
        entry.repeat_revenue += rev;
      } else {
        entry.one_time_revenue += rev;
      }
      entry.total_revenue += rev;
    }

    const revenueTrend = Array.from(trendMap.values());

    res.json({
      customers,
      categories,
      revenue_trend: revenueTrend,
      summary: {
        total_orders: totalOrders,
        total_revenue: Number(totalsRow?.total_revenue || 0),
        avg_order_value: Number(totalsRow?.avg_order_value || 0),
        unique_customers: uniqueCustomers,
        repeat_customers: Number(repeatRow[0]?.cnt || 0),
        new_customers_30d: Number(newCustomersRow[0]?.cnt || 0),
        repeat_rate_pct:
          uniqueCustomers > 0
            ? Math.round((Number(repeatRow[0]?.cnt || 0) / uniqueCustomers) * 1000) / 10
            : 0,
        orders_per_customer:
          uniqueCustomers > 0 ? Math.round((totalOrders / uniqueCustomers) * 10) / 10 : 0,
        period_days: days ? Number(days) : null,
        one_time_breakdown: oneTimeBreakdown,
        repeat_breakdown: repeatBreakdown,
        dining_customers: customers.filter((c) => c.has_dine_in).length,
        fulfillment_type: fulfillmentFilter || "all",
      },
    });
  } catch (e) {
    console.error("CUSTOMER ANALYTICS STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});


/** Super Admin Dashboard: monthly revenue trend (last 12 months) + per-restaurant breakdown */
router.get("/superadmin-dashboard", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const roleRow = await knex("user_roles")
      .where({ user_id: req.user.id, role: "super_admin" })
      .first();
    if (!roleRow) return res.status(403).json({ error: "Super admin only." });

    const [
      restaurantsCount,
      totalOrders,
      totalRevenue,
      activeRestaurants,
      totalCustomers,
      pendingOrders,
      monthlyRows,
      restaurantSalesRows,
      orderStatusRows,
    ] = await Promise.all([
      knex("restaurants").count("* as cnt").first(),
      knex("orders").count("* as cnt").first(),
      knex("orders").whereIn("status", ["delivered", "completed"]).sum("total_amount as s").first(),
      knex("restaurants").where("is_active", true).count("* as cnt").first(),
      knex("orders").countDistinct("customer_phone as cnt").first(),
      knex("orders").whereNotIn("status", ["delivered", "completed", "cancelled"]).count("* as cnt").first(),

      // Monthly revenue last 12 months
      knex("orders")
        .whereIn("status", ["delivered", "completed"])
        .where("created_at", ">=", knex.raw("NOW() - INTERVAL '12 months'"))
        .select(
          knex.raw("TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') as month"),
          knex.raw("DATE_TRUNC('month', created_at) as month_date"),
          knex.raw("COUNT(*) as orders"),
          knex.raw("COALESCE(SUM(total_amount), 0) as revenue"),
        )
        .groupByRaw("DATE_TRUNC('month', created_at)")
        .orderByRaw("DATE_TRUNC('month', created_at) ASC"),

      // Per-restaurant sales (top 8)
      knex("orders")
        .join("restaurants", "orders.restaurant_id", "restaurants.id")
        .whereIn("orders.status", ["delivered", "completed"])
        .select(
          "restaurants.name as restaurant_name",
          knex.raw("COUNT(orders.id) as order_count"),
          knex.raw("COALESCE(SUM(orders.total_amount), 0) as revenue"),
        )
        .groupBy("restaurants.id", "restaurants.name")
        .orderBy("revenue", "desc")
        .limit(8),

      // Order status distribution
      knex("orders")
        .select("status", knex.raw("COUNT(*) as cnt"))
        .groupBy("status")
        .orderBy("cnt", "desc"),
    ]);

    res.json({
      summary: {
        total_restaurants: Number(restaurantsCount?.cnt || 0),
        active_restaurants: Number(activeRestaurants?.cnt || 0),
        total_orders: Number(totalOrders?.cnt || 0),
        pending_orders: Number(pendingOrders?.cnt || 0),
        total_revenue: Number(totalRevenue?.s || 0),
        total_customers: Number(totalCustomers?.cnt || 0),
      },
      monthly_revenue: monthlyRows.map((r) => ({
        month: r.month,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      restaurant_sales: restaurantSalesRows.map((r) => ({
        name: r.restaurant_name,
        order_count: Number(r.order_count),
        revenue: Number(r.revenue),
      })),
      order_status: orderStatusRows.map((r) => ({
        status: r.status,
        count: Number(r.cnt),
      })),
    });
  } catch (e) {
    console.error("SUPERADMIN DASHBOARD STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PHONE_ORDER_SOURCES = ["phone", "call", "voice", "ai", "synthflow", "elevenlabs"];

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** This month's real call, order, and reservation totals, plus the missed-revenue estimate. */
router.get("/ai-value", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      return res.status(403).json({ error: "You cannot view these stats." });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const phoneList = PHONE_ORDER_SOURCES.map(() => "?").join(", ");
    const phoneSql = `(LOWER(COALESCE(source, '')) IN (${phoneList}) OR call_id IS NOT NULL)`;

    const scoped = (qb, column) => applyRestaurantScope(qb, knex, column, scope);

    const [callStats, orderStats, reservationStats] = await Promise.all([
      knex("calls")
        .modify((qb) => scoped(qb, "restaurant_id"))
        .where("created_at", ">=", monthStart)
        .select(
          knex.raw("COUNT(*)::int as calls"),
          knex.raw("COUNT(*) FILTER (WHERE status = 'missed')::int as missed"),
        )
        .first(),
      knex("orders")
        .modify((qb) => scoped(qb, "restaurant_id"))
        .where("created_at", ">=", monthStart)
        .whereNot("status", "cancelled")
        .select(
          knex.raw("COUNT(*)::int as orders"),
          knex.raw("COALESCE(SUM(total_amount), 0)::float as order_value"),
          knex.raw(`COUNT(*) FILTER (WHERE ${phoneSql})::int as phone_orders`, PHONE_ORDER_SOURCES),
          knex.raw(`COALESCE(SUM(total_amount) FILTER (WHERE ${phoneSql}), 0)::float as phone_revenue`, PHONE_ORDER_SOURCES),
        )
        .first(),
      knex("table_reservations")
        .modify((qb) => scoped(qb, "restaurant_id"))
        .where("created_at", ">=", monthStart)
        .whereNotIn("status", ["cancelled", "no_show"])
        .select(
          knex.raw("COUNT(*)::int as reservations"),
          knex.raw(`COUNT(*) FILTER (WHERE ${phoneSql})::int as phone_reservations`, PHONE_ORDER_SOURCES),
        )
        .first(),
    ]);

    const calls = Number(callStats?.calls || 0);
    const missed = Number(callStats?.missed || 0);
    const answered = Math.max(0, calls - missed);
    const orders = Number(orderStats?.orders || 0);
    const orderValue = Number(orderStats?.order_value || 0);
    const phoneOrders = Number(orderStats?.phone_orders || 0);
    const phoneRevenue = Number(orderStats?.phone_revenue || 0);
    const reservations = Number(reservationStats?.reservations || 0);
    const phoneReservations = Number(reservationStats?.phone_reservations || 0);

    const aov = phoneOrders > 0 ? phoneRevenue / phoneOrders : orders > 0 ? orderValue / orders : 0;
    const conversion = answered > 0 ? Math.min(1, phoneOrders / answered) : 0;
    const avoided = roundMoney(answered * conversion * aov);
    const recovered = roundMoney(phoneRevenue);
    const stillMissed = roundMoney(missed * conversion * aov);
    const staffMinutes = answered * 4;

    return res.json({
      period: "month",
      month_start: monthStart.toISOString(),
      calls,
      answered,
      missed,
      orders,
      phone_orders: phoneOrders,
      reservations,
      phone_reservations: phoneReservations,
      order_value: roundMoney(orderValue),
      staff_minutes_saved: staffMinutes,
      staff_hours_saved: roundMoney(staffMinutes / 60),
      estimated_missed_revenue_avoided: avoided,
      estimated_revenue_recovered: recovered,
      estimated_revenue_still_missed: stillMissed,
      note:
        "Counts start at local midnight on the 1st of this month. Answered calls are total calls minus missed calls. Orders leave out cancelled orders. Phone orders are phone, call, voice, AI, Synthflow, or ElevenLabs, plus any order linked to a call. Reservations leave out cancelled and no-show. Staff time is 4 minutes saved per answered call. The average order uses phone orders when any exist, otherwise all orders. Conversion is phone orders divided by answered calls, capped at 100%. Missed revenue avoided is answered calls × conversion × that average. Recovered revenue is the actual phone-order total. Still missed applies the same rate to unanswered calls.",
    });
  } catch (e) {
    console.error("AI VALUE STATS ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function applyOrderReportFilters(qb, knex, scope, query) {
  const { from, to, days, period, search, branch_id, status, transferred } = query;
  applyRestaurantScope(qb, knex, "orders.restaurant_id", scope);

  if (from && String(from).trim()) {
    qb.where("orders.created_at", ">=", `${String(from).trim()}T00:00:00.000Z`);
  }
  if (to && String(to).trim()) {
    qb.where("orders.created_at", "<=", `${String(to).trim()}T23:59:59.999Z`);
  }
  if (!from && !to) {
    if (period === "today" || days === "1") {
      qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE"));
    } else if (period === "yesterday") {
      qb.where("orders.created_at", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'")).where(
        "orders.created_at",
        "<",
        knex.raw("CURRENT_DATE"),
      );
    } else if (period === "this_month") {
      qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW())"));
    } else if (period === "last_month") {
      qb.where("orders.created_at", ">=", knex.raw("DATE_TRUNC('month', NOW() - INTERVAL '1 month')")).where(
        "orders.created_at",
        "<",
        knex.raw("DATE_TRUNC('month', NOW())"),
      );
    } else if (days && Number(days) > 0) {
      const numDays = Math.min(parseInt(days, 10), 3650);
      qb.where("orders.created_at", ">=", knex.raw("NOW() - ?::interval", [`${numDays} days`]));
    }
  }

  const branchId = String(branch_id || "").trim();
  if (branchId && branchId !== "all") {
    if (!scope.restaurantIds || scope.restaurantIds.includes(branchId)) {
      qb.where((inner) => {
        inner
          .where("orders.restaurant_id", branchId)
          .orWhere("orders.pending_transfer_to_restaurant_id", branchId)
          .orWhere("orders.transferred_from_restaurant_id", branchId);
      });
    } else {
      qb.whereRaw("1 = 0");
    }
  }

  const statusFilter = String(status || "").trim().toLowerCase();
  if (statusFilter && statusFilter !== "all") {
    qb.where("orders.status", statusFilter);
  }

  const transferFilter = String(transferred || "all").trim().toLowerCase();
  if (transferFilter === "transferred") qb.whereRaw(ORDER_TRANSFERRED_SQL);
  else if (transferFilter === "not_transferred") qb.whereRaw(`NOT ${ORDER_TRANSFERRED_SQL}`);

  const q = String(search || "").trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    qb.where((inner) => {
      inner
        .whereILike("orders.order_number", like)
        .orWhereILike("orders.customer_name", like)
        .orWhereILike("orders.customer_phone", like);
    });
  }
}

const ORDER_TRANSFERRED_SQL = `(
  COALESCE(orders.is_transferred, false) = true
  OR orders.pending_transfer_to_restaurant_id IS NOT NULL
  OR orders.transferred_from_restaurant_id IS NOT NULL
  OR (orders.branch_assigned_at IS NOT NULL AND COALESCE(orders.auto_assigned, true) = false)
)`;

/** Orders by branch, including how many were transferred. */
router.get("/order-report", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const scope = await resolveReportRestaurantIds(knex, req.user, req.query.restaurant_id);
    if (!scope.allowed) {
      return res.status(403).json({
        error: scope.forbidden
          ? "Access denied: Branch reports are private to the branch and parent owner."
          : "Access denied for this restaurant.",
      });
    }

    const familyIds = scope.restaurantIds;
    const branches = familyIds?.length
      ? await knex("restaurants")
          .whereIn("id", familyIds)
          .select("id", "name", "is_branch", "parent_restaurant_id")
          .orderBy("name", "asc")
      : [];

    const filtered = () =>
      knex("orders").modify((qb) => applyOrderReportFilters(qb, knex, scope, req.query));

    const [summaryRow, byBranch, rows] = await Promise.all([
      filtered()
        .select(
          knex.raw("COUNT(*)::int as total_orders"),
          knex.raw(`COUNT(*) FILTER (WHERE ${ORDER_TRANSFERRED_SQL})::int as transferred_orders`),
          knex.raw("COALESCE(SUM(total_amount), 0)::float as revenue"),
        )
        .first(),
      filtered()
        .join("restaurants", "orders.restaurant_id", "restaurants.id")
        .select(
          "restaurants.id as restaurant_id",
          "restaurants.name as restaurant_name",
          "restaurants.is_branch",
          knex.raw("COUNT(*)::int as order_count"),
          knex.raw(`COUNT(*) FILTER (WHERE ${ORDER_TRANSFERRED_SQL})::int as transferred_orders`),
          knex.raw("COALESCE(SUM(orders.total_amount), 0)::float as revenue"),
        )
        .groupBy("restaurants.id", "restaurants.name", "restaurants.is_branch")
        .orderBy("order_count", "desc"),
      filtered()
        .join("restaurants", "orders.restaurant_id", "restaurants.id")
        .leftJoin("restaurants as transferred_from", "orders.transferred_from_restaurant_id", "transferred_from.id")
        .leftJoin("restaurants as pending_branch", "orders.pending_transfer_to_restaurant_id", "pending_branch.id")
        .select(
          "orders.id",
          "orders.order_number",
          "orders.customer_name",
          "orders.customer_phone",
          "orders.status",
          "orders.source",
          "orders.fulfillment_type",
          "orders.total_amount",
          "orders.created_at",
          "orders.restaurant_id",
          "restaurants.name as branch_name",
          "restaurants.is_branch",
          "orders.is_transferred",
          "orders.transfer_status",
          "orders.transfer_reason",
          "orders.auto_assigned",
          "orders.branch_assigned_at",
          "orders.transferred_from_restaurant_id",
          "transferred_from.name as transferred_from_name",
          "orders.pending_transfer_to_restaurant_id",
          "pending_branch.name as pending_branch_name",
        )
        .orderBy("orders.created_at", "desc")
        .limit(500),
    ]);

    const orders = rows.map((row) => {
      const transferred = Boolean(
        row.is_transferred ||
          row.pending_transfer_to_restaurant_id ||
          row.transferred_from_restaurant_id ||
          (row.branch_assigned_at && row.auto_assigned === false),
      );
      return {
        id: row.id,
        order_number: row.order_number,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        status: row.status,
        source: row.source,
        fulfillment_type: row.fulfillment_type,
        total_amount: Number(row.total_amount || 0),
        created_at: row.created_at,
        restaurant_id: row.restaurant_id,
        branch_name: row.branch_name,
        is_branch: Boolean(row.is_branch),
        transferred,
        transfer_status: row.transfer_status || (row.pending_transfer_to_restaurant_id ? "pending" : null),
        transfer_reason: row.transfer_reason || null,
        transferred_from_name: row.transferred_from_name || null,
        pending_branch_name: row.pending_branch_name || null,
      };
    });

    return res.json({
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        is_branch: Boolean(b.is_branch),
      })),
      by_branch: byBranch.map((b) => ({
        restaurant_id: b.restaurant_id,
        restaurant_name: b.restaurant_name,
        is_branch: Boolean(b.is_branch),
        order_count: Number(b.order_count || 0),
        transferred_orders: Number(b.transferred_orders || 0),
        revenue: Number(b.revenue || 0),
      })),
      summary: {
        total_orders: Number(summaryRow?.total_orders || 0),
        transferred_orders: Number(summaryRow?.transferred_orders || 0),
        revenue: Number(summaryRow?.revenue || 0),
      },
      orders,
    });
  } catch (e) {
    console.error("ORDER REPORT ERROR:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
