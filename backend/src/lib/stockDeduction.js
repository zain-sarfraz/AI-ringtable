import { getKnex } from "../db.js";

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(str || ""));
}

/**
 * Deduct raw materials for an order based on recipes.
 * Idempotent: If inventory_transactions already exist for this order_id with type 'sale', skips.
 *
 * @param {import("knex").Knex | import("knex").Knex.Transaction} trxOrKnex
 * @param {string} orderId
 * @returns {Promise<{ success: boolean, alreadyDeducted?: boolean, consumed: Array<any>, warning?: string }>}
 */
export async function deductStockForOrder(trxOrKnex, orderId) {
  if (!orderId || !isValidUUID(orderId)) {
    return { success: false, consumed: [], warning: "Invalid order ID" };
  }

  const knex = trxOrKnex || getKnex();

  const runWithTrx = async (trx) => {
    // 1. Idempotency guard: if already deducted for this order, do nothing
    const existing = await trx("inventory_transactions")
      .where({ related_order_id: orderId, transaction_type: "sale" })
      .first("id");

    if (existing) {
      return { success: true, alreadyDeducted: true, consumed: [] };
    }

    // 2. Fetch order and line items
    const order = await trx("orders")
      .where({ id: orderId })
      .select("id", "restaurant_id", "order_number", "status")
      .first();

    if (!order) {
      return { success: false, consumed: [], warning: `Order ${orderId} not found` };
    }

    const items = await trx("order_items")
      .where({ order_id: orderId })
      .select("id", "menu_item_id", "item_name", "quantity");

    if (!items || items.length === 0) {
      return { success: true, consumed: [] };
    }

    const consumed = [];

    // 3. Loop through order items and deduct recipe ingredients
    for (const item of items) {
      let menuItemId = item.menu_item_id;

      // Fallback: match by item_name in current restaurant or parent if menu_item_id is not set
      if (!menuItemId || !isValidUUID(menuItemId)) {
        const found = await trx("menu_items")
          .where({ restaurant_id: order.restaurant_id })
          .whereRaw("LOWER(TRIM(name)) = ?", [String(item.item_name || "").trim().toLowerCase()])
          .first("id");
        if (found) {
          menuItemId = found.id;
        }
      }

      if (!menuItemId || !isValidUUID(menuItemId)) {
        console.warn(`[stockDeduction] Item "${item.item_name}" has no menu_item_id and could not be matched; skipping stock deduction.`);
        continue;
      }

      const orderedQty = Math.max(1, Number(item.quantity) || 1);

      // Find recipe for this menu item (check current restaurant first, then parent if branch)
      let recipe = await trx("recipes")
        .where({ selling_item_id: menuItemId, restaurant_id: order.restaurant_id })
        .first();

      if (!recipe) {
        const rest = await trx("restaurants").where({ id: order.restaurant_id }).first("parent_restaurant_id");
        if (rest?.parent_restaurant_id) {
          recipe = await trx("recipes")
            .where({ selling_item_id: menuItemId, restaurant_id: rest.parent_restaurant_id })
            .first();
        }
      }

      if (!recipe) {
        console.warn(`[stockDeduction] Menu item "${item.item_name}" (${menuItemId}) has no recipe configured.`);
        continue;
      }

      const ingredients = await trx("recipe_ingredients")
        .where({ recipe_id: recipe.id })
        .select("inventory_item_id", "quantity", "unit");

      for (const ing of ingredients) {
        const qtyNeeded = Number(ing.quantity || 0) * orderedQty;
        if (qtyNeeded <= 0) continue;

        const invItem = await trx("inventory_items").where({ id: ing.inventory_item_id }).first();
        if (invItem) {
          const currentStock = Number(invItem.current_stock || 0);
          // Allow negative stock but log warning
          const newStock = Math.round((currentStock - qtyNeeded) * 100) / 100;
          if (newStock < 0) {
            console.warn(
              `[stockDeduction] WARNING: Inventory item "${invItem.name}" stock went negative (${newStock} ${ing.unit}) on Order #${order.order_number}`
            );
          }

          await trx("inventory_items")
            .where({ id: ing.inventory_item_id })
            .update({
              current_stock: newStock,
              updated_at: new Date(),
            });

          await trx("inventory_transactions").insert({
            inventory_item_id: ing.inventory_item_id,
            transaction_type: "sale",
            quantity: qtyNeeded,
            unit: ing.unit,
            related_order_id: order.id,
            notes: `Used in ${orderedQty}x ${item.item_name} (Order #${order.order_number})`,
          });

          consumed.push({
            name: invItem.name,
            consumed_quantity: qtyNeeded,
            unit: ing.unit,
            remaining_stock: newStock,
            is_negative: newStock < 0,
          });
        }
      }
    }

    return { success: true, consumed };
  };

  if (typeof trxOrKnex.transaction === "function") {
    return trxOrKnex.transaction(runWithTrx);
  }
  return runWithTrx(trxOrKnex);
}

/**
 * Restore raw materials for a cancelled order.
 * Idempotent: If inventory_transactions already exist for this order_id with type 'sale_reversal', skips.
 *
 * @param {import("knex").Knex | import("knex").Knex.Transaction} trxOrKnex
 * @param {string} orderId
 * @returns {Promise<{ success: boolean, alreadyRestored?: boolean, restored: Array<any> }>}
 */
export async function restoreStockForOrder(trxOrKnex, orderId) {
  if (!orderId || !isValidUUID(orderId)) {
    return { success: false, restored: [], warning: "Invalid order ID" };
  }

  const knex = trxOrKnex || getKnex();

  const runWithTrx = async (trx) => {
    // 1. Check if already restored
    const existingReversal = await trx("inventory_transactions")
      .where({ related_order_id: orderId, transaction_type: "sale_reversal" })
      .first("id");

    if (existingReversal) {
      return { success: true, alreadyRestored: true, restored: [] };
    }

    // 2. Fetch original sale deductions for this order
    const sales = await trx("inventory_transactions")
      .where({ related_order_id: orderId, transaction_type: "sale" });

    if (!sales || sales.length === 0) {
      return { success: true, nothingToRestore: true, restored: [] };
    }

    const restored = [];

    // 3. For each sale transaction, add stock back and log sale_reversal
    for (const sale of sales) {
      const invItem = await trx("inventory_items").where({ id: sale.inventory_item_id }).first();
      if (invItem) {
        const qtyToRestore = Number(sale.quantity || 0);
        const newStock = Math.round((Number(invItem.current_stock || 0) + qtyToRestore) * 100) / 100;

        await trx("inventory_items")
          .where({ id: sale.inventory_item_id })
          .update({
            current_stock: newStock,
            updated_at: new Date(),
          });

        await trx("inventory_transactions").insert({
          inventory_item_id: sale.inventory_item_id,
          transaction_type: "sale_reversal",
          quantity: qtyToRestore,
          unit: sale.unit,
          related_order_id: orderId,
          notes: `Order cancelled - stock restored (${qtyToRestore} ${sale.unit})`,
        });

        restored.push({
          name: invItem.name,
          restored_quantity: qtyToRestore,
          unit: sale.unit,
          remaining_stock: newStock,
        });
      }
    }

    return { success: true, restored };
  };

  if (typeof trxOrKnex.transaction === "function") {
    return trxOrKnex.transaction(runWithTrx);
  }
  return runWithTrx(trxOrKnex);
}
