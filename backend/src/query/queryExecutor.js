import { ALLOWED_TABLES, RESTAURANT_SCOPED, TENANT_QUERY_DENY } from "./allowedTables.js";

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

function assertCol(c) {
  if (typeof c !== "string" || !/^[a-zA-Z0-9_]+$/.test(c)) throw new Error("Invalid column name");
}

function tenantIds(user) {
  return user.restaurantIds || [];
}

function applyOrString(q, orStr) {
  const parts = orStr.split(",").map((p) => p.trim()).filter(Boolean);
  q.where((qb) => {
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i].match(/^([a-zA-Z0-9_]+)\.(eq|neq|is)\.(.+)$/);
      if (!m) continue;
      const [, col, op, valRaw] = m;
      assertCol(col);
      const val = parseValue(valRaw);
      const fn = i === 0 ? "where" : "orWhere";
      if (op === "eq") qb[fn](col, val);
      else if (op === "neq") qb[fn](col, "!=", val);
      else if (op === "is") {
        if (val === null) qb[fn](col, null);
        else qb[fn](col, "!=", null);
      }
    }
  });
}

function applyFilters(q, filters = []) {
  for (const f of filters) {
    if (f.type === "eq") {
      assertCol(f.column);
      q.where(f.column, f.value);
    } else if (f.type === "neq") {
      assertCol(f.column);
      q.where(f.column, "!=", f.value);
    } else if (f.type === "in") {
      assertCol(f.column);
      q.whereIn(f.column, f.values);
    } else if (f.type === "gte") {
      assertCol(f.column);
      q.where(f.column, ">=", f.value);
    } else if (f.type === "lte") {
      assertCol(f.column);
      q.where(f.column, "<=", f.value);
    } else if (f.type === "is") {
      assertCol(f.column);
      if (f.null) q.whereNull(f.column);
      else q.whereNotNull(f.column);
    } else if (f.type === "or") applyOrString(q, f.raw);
  }
}

function applyOrders(q, orders = []) {
  for (const o of orders) {
    assertCol(o.column);
    const dir = o.ascending === false ? "desc" : "asc";
    if (o.nullsFirst === false) {
      q.orderByRaw(`"${o.column}" ${dir} NULLS LAST`);
    } else {
      q.orderBy(o.column, dir);
    }
  }
}

function applyScope(knex, q, table, user) {
  if (!user?.id) return;
  if (user.roles?.includes("super_admin")) return;

  if (table === "restaurant_members") {
    q.where((qb) => {
      qb.where("restaurant_members.user_id", user.id);
      if (user.restaurantIds?.length) {
        qb.orWhereIn("restaurant_members.restaurant_id", user.restaurantIds);
      }
    });
    return;
  }

  if (table === "restaurants") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.where((qb) => {
        qb.whereIn("restaurants.id", ids).orWhereIn("restaurants.parent_restaurant_id", ids);
      });
    }
    return;
  }

  if (table === "profiles") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.where("profiles.id", user.id);
    } else {
      q.where((qb) => {
        qb.where("profiles.id", user.id);
        qb.orWhereIn(
          "profiles.id",
          knex("restaurant_members").select("user_id").whereIn("restaurant_id", ids),
        );
      });
    }
    return;
  }

  if (table === "user_roles") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.where("user_roles.user_id", user.id);
    } else {
      q.where((qb) => {
        qb.where("user_roles.user_id", user.id);
        qb.orWhereIn(
          "user_roles.user_id",
          knex("restaurant_members").select("user_id").whereIn("restaurant_id", ids),
        );
      });
    }
    return;
  }

  if (TENANT_QUERY_DENY.has(table)) {
    q.whereRaw("1=0");
    return;
  }

  if (table === "orders") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.where((qb) => {
        qb.whereIn("orders.restaurant_id", ids)
          .orWhereIn("orders.pending_transfer_to_restaurant_id", ids)
          .orWhereIn("orders.transferred_from_restaurant_id", ids)
          .orWhereIn(
            "orders.restaurant_id",
            knex("restaurants").select("id").whereIn("parent_restaurant_id", ids),
          )
          .orWhereIn(
            "orders.pending_transfer_to_restaurant_id",
            knex("restaurants").select("id").whereIn("parent_restaurant_id", ids),
          );
      });
    }
    return;
  }

  if (table === "order_items") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(
        "order_items.order_id",
        knex("orders")
          .select("id")
          .where((qb) => {
            qb.whereIn("restaurant_id", ids)
              .orWhereIn("pending_transfer_to_restaurant_id", ids)
              .orWhereIn("transferred_from_restaurant_id", ids)
              .orWhereIn(
                "restaurant_id",
                knex("restaurants").select("id").whereIn("parent_restaurant_id", ids),
              );
          }),
      );
    }
    return;
  }

  if (table === "order_status_history") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(
        "order_status_history.order_id",
        knex("orders")
          .select("id")
          .where((qb) => {
            qb.whereIn("restaurant_id", ids)
              .orWhereIn("pending_transfer_to_restaurant_id", ids)
              .orWhereIn("transferred_from_restaurant_id", ids)
              .orWhereIn(
                "restaurant_id",
                knex("restaurants").select("id").whereIn("parent_restaurant_id", ids),
              );
          }),
      );
    }
    return;
  }

  if (table === "drivers") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(
        "drivers.id",
        knex("driver_restaurants").select("driver_id").whereIn("restaurant_id", ids),
      );
    }
    return;
  }

  if (table === "menu_item_addons") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(
        "menu_item_addons.menu_item_id",
        knex("menu_items").select("id").whereIn("restaurant_id", ids),
      );
    }
    return;
  }

  if (table === "menu_item_variants") {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(
        "menu_item_variants.menu_item_id",
        knex("menu_items").select("id").whereIn("restaurant_id", ids),
      );
    }
    return;
  }

  if (RESTAURANT_SCOPED.has(table)) {
    const ids = user.restaurantIds || [];
    if (!ids.length) {
      q.whereRaw("1=0");
    } else {
      q.whereIn(`${table}.restaurant_id`, ids);
    }
  }
}

async function assertOrdersBelongToTenant(knex, user, orderIds) {
  if (user.roles?.includes("super_admin")) return;
  const ids = tenantIds(user);
  if (!ids.length) throw new Error("Forbidden");
  const unique = [...new Set(orderIds.filter(Boolean))];
  for (const oid of unique) {
    const row = await knex("orders")
      .where({ id: oid })
      .where((qb) => {
        qb.whereIn("restaurant_id", ids)
          .orWhereIn("pending_transfer_to_restaurant_id", ids)
          .orWhereIn("transferred_from_restaurant_id", ids)
          .orWhereIn(
            "restaurant_id",
            knex("restaurants").select("id").whereIn("parent_restaurant_id", ids),
          );
      })
      .first();
    if (!row) throw new Error("Forbidden");
  }
}

/** Validates and normalizes insert payloads so tenants cannot attach rows to other restaurants. */
async function validateAndNormalizeInsert(knex, table, rows, user) {
  if (user.roles?.includes("super_admin")) return rows;

  if (TENANT_QUERY_DENY.has(table)) {
    throw new Error("Forbidden");
  }

  const ids = tenantIds(user);

  if (table === "order_items") {
    await assertOrdersBelongToTenant(
      knex,
      user,
      rows.map((r) => r.order_id),
    );
    return rows;
  }

  if (table === "order_status_history") {
    await assertOrdersBelongToTenant(
      knex,
      user,
      rows.map((r) => r.order_id),
    );
    return rows;
  }

  if (table === "menu_item_addons") {
    if (!ids.length) throw new Error("Forbidden");
    for (const r of rows) {
      const mid = r.menu_item_id;
      if (!mid) throw new Error("menu_item_id required");
      const it = await knex("menu_items").where({ id: mid }).whereIn("restaurant_id", ids).first();
      if (!it) throw new Error("Forbidden");
    }
    return rows;
  }

  if (table === "menu_item_variants") {
    if (!ids.length) throw new Error("Forbidden");
    for (const r of rows) {
      const mid = r.menu_item_id;
      if (!mid) throw new Error("menu_item_id required");
      const it = await knex("menu_items").where({ id: mid }).whereIn("restaurant_id", ids).first();
      if (!it) throw new Error("Forbidden");
    }
    return rows;
  }

  if (table === "driver_restaurants") {
    if (!ids.length) throw new Error("Forbidden");
    for (const r of rows) {
      if (r.restaurant_id == null || !ids.includes(r.restaurant_id)) throw new Error("Invalid restaurant_id");
    }
    return rows;
  }

  if (table === "restaurant_members") {
    if (!ids.length) throw new Error("Forbidden");
    for (const r of rows) {
      const rid = r.restaurant_id;
      if (rid == null || !ids.includes(rid)) throw new Error("Invalid restaurant_id");
    }
    return rows;
  }

  if (table === "user_roles") {
    for (const r of rows) {
      const uid = r.user_id;
      if (!uid) throw new Error("user_id required");
      const okSelf = uid === user.id;
      let okPeer = false;
      if (ids.length) {
        okPeer = !!(await knex("restaurant_members").where({ user_id: uid }).whereIn("restaurant_id", ids).first());
      }
      if (!okSelf && !okPeer) throw new Error("Forbidden");
    }
    return rows;
  }

  if (RESTAURANT_SCOPED.has(table)) {
    if (!ids.length) throw new Error("Forbidden");
    if (ids.length === 1) {
      return rows.map((r) => ({ ...r, restaurant_id: ids[0] }));
    }
    for (const r of rows) {
      const rid = r.restaurant_id;
      if (rid == null || !ids.includes(rid)) throw new Error("Invalid restaurant_id");
    }
    return rows;
  }

  return rows;
}

export async function executeQuery(knex, body, user) {
  const { action, table } = body;
  if (!table || !ALLOWED_TABLES.has(table)) {
    throw new Error(`Table not allowed: ${table}`);
  }

  if (action === "select") {
    let selectCols = "*";
    if (body.columns && body.columns !== "*") {
      const parts = String(body.columns)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const p of parts) assertCol(p);
      selectCols = parts;
    }
    let q = knex(table).select(selectCols);
    applyScope(knex, q, table, user);
    applyFilters(q, body.filters);
    applyOrders(q, body.orders);
    if (body.limit != null) q.limit(body.limit);
    if (body.offset != null) q.offset(body.offset);

    if (body.count === "exact" && body.head) {
      const c = await q.clone().clearSelect().count("* as c").first();
      return { data: null, count: Number(c?.c ?? 0), error: null };
    }

    const rows = await q;
    if (body.single === "maybe") {
      return { data: rows[0] ?? null, error: null };
    }
    if (body.single === "one") {
      if (rows.length !== 1) {
        return { data: null, error: { message: rows.length === 0 ? "PGRST116" : "Multiple rows" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  if (action === "insert") {
    let rows = Array.isArray(body.values) ? body.values : [body.values];
    rows = await validateAndNormalizeInsert(knex, table, rows, user);
    let q = knex(table).insert(rows);
    if (body.onConflict) {
      const colList = body.onConflict
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[a-zA-Z0-9_]+$/.test(c));
      if (!colList.length) throw new Error("Invalid onConflict columns");
      q = q.onConflict(colList).merge();
    }
    if (body.returning) {
      const out = await q.returning("*");
      const list = Array.isArray(out) ? out : [out];
      if (body.single === "one") {
        return { data: list[0] ?? null, error: null };
      }
      if (body.single === "maybe") {
        return { data: list[0] ?? null, error: null };
      }
      return { data: list, error: null };
    }
    await q;
    return { data: null, error: null };
  }

  if (action === "update") {
    let q = knex(table).update(body.values || {});
    applyScope(knex, q, table, user);
    applyFilters(q, body.filters);
    if (body.returning) {
      const out = await q.returning("*");
      const list = Array.isArray(out) ? out : out != null ? [out] : [];
      if (body.single === "one") {
        if (list.length !== 1) {
          return {
            data: null,
            error: { message: list.length === 0 ? "No rows updated" : "Multiple rows updated" },
          };
        }
        return { data: list[0], error: null };
      }
      if (body.single === "maybe") {
        return { data: list[0] ?? null, error: null };
      }
      return { data: list, error: null };
    }
    await q;
    return { data: null, error: null };
  }

  if (action === "delete") {
    let q = knex(table).del();
    applyScope(knex, q, table, user);
    applyFilters(q, body.filters);
    await q;
    return { data: null, error: null };
  }

  throw new Error(`Unknown action: ${action}`);
}
