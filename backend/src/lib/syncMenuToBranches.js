import { randomUUID } from "node:crypto";

const MENU_PROPAGATE_TABLES = new Set([
  "menu_categories",
  "menu_sub_categories",
  "menu_items",
  "menu_addons",
  "menu_item_variants",
  "menu_item_addons",
]);

function normName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function columnsOf(knex, table) {
  const result = await knex.raw(
    `select column_name from information_schema.columns
     where table_name = ? and table_schema = any (current_schemas(false))`,
    [table],
  );
  return new Set((result.rows || []).map((row) => row.column_name));
}

function pickExisting(row, columns) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (columns.has(k)) out[k] = v;
  }
  return out;
}

async function listActiveBranches(knex, parentRestaurantId) {
  return knex("restaurants")
    .where({ parent_restaurant_id: parentRestaurantId })
    .where((qb) => {
      qb.whereNull("is_active").orWhere("is_active", true);
    })
    .select("id", "name");
}

async function isPropagatingParent(knex, restaurantId) {
  if (!restaurantId) return false;
  const rest = await knex("restaurants").where({ id: restaurantId }).first();
  if (!rest) return false;
  if (rest.is_branch || rest.parent_restaurant_id) return false;
  const branches = await listActiveBranches(knex, restaurantId);
  return branches.length > 0;
}

async function findBranchCategory(knex, branchId, name) {
  const rows = await knex("menu_categories").where({ restaurant_id: branchId });
  const key = normName(name);
  return rows.find((r) => normName(r.name) === key) || null;
}

async function findBranchItem(knex, branchId, name) {
  const rows = await knex("menu_items").where({ restaurant_id: branchId });
  const key = normName(name);
  return rows.find((r) => normName(r.name) === key) || null;
}

async function findBranchAddon(knex, branchId, name) {
  const rows = await knex("menu_addons").where({ restaurant_id: branchId });
  const key = normName(name);
  return rows.find((r) => normName(r.name) === key) || null;
}

async function resolveRestaurantIdForRow(knex, table, row) {
  if (!row) return null;
  if (row.restaurant_id) return row.restaurant_id;
  if (table === "menu_item_variants" || table === "menu_item_addons") {
    if (!row.menu_item_id) return null;
    const item = await knex("menu_items").where({ id: row.menu_item_id }).first();
    return item?.restaurant_id || null;
  }
  if (table === "menu_sub_categories" && row.category_id) {
    const cat = await knex("menu_categories").where({ id: row.category_id }).first();
    return cat?.restaurant_id || null;
  }
  return null;
}

async function syncCategoryToBranch(knex, { action, parentRow, matchName, branchId, categoryColumns }) {
  const existing = await findBranchCategory(knex, branchId, matchName || parentRow?.name);
  if (action === "delete") {
    if (existing) await knex("menu_categories").where({ id: existing.id }).del();
    return;
  }
  if (!parentRow) return;
  const payload = pickExisting(
    {
      ...parentRow,
      id: existing?.id || randomUUID(),
      restaurant_id: branchId,
      name: parentRow.name,
    },
    categoryColumns,
  );
  delete payload.created_at;
  delete payload.updated_at;
  if (existing) {
    const { id, ...rest } = payload;
    await knex("menu_categories").where({ id: existing.id }).update(rest);
  } else {
    await knex("menu_categories").insert(payload);
  }
}

async function syncSubCategoryToBranch(knex, { action, parentRow, matchName, branchId, subColumns }) {
  if (!parentRow && action !== "delete") return;
  const parentCat = parentRow?.category_id
    ? await knex("menu_categories").where({ id: parentRow.category_id }).first()
    : null;
  if (!parentCat && action !== "delete") return;

  let branchCat = parentCat ? await findBranchCategory(knex, branchId, parentCat.name) : null;
  if (!branchCat && action !== "delete") {
    // Ensure category exists on branch first
    const catCols = await columnsOf(knex, "menu_categories");
    await syncCategoryToBranch(knex, {
      action: "upsert",
      parentRow: parentCat,
      matchName: parentCat.name,
      branchId,
      categoryColumns: catCols,
    });
    branchCat = await findBranchCategory(knex, branchId, parentCat.name);
  }
  if (!branchCat) return;

  const branchSubs = await knex("menu_sub_categories").where({ category_id: branchCat.id });
  const key = normName(matchName || parentRow?.name);
  const existing = branchSubs.find((r) => normName(r.name) === key) || null;

  if (action === "delete") {
    if (existing) await knex("menu_sub_categories").where({ id: existing.id }).del();
    return;
  }

  const payload = pickExisting(
    {
      ...parentRow,
      id: existing?.id || randomUUID(),
      category_id: branchCat.id,
      name: parentRow.name,
    },
    subColumns,
  );
  delete payload.created_at;
  delete payload.updated_at;
  if (existing) {
    const { id, ...rest } = payload;
    await knex("menu_sub_categories").where({ id: existing.id }).update(rest);
  } else {
    await knex("menu_sub_categories").insert(payload);
  }
}

async function syncItemToBranch(knex, { action, parentRow, matchName, branchId, itemColumns }) {
  const existing = await findBranchItem(knex, branchId, matchName || parentRow?.name);
  if (action === "delete") {
    if (existing) await knex("menu_items").where({ id: existing.id }).del();
    return existing;
  }
  if (!parentRow) return null;

  let branchCategoryId = null;
  if (parentRow.category_id) {
    const parentCat = await knex("menu_categories").where({ id: parentRow.category_id }).first();
    if (parentCat) {
      let branchCat = await findBranchCategory(knex, branchId, parentCat.name);
      if (!branchCat) {
        const catCols = await columnsOf(knex, "menu_categories");
        await syncCategoryToBranch(knex, {
          action: "upsert",
          parentRow: parentCat,
          matchName: parentCat.name,
          branchId,
          categoryColumns: catCols,
        });
        branchCat = await findBranchCategory(knex, branchId, parentCat.name);
      }
      branchCategoryId = branchCat?.id || null;
    }
  }

  let branchSubCategoryId = null;
  if (parentRow.sub_category_id && branchCategoryId) {
    const parentSub = await knex("menu_sub_categories").where({ id: parentRow.sub_category_id }).first();
    if (parentSub) {
      const subCols = await columnsOf(knex, "menu_sub_categories");
      await syncSubCategoryToBranch(knex, {
        action: "upsert",
        parentRow: parentSub,
        matchName: parentSub.name,
        branchId,
        subColumns: subCols,
      });
      const branchSubs = await knex("menu_sub_categories").where({ category_id: branchCategoryId });
      branchSubCategoryId = branchSubs.find((s) => normName(s.name) === normName(parentSub.name))?.id || null;
    }
  }

  const payload = pickExisting(
    {
      ...parentRow,
      id: existing?.id || randomUUID(),
      restaurant_id: branchId,
      category_id: branchCategoryId,
      sub_category_id: branchSubCategoryId,
      name: parentRow.name,
      // Keep branch-local stock independent when parent only changes catalog fields
      stock_quantity: existing?.stock_quantity ?? parentRow.stock_quantity ?? null,
    },
    itemColumns,
  );
  delete payload.created_at;
  delete payload.updated_at;

  if (existing) {
    const { id, ...rest } = payload;
    // Don't overwrite branch-only inventory unless parent explicitly toggled availability via catalog sync of other fields
    await knex("menu_items").where({ id: existing.id }).update(rest);
    return existing;
  }
  await knex("menu_items").insert(payload);
  return { id: payload.id, name: payload.name };
}

async function syncAddonToBranch(knex, { action, parentRow, matchName, branchId, addonColumns }) {
  const existing = await findBranchAddon(knex, branchId, matchName || parentRow?.name);
  if (action === "delete") {
    if (existing) await knex("menu_addons").where({ id: existing.id }).del();
    return;
  }
  if (!parentRow) return;
  const payload = pickExisting(
    {
      ...parentRow,
      id: existing?.id || randomUUID(),
      restaurant_id: branchId,
      name: parentRow.name,
    },
    addonColumns,
  );
  delete payload.created_at;
  delete payload.updated_at;
  if (existing) {
    const { id, ...rest } = payload;
    await knex("menu_addons").where({ id: existing.id }).update(rest);
  } else {
    await knex("menu_addons").insert(payload);
  }
}

async function syncVariantsForParentItem(knex, { parentItemId, branchItemId, variantColumns }) {
  const parentVariants = await knex("menu_item_variants")
    .where({ menu_item_id: parentItemId })
    .orderBy("sort_order", "asc");

  await knex("menu_item_variants").where({ menu_item_id: branchItemId }).del();
  if (!parentVariants.length) return;

  const idMap = new Map();
  for (const pv of parentVariants) idMap.set(pv.id, randomUUID());

  // Insert parents (sizes) first so flavor parent_id FK never breaks
  const roots = parentVariants.filter((pv) => !pv.parent_id);
  const children = parentVariants.filter((pv) => pv.parent_id);

  const insertOne = async (pv) => {
    const payload = pickExisting(
      {
        ...pv,
        id: idMap.get(pv.id),
        menu_item_id: branchItemId,
        parent_id: pv.parent_id ? idMap.get(pv.parent_id) || null : null,
      },
      variantColumns,
    );
    delete payload.created_at;
    delete payload.updated_at;
    // Drop unmapped parent_id rather than inserting a dangling FK
    if (payload.parent_id && !idMap.has(pv.parent_id)) {
      payload.parent_id = null;
    }
    await knex("menu_item_variants").insert(payload);
  };

  for (const pv of roots) await insertOne(pv);
  for (const pv of children) await insertOne(pv);
}

async function syncItemAddonsForParentItem(knex, { parentItemId, branchItemId, branchId }) {
  const parentLinks = await knex("menu_item_addons").where({ menu_item_id: parentItemId });
  await knex("menu_item_addons").where({ menu_item_id: branchItemId }).del();
  if (!parentLinks.length) return;

  const parentAddonIds = parentLinks.map((l) => l.menu_addon_id).filter(Boolean);
  const parentAddons = parentAddonIds.length
    ? await knex("menu_addons").whereIn("id", parentAddonIds)
    : [];
  const addonCols = await columnsOf(knex, "menu_addons");

  for (const pa of parentAddons) {
    await syncAddonToBranch(knex, {
      action: "upsert",
      parentRow: pa,
      matchName: pa.name,
      branchId,
      addonColumns: addonCols,
    });
  }

  const branchAddons = await knex("menu_addons").where({ restaurant_id: branchId });
  const byName = new Map(branchAddons.map((a) => [normName(a.name), a.id]));
  const parentAddonById = new Map(parentAddons.map((a) => [a.id, a]));

  // menu_item_addons is a junction table (no id column)
  const rows = [];
  const seen = new Set();
  for (const link of parentLinks) {
    const pa = parentAddonById.get(link.menu_addon_id);
    if (!pa) continue;
    const branchAddonId = byName.get(normName(pa.name));
    if (!branchAddonId) continue;
    const key = `${branchItemId}:${branchAddonId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      menu_item_id: branchItemId,
      menu_addon_id: branchAddonId,
    });
  }
  if (rows.length) await knex("menu_item_addons").insert(rows);
}

/**
 * After a parent-HQ menu write, mirror the change onto every active branch.
 * Branch-local edits never call this (only non-branch parents propagate).
 */
export async function propagateMenuWriteToBranches(knex, { table, action, rows = [], deletedRows = [] }) {
  if (!MENU_PROPAGATE_TABLES.has(table)) return;
  if (!["insert", "update", "delete", "upsert"].includes(action)) return;

  try {
    const affected = action === "delete" ? deletedRows : rows;
    if (!affected?.length) return;

    const categoryColumns = await columnsOf(knex, "menu_categories");
    const subColumns = await columnsOf(knex, "menu_sub_categories");
    const itemColumns = await columnsOf(knex, "menu_items");
    const addonColumns = await columnsOf(knex, "menu_addons");
    const variantColumns = await columnsOf(knex, "menu_item_variants");

    for (const row of affected) {
      const restaurantId = await resolveRestaurantIdForRow(knex, table, row);
      if (!(await isPropagatingParent(knex, restaurantId))) continue;

      const branches = await listActiveBranches(knex, restaurantId);
      if (!branches.length) continue;

      for (const branch of branches) {
        if (table === "menu_categories") {
          await syncCategoryToBranch(knex, {
            action,
            parentRow: row,
            matchName: row.name,
            branchId: branch.id,
            categoryColumns,
          });
        } else if (table === "menu_sub_categories") {
          await syncSubCategoryToBranch(knex, {
            action,
            parentRow: row,
            matchName: row.name,
            branchId: branch.id,
            subColumns,
          });
        } else if (table === "menu_items") {
          const branchItem = await syncItemToBranch(knex, {
            action,
            parentRow: row,
            matchName: row.name,
            branchId: branch.id,
            itemColumns,
          });
          if (action !== "delete" && branchItem?.id && row.id) {
            await syncVariantsForParentItem(knex, {
              parentItemId: row.id,
              branchItemId: branchItem.id,
              variantColumns,
            });
            await syncItemAddonsForParentItem(knex, {
              parentItemId: row.id,
              branchItemId: branchItem.id,
              branchId: branch.id,
            });
          }
        } else if (table === "menu_addons") {
          await syncAddonToBranch(knex, {
            action,
            parentRow: row,
            matchName: row.name,
            branchId: branch.id,
            addonColumns,
          });
        } else if (table === "menu_item_variants") {
          const parentItem = await knex("menu_items").where({ id: row.menu_item_id }).first();
          if (!parentItem) continue;
          const branchItem = await findBranchItem(knex, branch.id, parentItem.name);
          if (!branchItem) continue;
          // Rebuild full variant set from parent after any variant write
          await syncVariantsForParentItem(knex, {
            parentItemId: parentItem.id,
            branchItemId: branchItem.id,
            variantColumns,
          });
        } else if (table === "menu_item_addons") {
          const parentItem = await knex("menu_items").where({ id: row.menu_item_id }).first();
          if (!parentItem) continue;
          const branchItem = await findBranchItem(knex, branch.id, parentItem.name);
          if (!branchItem) continue;
          await syncItemAddonsForParentItem(knex, {
            parentItemId: parentItem.id,
            branchItemId: branchItem.id,
            branchId: branch.id,
          });
        }
      }
    }
  } catch (err) {
    console.error("[syncMenuToBranches] propagate failed:", err.message);
  }
}

/**
 * Push one parent HQ menu item (with all sizes/flavors/add-ons) to every active branch.
 * Call this AFTER the parent item AND its variants/addons are fully saved.
 */
export async function syncParentItemFullyToBranches(knex, parentItemId) {
  const parentItem = await knex("menu_items").where({ id: parentItemId }).first();
  if (!parentItem?.restaurant_id) {
    return { synced: false, reason: "item_not_found", branches: 0 };
  }
  if (!(await isPropagatingParent(knex, parentItem.restaurant_id))) {
    return { synced: false, reason: "not_parent_hq", branches: 0 };
  }

  const branches = await listActiveBranches(knex, parentItem.restaurant_id);
  if (!branches.length) return { synced: true, reason: "no_branches", branches: 0 };

  const itemColumns = await columnsOf(knex, "menu_items");
  const variantColumns = await columnsOf(knex, "menu_item_variants");

  let syncedBranches = 0;
  const errors = [];
  for (const branch of branches) {
    try {
      const branchItem = await syncItemToBranch(knex, {
        action: "upsert",
        parentRow: parentItem,
        matchName: parentItem.name,
        branchId: branch.id,
        itemColumns,
      });
      if (!branchItem?.id) continue;

      await syncVariantsForParentItem(knex, {
        parentItemId: parentItem.id,
        branchItemId: branchItem.id,
        variantColumns,
      });
      await syncItemAddonsForParentItem(knex, {
        parentItemId: parentItem.id,
        branchItemId: branchItem.id,
        branchId: branch.id,
      });
      syncedBranches += 1;
    } catch (err) {
      console.error(
        `[syncParentItemFullyToBranches] branch "${branch.name}" failed:`,
        err?.message || err,
      );
      errors.push({ branchId: branch.id, error: err?.message || String(err) });
    }
  }

  return {
    synced: errors.length === 0,
    branches: syncedBranches,
    itemId: parentItemId,
    itemName: parentItem.name,
    errors: errors.length ? errors : undefined,
  };
}

/**
 * For an existing branch: copy any missing parent catalog pieces
 * (items / sizes / flavors / add-ons) so ordering UI matches HQ.
 * Rebuilds variants/addons whenever parent has more than the branch
 * (fixes partial sync where only 1 size was copied).
 */
export async function healBranchMenuFromParent(knex, branchId, { forceRebuildVariants = false } = {}) {
  const branch = await knex("restaurants").where({ id: branchId }).first();
  if (!branch?.parent_restaurant_id) {
    return { healed: false, reason: "not_a_branch", items: 0, variants: 0 };
  }
  const parentId = branch.parent_restaurant_id;

  const categoryColumns = await columnsOf(knex, "menu_categories");
  const subColumns = await columnsOf(knex, "menu_sub_categories");
  const itemColumns = await columnsOf(knex, "menu_items");
  const addonColumns = await columnsOf(knex, "menu_addons");
  const variantColumns = await columnsOf(knex, "menu_item_variants");

  const parentCats = await knex("menu_categories").where({ restaurant_id: parentId });
  for (const cat of parentCats) {
    await syncCategoryToBranch(knex, {
      action: "upsert",
      parentRow: cat,
      matchName: cat.name,
      branchId,
      categoryColumns,
    });
  }

  const parentCatIds = parentCats.map((c) => c.id);
  const parentSubs = parentCatIds.length
    ? await knex("menu_sub_categories").whereIn("category_id", parentCatIds)
    : [];
  for (const sub of parentSubs) {
    await syncSubCategoryToBranch(knex, {
      action: "upsert",
      parentRow: sub,
      matchName: sub.name,
      branchId,
      subColumns,
    });
  }

  const parentAddons = await knex("menu_addons").where({ restaurant_id: parentId });
  for (const addon of parentAddons) {
    await syncAddonToBranch(knex, {
      action: "upsert",
      parentRow: addon,
      matchName: addon.name,
      branchId,
      addonColumns,
    });
  }

  const parentItems = await knex("menu_items").where({ restaurant_id: parentId });
  let itemsTouched = 0;
  let variantsHealed = 0;

  for (const parentItem of parentItems) {
    try {
    // Create missing branch items from parent; never overwrite branch price/stock on heal.
    let branchItem = await findBranchItem(knex, branchId, parentItem.name);
    if (!branchItem) {
      branchItem = await syncItemToBranch(knex, {
        action: "insert",
        parentRow: parentItem,
        matchName: parentItem.name,
        branchId,
        itemColumns,
      });
    }
    if (!branchItem?.id) continue;
    itemsTouched += 1;

    const existingVariantCount = Number(
      (
        await knex("menu_item_variants")
          .where({ menu_item_id: branchItem.id })
          .count("* as c")
          .first()
      )?.c || 0,
    );
    const parentVariantCount = Number(
      (
        await knex("menu_item_variants")
          .where({ menu_item_id: parentItem.id })
          .count("* as c")
          .first()
      )?.c || 0,
    );

    // Rebuild whenever incomplete (e.g. parent has 4 sizes, branch only has 1)
    if (
      parentVariantCount > 0 &&
      (forceRebuildVariants || existingVariantCount !== parentVariantCount)
    ) {
      await syncVariantsForParentItem(knex, {
        parentItemId: parentItem.id,
        branchItemId: branchItem.id,
        variantColumns,
      });
      variantsHealed += 1;
    }

    const existingAddonLinks = Number(
      (
        await knex("menu_item_addons")
          .where({ menu_item_id: branchItem.id })
          .count("* as c")
          .first()
      )?.c || 0,
    );
    const parentAddonLinks = Number(
      (
        await knex("menu_item_addons")
          .where({ menu_item_id: parentItem.id })
          .count("* as c")
          .first()
      )?.c || 0,
    );
    if (
      parentAddonLinks > 0 &&
      (forceRebuildVariants || existingAddonLinks !== parentAddonLinks)
    ) {
      await syncItemAddonsForParentItem(knex, {
        parentItemId: parentItem.id,
        branchItemId: branchItem.id,
        branchId,
      });
    }

    // Keep category / sub-category labels in sync without touching branch price/stock
    if (parentItem.category_id || parentItem.sub_category_id) {
      let branchCategoryId = branchItem.category_id || null;
      if (parentItem.category_id) {
        const parentCat = await knex("menu_categories").where({ id: parentItem.category_id }).first();
        if (parentCat) {
          let branchCat = await findBranchCategory(knex, branchId, parentCat.name);
          if (!branchCat) {
            await syncCategoryToBranch(knex, {
              action: "upsert",
              parentRow: parentCat,
              matchName: parentCat.name,
              branchId,
              categoryColumns,
            });
            branchCat = await findBranchCategory(knex, branchId, parentCat.name);
          }
          branchCategoryId = branchCat?.id || branchCategoryId;
        }
      }
      let branchSubCategoryId = null;
      if (parentItem.sub_category_id && branchCategoryId) {
        const parentSub = await knex("menu_sub_categories").where({ id: parentItem.sub_category_id }).first();
        if (parentSub) {
          await syncSubCategoryToBranch(knex, {
            action: "upsert",
            parentRow: parentSub,
            matchName: parentSub.name,
            branchId,
            subColumns,
          });
          const branchSubs = await knex("menu_sub_categories").where({ category_id: branchCategoryId });
          branchSubCategoryId =
            branchSubs.find((s) => normName(s.name) === normName(parentSub.name))?.id || null;
        }
      }
      await knex("menu_items").where({ id: branchItem.id }).update({
        category_id: branchCategoryId,
        sub_category_id: branchSubCategoryId,
        description: parentItem.description ?? null,
        dietary_tags: Array.isArray(parentItem.dietary_tags) ? parentItem.dietary_tags : parentItem.dietary_tags,
        spice_level: parentItem.spice_level,
        prep_time_minutes: parentItem.prep_time_minutes,
        max_order_quantity: parentItem.max_order_quantity,
        image_url: parentItem.image_url,
        is_available: parentItem.is_available,
      });
    }
    } catch (itemErr) {
      console.error(
        `[healBranchMenuFromParent] skipped item "${parentItem?.name}":`,
        itemErr?.message || itemErr,
      );
    }
  }

  return { healed: true, items: itemsTouched, variants: variantsHealed, parentId, branchId };
}

export { MENU_PROPAGATE_TABLES };
