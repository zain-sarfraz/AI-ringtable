import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deductStockForOrder, restoreStockForOrder } from "./stockDeduction.js";

function createMockTrx(state) {
  const trx = (table) => {
    return {
      where(criteria) {
        this._where = { ...this._where, ...criteria };
        return this;
      },
      whereRaw() {
        return this;
      },
      select(...cols) {
        this._cols = cols;
        return this;
      },
      first(col) {
        const rows = (state[table] || []).filter((r) => {
          if (!this._where) return true;
          return Object.entries(this._where).every(([k, v]) => r[k] === v);
        });
        const row = rows[0] || null;
        if (!row) return Promise.resolve(null);
        if (col && typeof col === "string") return Promise.resolve({ [col]: row[col] });
        return Promise.resolve(row);
      },
      then(resolve) {
        const rows = (state[table] || []).filter((r) => {
          if (!this._where) return true;
          return Object.entries(this._where).every(([k, v]) => r[k] === v);
        });
        return Promise.resolve(rows).then(resolve);
      },
      async insert(data) {
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          const inserted = { id: `id-${Math.random()}`, ...row };
          state[table] = state[table] || [];
          state[table].push(inserted);
        }
        return rows;
      },
      async update(updates) {
        state[table] = (state[table] || []).map((r) => {
          if (!this._where) return r;
          const match = Object.entries(this._where).every(([k, v]) => r[k] === v);
          return match ? { ...r, ...updates } : r;
        });
        return 1;
      },
    };
  };

  return trx;
}

describe("stockDeduction", () => {
  const orderId = "11111111-1111-4111-8111-111111111111";
  const restaurantId = "22222222-2222-4222-8222-222222222222";
  const burgerMenuItemId = "33333333-3333-4333-8333-333333333333";
  const rawPattyId = "44444444-4444-4444-8444-444444444444";
  const rawBunId = "55555555-5555-4555-8555-555555555555";
  const recipeId = "66666666-6666-4666-8666-666666666666";

  it("deducts stock for order based on recipe ingredients", async () => {
    const state = {
      orders: [{ id: orderId, restaurant_id: restaurantId, order_number: "ORD-001", status: "confirmed" }],
      order_items: [{ id: "oi-1", order_id: orderId, menu_item_id: burgerMenuItemId, item_name: "Cheeseburger", quantity: 2 }],
      recipes: [{ id: recipeId, restaurant_id: restaurantId, selling_item_id: burgerMenuItemId, name: "Cheeseburger Recipe" }],
      recipe_ingredients: [
        { recipe_id: recipeId, inventory_item_id: rawPattyId, quantity: 1, unit: "pcs" },
        { recipe_id: recipeId, inventory_item_id: rawBunId, quantity: 1, unit: "pcs" },
      ],
      inventory_items: [
        { id: rawPattyId, name: "Burger Patty", current_stock: 10, unit: "pcs" },
        { id: rawBunId, name: "Brioche Bun", current_stock: 20, unit: "pcs" },
      ],
      inventory_transactions: [],
    };

    const trx = createMockTrx(state);
    const result = await deductStockForOrder(trx, orderId);

    assert.equal(result.success, true);
    assert.equal(result.consumed.length, 2);

    // 2 burgers x 1 patty = 2 patties consumed -> remaining stock: 8
    const patty = state.inventory_items.find((i) => i.id === rawPattyId);
    assert.equal(patty.current_stock, 8);

    // 2 burgers x 1 bun = 2 buns consumed -> remaining stock: 18
    const bun = state.inventory_items.find((i) => i.id === rawBunId);
    assert.equal(bun.current_stock, 18);

    // Transactions logged
    assert.equal(state.inventory_transactions.length, 2);
    assert.equal(state.inventory_transactions[0].transaction_type, "sale");
    assert.equal(state.inventory_transactions[0].related_order_id, orderId);
  });

  it("is idempotent: calling deductStockForOrder twice does not double-deduct", async () => {
    const state = {
      orders: [{ id: orderId, restaurant_id: restaurantId, order_number: "ORD-001", status: "confirmed" }],
      order_items: [{ id: "oi-1", order_id: orderId, menu_item_id: burgerMenuItemId, item_name: "Cheeseburger", quantity: 2 }],
      recipes: [{ id: recipeId, restaurant_id: restaurantId, selling_item_id: burgerMenuItemId, name: "Cheeseburger Recipe" }],
      recipe_ingredients: [{ recipe_id: recipeId, inventory_item_id: rawPattyId, quantity: 1, unit: "pcs" }],
      inventory_items: [{ id: rawPattyId, name: "Burger Patty", current_stock: 10, unit: "pcs" }],
      inventory_transactions: [],
    };

    const trx = createMockTrx(state);
    const firstCall = await deductStockForOrder(trx, orderId);
    assert.equal(firstCall.success, true);
    assert.equal(state.inventory_items[0].current_stock, 8);

    const secondCall = await deductStockForOrder(trx, orderId);
    assert.equal(secondCall.success, true);
    assert.equal(secondCall.alreadyDeducted, true);
    // Stock remains 8, not deducted again
    assert.equal(state.inventory_items[0].current_stock, 8);
    assert.equal(state.inventory_transactions.length, 1);
  });

  it("allows negative stock without failing the order", async () => {
    const state = {
      orders: [{ id: orderId, restaurant_id: restaurantId, order_number: "ORD-001", status: "confirmed" }],
      order_items: [{ id: "oi-1", order_id: orderId, menu_item_id: burgerMenuItemId, item_name: "Cheeseburger", quantity: 5 }],
      recipes: [{ id: recipeId, restaurant_id: restaurantId, selling_item_id: burgerMenuItemId, name: "Cheeseburger Recipe" }],
      recipe_ingredients: [{ recipe_id: recipeId, inventory_item_id: rawPattyId, quantity: 1, unit: "pcs" }],
      inventory_items: [{ id: rawPattyId, name: "Burger Patty", current_stock: 2, unit: "pcs" }],
      inventory_transactions: [],
    };

    const trx = createMockTrx(state);
    const result = await deductStockForOrder(trx, orderId);

    assert.equal(result.success, true);
    // 2 - 5 = -3 stock allowed
    assert.equal(state.inventory_items[0].current_stock, -3);
    assert.equal(result.consumed[0].is_negative, true);
  });

  it("does not fail when an item has no recipe", async () => {
    const state = {
      orders: [{ id: orderId, restaurant_id: restaurantId, order_number: "ORD-001", status: "confirmed" }],
      order_items: [{ id: "oi-1", order_id: orderId, menu_item_id: burgerMenuItemId, item_name: "Special Drink", quantity: 1 }],
      recipes: [], // No recipe for this item
      inventory_items: [],
      inventory_transactions: [],
    };

    const trx = createMockTrx(state);
    const result = await deductStockForOrder(trx, orderId);
    assert.equal(result.success, true);
    assert.equal(result.consumed.length, 0);
  });

  it("restores stock on cancelled order (restoreStockForOrder) and is idempotent", async () => {
    const state = {
      inventory_items: [{ id: rawPattyId, name: "Burger Patty", current_stock: 8, unit: "pcs" }],
      inventory_transactions: [
        {
          id: "tx-1",
          inventory_item_id: rawPattyId,
          transaction_type: "sale",
          quantity: 2,
          unit: "pcs",
          related_order_id: orderId,
        },
      ],
    };

    const trx = createMockTrx(state);
    const restoreResult = await restoreStockForOrder(trx, orderId);

    assert.equal(restoreResult.success, true);
    // 8 + 2 = 10
    assert.equal(state.inventory_items[0].current_stock, 10);

    const reversalTx = state.inventory_transactions.find((tx) => tx.transaction_type === "sale_reversal");
    assert.ok(reversalTx);
    assert.equal(reversalTx.quantity, 2);

    // Call second time -> skips because already restored
    const secondRestore = await restoreStockForOrder(trx, orderId);
    assert.equal(secondRestore.success, true);
    assert.equal(secondRestore.alreadyRestored, true);
    assert.equal(state.inventory_items[0].current_stock, 10);
  });
});
