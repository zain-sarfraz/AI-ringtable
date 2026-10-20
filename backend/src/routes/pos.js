import { Router } from "express";
import { getKnex } from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { nextOrderNumber } from "../lib/orderNumbers.js";
import { deductStockForOrder } from "../lib/stockDeduction.js";

const router = Router();

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(str || ""));
}

function checkRestaurantAccess(req, restaurantId) {
  if (!restaurantId || !isValidUUID(restaurantId)) return false;
  if (req.user?.roles?.includes("super_admin")) return true;
  const userRestaurants = req.user?.restaurantIds || [];
  return userRestaurants.includes(restaurantId);
}

// -------------------------------------------------------------------------
// 1. POS & INVENTORY SUMMARY: Total Sales vs Total Purchasing + Profit
// -------------------------------------------------------------------------
router.get("/summary", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  const period = req.query.period || "all"; // 'today', 'week', 'month', 'all'

  try {
    // Base orders query (excluding cancelled)
    let salesQuery = knex("orders")
      .where({ restaurant_id: restaurantId })
      .whereNot({ status: "cancelled" });

    // Base purchases query (excluding cancelled)
    let purchasesQuery = knex("purchases")
      .where({ restaurant_id: restaurantId })
      .whereNot({ status: "cancelled" });

    if (period === "today") {
      salesQuery = salesQuery.whereRaw("created_at >= CURRENT_DATE");
      purchasesQuery = purchasesQuery.whereRaw("purchase_date >= CURRENT_DATE");
    } else if (period === "week") {
      salesQuery = salesQuery.whereRaw("created_at >= CURRENT_DATE - INTERVAL '7 days'");
      purchasesQuery = purchasesQuery.whereRaw("purchase_date >= CURRENT_DATE - INTERVAL '7 days'");
    } else if (period === "month") {
      salesQuery = salesQuery.whereRaw("created_at >= CURRENT_DATE - INTERVAL '30 days'");
      purchasesQuery = purchasesQuery.whereRaw("purchase_date >= CURRENT_DATE - INTERVAL '30 days'");
    }

    const [salesStat] = await salesQuery.select(
      knex.raw("COALESCE(SUM(total_amount), 0) as total_sales"),
      knex.raw("COUNT(id) as total_orders")
    );

    const [purchasesStat] = await purchasesQuery.select(
      knex.raw("COALESCE(SUM(total_amount), 0) as total_purchases"),
      knex.raw("COUNT(id) as total_purchases_count")
    );

    const totalSales = Number(salesStat?.total_sales || 0);
    const totalPurchases = Number(purchasesStat?.total_purchases || 0);
    const totalOrders = Number(salesStat?.total_orders || 0);
    const totalPurchasesCount = Number(purchasesStat?.total_purchases_count || 0);
    const grossProfit = totalSales - totalPurchases;
    const marginPercent = totalSales > 0 ? Math.round(((grossProfit / totalSales) * 100) * 10) / 10 : 0;

    // Inventory status (stock value and count)
    const inventoryStats = await knex("inventory_items")
      .where({ restaurant_id: restaurantId, status: "active" })
      .select(
        knex.raw("COUNT(id) as total_items"),
        knex.raw("COALESCE(SUM(current_stock * cost_price), 0) as total_stock_value"),
        knex.raw("COUNT(CASE WHEN current_stock <= minimum_stock THEN 1 END) as low_stock_count"),
        knex.raw("COUNT(CASE WHEN current_stock <= 0 THEN 1 END) as out_of_stock_count")
      )
      .first();

    // Recent sales
    const recentSales = await knex("orders")
      .where({ restaurant_id: restaurantId })
      .whereNot({ status: "cancelled" })
      .orderBy("created_at", "desc")
      .limit(6)
      .select("id", "order_number", "customer_name", "total_amount", "payment_method", "fulfillment_type", "status", "created_at");

    // Recent purchases
    const recentPurchases = await knex("purchases")
      .leftJoin("suppliers", "purchases.supplier_id", "suppliers.id")
      .where({ "purchases.restaurant_id": restaurantId })
      .orderBy("purchases.purchase_date", "desc")
      .limit(6)
      .select(
        "purchases.id",
        "purchases.purchase_date",
        "purchases.total_amount",
        "purchases.status",
        "purchases.notes",
        "suppliers.name as supplier_name",
        "suppliers.company_name as supplier_company"
      );

    // Top 5 consumed raw materials
    const topUsed = await knex("inventory_transactions")
      .join("inventory_items", "inventory_transactions.inventory_item_id", "inventory_items.id")
      .where({ "inventory_items.restaurant_id": restaurantId, "inventory_transactions.transaction_type": "sale" })
      .groupBy("inventory_items.id", "inventory_items.name", "inventory_items.unit", "inventory_items.cost_price")
      .select(
        "inventory_items.id",
        "inventory_items.name",
        "inventory_items.unit",
        "inventory_items.cost_price",
        knex.raw("COALESCE(SUM(inventory_transactions.quantity), 0) as total_quantity_used"),
        knex.raw("COALESCE(SUM(inventory_transactions.quantity * inventory_items.cost_price), 0) as total_cost_used")
      )
      .orderBy("total_quantity_used", "desc")
      .limit(5);

    // Sales by fulfillment type
    const fulfillmentBreakdown = await knex("orders")
      .where({ restaurant_id: restaurantId })
      .whereNot({ status: "cancelled" })
      .groupBy("fulfillment_type")
      .select(
        "fulfillment_type",
        knex.raw("COUNT(id) as count"),
        knex.raw("COALESCE(SUM(total_amount), 0) as total")
      );

    return res.json({
      summary: {
        total_sales: totalSales,
        total_purchases: totalPurchases,
        gross_profit: grossProfit,
        margin_percent: marginPercent,
        total_orders: totalOrders,
        total_purchases_count: totalPurchasesCount,
        total_raw_materials: Number(inventoryStats?.total_items || 0),
        stock_value: Number(inventoryStats?.total_stock_value || 0),
        low_stock_count: Number(inventoryStats?.low_stock_count || 0),
        out_of_stock_count: Number(inventoryStats?.out_of_stock_count || 0),
      },
      recent_sales: recentSales,
      recent_purchases: recentPurchases,
      top_used_materials: topUsed.map(u => ({
        ...u,
        total_quantity_used: Number(u.total_quantity_used),
        total_cost_used: Number(u.total_cost_used),
      })),
      fulfillment_breakdown: fulfillmentBreakdown,
    });
  } catch (err) {
    console.error("POS summary error:", err);
    return res.status(500).json({ error: err.message || "Failed to load POS summary" });
  }
});

// -------------------------------------------------------------------------
// 2. RAW MATERIALS (INVENTORY ITEMS): List, Create, Update, Delete & Stock Adjust
// -------------------------------------------------------------------------
router.get("/raw-materials", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const items = await knex("inventory_items")
      .leftJoin("inventory_categories", "inventory_items.category_id", "inventory_categories.id")
      .leftJoin("suppliers", "inventory_items.supplier_id", "suppliers.id")
      .where({ "inventory_items.restaurant_id": restaurantId })
      .select(
        "inventory_items.*",
        "inventory_categories.name as category_name",
        "suppliers.name as supplier_name",
        "suppliers.company_name as supplier_company"
      )
      .orderBy("inventory_items.name", "asc");

    // Compute total purchased & total used for each item
    const transactions = await knex("inventory_transactions")
      .join("inventory_items", "inventory_transactions.inventory_item_id", "inventory_items.id")
      .where({ "inventory_items.restaurant_id": restaurantId })
      .groupBy("inventory_transactions.inventory_item_id", "inventory_transactions.transaction_type")
      .select(
        "inventory_transactions.inventory_item_id",
        "inventory_transactions.transaction_type",
        knex.raw("COALESCE(SUM(inventory_transactions.quantity), 0) as total_qty")
      );

    const txMap = {};
    for (const tx of transactions) {
      if (!txMap[tx.inventory_item_id]) {
        txMap[tx.inventory_item_id] = { purchase: 0, sale: 0, adjustment: 0 };
      }
      txMap[tx.inventory_item_id][tx.transaction_type] = Number(tx.total_qty || 0);
    }

    const enhanced = items.map(item => {
      const stock = Number(item.current_stock || 0);
      const minStock = Number(item.minimum_stock || 0);
      const cost = Number(item.cost_price || 0);
      const totalPurchased = txMap[item.id]?.purchase || 0;
      const totalUsed = txMap[item.id]?.sale || 0;

      let stockStatus = "in_stock";
      if (stock <= 0) stockStatus = "out_of_stock";
      else if (stock <= minStock) stockStatus = "low_stock";

      return {
        ...item,
        current_stock: stock,
        minimum_stock: minStock,
        cost_price: cost,
        total_purchased: totalPurchased,
        total_used: totalUsed,
        stock_value: Math.round(stock * cost * 100) / 100,
        stock_status: stockStatus,
      };
    });

    return res.json({ raw_materials: enhanced });
  } catch (err) {
    console.error("Raw materials get error:", err);
    return res.status(500).json({ error: err.message || "Failed to load raw materials" });
  }
});

router.post("/raw-materials", optionalAuth, requireAuth, async (req, res) => {
  const {
    id,
    restaurant_id,
    name,
    sku,
    category_id,
    unit = "kg",
    cost_price = 0,
    current_stock = 0,
    minimum_stock = 0,
    supplier_id,
    status = "active",
    notes,
  } = req.body;

  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Item name is required" });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    let resultItem = null;

    if (id && isValidUUID(id)) {
      // Update existing
      const [updated] = await trx("inventory_items")
        .where({ id, restaurant_id })
        .update({
          name: String(name).trim(),
          sku: sku ? String(sku).trim() : null,
          category_id: category_id && isValidUUID(category_id) ? category_id : null,
          unit: String(unit).trim(),
          cost_price: Number(cost_price) || 0,
          current_stock: Number(current_stock) || 0,
          minimum_stock: Number(minimum_stock) || 0,
          supplier_id: supplier_id && isValidUUID(supplier_id) ? supplier_id : null,
          status: status || "active",
          notes: notes ? String(notes).trim() : null,
          updated_at: new Date(),
        })
        .returning("*");
      resultItem = updated;
    } else {
      // Create new
      const [created] = await trx("inventory_items")
        .insert({
          restaurant_id,
          name: String(name).trim(),
          sku: sku ? String(sku).trim() : `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
          category_id: category_id && isValidUUID(category_id) ? category_id : null,
          unit: String(unit).trim(),
          cost_price: Number(cost_price) || 0,
          current_stock: Number(current_stock) || 0,
          minimum_stock: Number(minimum_stock) || 0,
          supplier_id: supplier_id && isValidUUID(supplier_id) ? supplier_id : null,
          status: status || "active",
          notes: notes ? String(notes).trim() : null,
        })
        .returning("*");
      resultItem = created;

      // If initial current stock > 0, record initial transaction
      if (Number(current_stock) > 0) {
        await trx("inventory_transactions").insert({
          inventory_item_id: created.id,
          transaction_type: "purchase",
          quantity: Number(current_stock),
          unit: created.unit,
          notes: "Initial inventory setup",
        });
      }
    }

    await trx.commit();
    return res.json({ item: resultItem });
  } catch (err) {
    await trx.rollback();
    console.error("Raw materials save error:", err);
    return res.status(500).json({ error: err.message || "Failed to save raw material" });
  }
});

router.delete("/raw-materials/:id", optionalAuth, requireAuth, async (req, res) => {
  const { id } = req.params;
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const recipeCount = await knex("recipe_ingredients").where({ inventory_item_id: id }).count().first();
    if (Number(recipeCount?.count || 0) > 0) {
      await knex("inventory_items").where({ id, restaurant_id: restaurantId }).update({ status: "inactive" });
      return res.json({ success: true, message: "Item deactivated because it is linked to recipes" });
    }

    await knex("inventory_items").where({ id, restaurant_id: restaurantId }).del();
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete raw material error:", err);
    return res.status(500).json({ error: err.message || "Failed to delete raw material" });
  }
});

router.post("/raw-materials/:id/adjust", optionalAuth, requireAuth, async (req, res) => {
  const { id } = req.params;
  const { restaurant_id, adjustment_type, quantity, reason } = req.body;

  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  const qtyNum = Math.abs(Number(quantity) || 0);
  if (qtyNum <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero" });
  }
  if (!["increase", "decrease"].includes(adjustment_type)) {
    return res.status(400).json({ error: "Adjustment type must be increase or decrease" });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const item = await trx("inventory_items").where({ id, restaurant_id }).first();
    if (!item) {
      await trx.rollback();
      return res.status(404).json({ error: "Raw material not found" });
    }

    const current = Number(item.current_stock || 0);
    const newStock = adjustment_type === "increase" ? current + qtyNum : Math.max(0, current - qtyNum);

    await trx("inventory_items").where({ id }).update({
      current_stock: newStock,
      updated_at: new Date(),
    });

    await trx("stock_adjustments").insert({
      restaurant_id,
      inventory_item_id: id,
      adjustment_type,
      quantity: qtyNum,
      reason: reason ? String(reason).trim() : "Manual stock adjustment",
      performed_by: req.user?.id || null,
    });

    await trx("inventory_transactions").insert({
      inventory_item_id: id,
      transaction_type: "adjustment",
      quantity: adjustment_type === "increase" ? qtyNum : -qtyNum,
      unit: item.unit,
      notes: reason || `Stock ${adjustment_type}: ${qtyNum} ${item.unit}`,
    });

    await trx.commit();
    return res.json({ success: true, new_stock: newStock });
  } catch (err) {
    await trx.rollback();
    console.error("Stock adjust error:", err);
    return res.status(500).json({ error: err.message || "Failed to adjust stock" });
  }
});

// -------------------------------------------------------------------------
// 3. SUPPLIERS MANAGEMENT
// -------------------------------------------------------------------------
router.get("/suppliers", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const suppliers = await knex("suppliers")
      .where({ restaurant_id: restaurantId })
      .select("suppliers.*")
      .orderBy("name", "asc");

    const stats = await knex("purchases")
      .where({ restaurant_id: restaurantId })
      .groupBy("supplier_id")
      .select(
        "supplier_id",
        knex.raw("COUNT(id) as total_purchases"),
        knex.raw("COALESCE(SUM(total_amount), 0) as total_spent")
      );

    const statsMap = {};
    for (const s of stats) {
      statsMap[s.supplier_id] = {
        total_purchases: Number(s.total_purchases || 0),
        total_spent: Number(s.total_spent || 0),
      };
    }

    const enhanced = suppliers.map(s => ({
      ...s,
      total_purchases: statsMap[s.id]?.total_purchases || 0,
      total_spent: statsMap[s.id]?.total_spent || 0,
    }));

    return res.json({ suppliers: enhanced });
  } catch (err) {
    console.error("Suppliers get error:", err);
    return res.status(500).json({ error: err.message || "Failed to load suppliers" });
  }
});

router.post("/suppliers", optionalAuth, requireAuth, async (req, res) => {
  const { id, restaurant_id, name, company_name, phone, email, address, notes } = req.body;
  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Supplier name is required" });
  }

  const knex = getKnex();
  try {
    if (id && isValidUUID(id)) {
      const [updated] = await knex("suppliers")
        .where({ id, restaurant_id })
        .update({
          name: String(name).trim(),
          company_name: company_name ? String(company_name).trim() : null,
          phone: phone ? String(phone).trim() : null,
          email: email ? String(email).trim() : null,
          address: address ? String(address).trim() : null,
          notes: notes ? String(notes).trim() : null,
          updated_at: new Date(),
        })
        .returning("*");
      return res.json({ supplier: updated });
    } else {
      const [created] = await knex("suppliers")
        .insert({
          restaurant_id,
          name: String(name).trim(),
          company_name: company_name ? String(company_name).trim() : null,
          phone: phone ? String(phone).trim() : null,
          email: email ? String(email).trim() : null,
          address: address ? String(address).trim() : null,
          notes: notes ? String(notes).trim() : null,
        })
        .returning("*");
      return res.json({ supplier: created });
    }
  } catch (err) {
    console.error("Supplier save error:", err);
    return res.status(500).json({ error: err.message || "Failed to save supplier" });
  }
});

router.delete("/suppliers/:id", optionalAuth, requireAuth, async (req, res) => {
  const { id } = req.params;
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const purchaseCount = await knex("purchases").where({ supplier_id: id }).count().first();
    if (Number(purchaseCount?.count || 0) > 0) {
      return res.status(400).json({ error: "Cannot delete supplier with existing purchase records" });
    }
    await knex("suppliers").where({ id, restaurant_id: restaurantId }).del();
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete supplier error:", err);
    return res.status(500).json({ error: err.message || "Failed to delete supplier" });
  }
});

// -------------------------------------------------------------------------
// 4. PURCHASES MANAGEMENT: Record Invoices & Replenish Raw Materials
// -------------------------------------------------------------------------
router.get("/purchases", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const purchases = await knex("purchases")
      .leftJoin("suppliers", "purchases.supplier_id", "suppliers.id")
      .where({ "purchases.restaurant_id": restaurantId })
      .select(
        "purchases.*",
        "suppliers.name as supplier_name",
        "suppliers.company_name as supplier_company",
        "suppliers.phone as supplier_phone"
      )
      .orderBy("purchases.purchase_date", "desc");

    const purchaseIds = purchases.map(p => p.id);
    let items = [];
    if (purchaseIds.length > 0) {
      items = await knex("purchase_items")
        .join("inventory_items", "purchase_items.inventory_item_id", "inventory_items.id")
        .whereIn("purchase_items.purchase_id", purchaseIds)
        .select(
          "purchase_items.*",
          "inventory_items.name as item_name",
          "inventory_items.unit as item_unit"
        );
    }

    const itemsMap = {};
    for (const item of items) {
      if (!itemsMap[item.purchase_id]) itemsMap[item.purchase_id] = [];
      itemsMap[item.purchase_id].push({
        ...item,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price),
      });
    }

    const result = purchases.map(p => ({
      ...p,
      total_amount: Number(p.total_amount),
      items: itemsMap[p.id] || [],
    }));

    return res.json({ purchases: result });
  } catch (err) {
    console.error("Purchases get error:", err);
    return res.status(500).json({ error: err.message || "Failed to load purchases" });
  }
});

router.post("/purchases", optionalAuth, requireAuth, async (req, res) => {
  const {
    restaurant_id,
    supplier_id,
    purchase_date = new Date().toISOString().split("T")[0],
    status = "received",
    notes,
    items = [],
  } = req.body;

  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  if (!supplier_id || !isValidUUID(supplier_id)) {
    return res.status(400).json({ error: "Supplier is required" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Add at least one raw material item to purchase" });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const totalAmount = items.reduce((sum, item) => {
      const q = Number(item.quantity) || 0;
      const p = Number(item.unit_price) || 0;
      return sum + q * p;
    }, 0);

    const [purchase] = await trx("purchases")
      .insert({
        restaurant_id,
        supplier_id,
        purchase_date,
        total_amount: totalAmount,
        status,
        notes: notes ? String(notes).trim() : null,
      })
      .returning("*");

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      if (qty <= 0) continue;

      await trx("purchase_items").insert({
        purchase_id: purchase.id,
        inventory_item_id: item.inventory_item_id,
        quantity: qty,
        unit_price: price,
      });

      if (status === "received") {
        const invItem = await trx("inventory_items").where({ id: item.inventory_item_id }).first();
        if (invItem) {
          const updatedStock = Number(invItem.current_stock || 0) + qty;
          await trx("inventory_items")
            .where({ id: item.inventory_item_id })
            .update({
              current_stock: updatedStock,
              cost_price: price > 0 ? price : invItem.cost_price,
              updated_at: new Date(),
            });

          await trx("inventory_transactions").insert({
            inventory_item_id: item.inventory_item_id,
            transaction_type: "purchase",
            quantity: qty,
            unit: invItem.unit || "unit",
            related_purchase_id: purchase.id,
            notes: `Purchased ${qty} ${invItem.unit} (PO #${purchase.id.slice(0, 8)})`,
          });
        }
      }
    }

    await trx.commit();
    return res.status(201).json({ purchase, success: true });
  } catch (err) {
    await trx.rollback();
    console.error("Create purchase error:", err);
    return res.status(500).json({ error: err.message || "Failed to create purchase" });
  }
});

// -------------------------------------------------------------------------
// 5. RECIPES MANAGEMENT: Link Selling Items (Dishes) to Raw Materials
// -------------------------------------------------------------------------
router.get("/recipes", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    const menuItems = await knex("menu_items")
      .where({ restaurant_id: restaurantId, is_available: true })
      .select("id", "name", "price", "image_url")
      .orderBy("name", "asc");

    const recipes = await knex("recipes")
      .where({ restaurant_id: restaurantId })
      .select("id", "selling_item_id", "name", "description");

    const recipeIds = recipes.map(r => r.id);
    let recipeIngredients = [];
    if (recipeIds.length > 0) {
      recipeIngredients = await knex("recipe_ingredients")
        .join("inventory_items", "recipe_ingredients.inventory_item_id", "inventory_items.id")
        .whereIn("recipe_ingredients.recipe_id", recipeIds)
        .select(
          "recipe_ingredients.*",
          "inventory_items.name as raw_material_name",
          "inventory_items.cost_price",
          "inventory_items.current_stock"
        );
    }

    const ingMap = {};
    for (const ing of recipeIngredients) {
      if (!ingMap[ing.recipe_id]) ingMap[ing.recipe_id] = [];
      const qty = Number(ing.quantity || 0);
      const cost = Number(ing.cost_price || 0);
      ingMap[ing.recipe_id].push({
        ...ing,
        quantity: qty,
        unit_cost: cost,
        total_cost: Math.round(qty * cost * 100) / 100,
        current_stock: Number(ing.current_stock || 0),
      });
    }

    const recipeMap = {};
    for (const r of recipes) {
      recipeMap[r.selling_item_id] = {
        ...r,
        ingredients: ingMap[r.id] || [],
      };
    }

    const result = menuItems.map(item => {
      const rec = recipeMap[item.id] || null;
      const ingredients = rec?.ingredients || [];
      const totalFoodCost = ingredients.reduce((sum, ing) => sum + ing.total_cost, 0);
      const sellingPrice = Number(item.price || 0);
      const profitMargin = sellingPrice > 0 ? Math.round(((sellingPrice - totalFoodCost) / sellingPrice) * 100) : 0;

      return {
        menu_item_id: item.id,
        menu_item_name: item.name,
        selling_price: sellingPrice,
        image_url: item.image_url,
        has_recipe: Boolean(rec && ingredients.length > 0),
        recipe_id: rec?.id || null,
        recipe_name: rec?.name || null,
        recipe_description: rec?.description || null,
        ingredients,
        total_food_cost: Math.round(totalFoodCost * 100) / 100,
        profit_margin: profitMargin,
      };
    });

    return res.json({ recipes: result });
  } catch (err) {
    console.error("Recipes get error:", err);
    return res.status(500).json({ error: err.message || "Failed to load recipes" });
  }
});

router.post("/recipes", optionalAuth, requireAuth, async (req, res) => {
  const { restaurant_id, menu_item_id, name, description, ingredients = [] } = req.body;
  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  if (!menu_item_id || !isValidUUID(menu_item_id)) {
    return res.status(400).json({ error: "Menu item is required" });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    let recipe = await trx("recipes").where({ selling_item_id: menu_item_id, restaurant_id }).first();

    if (recipe) {
      await trx("recipes")
        .where({ id: recipe.id })
        .update({
          name: name ? String(name).trim() : null,
          description: description ? String(description).trim() : null,
          updated_at: new Date(),
        });
      await trx("recipe_ingredients").where({ recipe_id: recipe.id }).del();
    } else {
      const [created] = await trx("recipes")
        .insert({
          restaurant_id,
          selling_item_id: menu_item_id,
          name: name ? String(name).trim() : null,
          description: description ? String(description).trim() : null,
        })
        .returning("*");
      recipe = created;
    }

    for (const ing of ingredients) {
      const q = Number(ing.quantity) || 0;
      if (q <= 0 || !ing.inventory_item_id || !isValidUUID(ing.inventory_item_id)) continue;
      await trx("recipe_ingredients").insert({
        recipe_id: recipe.id,
        inventory_item_id: ing.inventory_item_id,
        quantity: q,
        unit: ing.unit || "unit",
      });
    }

    await trx.commit();
    return res.json({ success: true, recipe_id: recipe.id });
  } catch (err) {
    await trx.rollback();
    console.error("Recipe save error:", err);
    return res.status(500).json({ error: err.message || "Failed to save recipe" });
  }
});

// -------------------------------------------------------------------------
// 6. USAGE & TRACEABILITY: "Wo Kaha Use Hua"
// -------------------------------------------------------------------------
router.get("/usage", optionalAuth, requireAuth, async (req, res) => {
  const restaurantId = req.query.restaurant_id;
  const rawMaterialId = req.query.inventory_item_id;

  if (!checkRestaurantAccess(req, restaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  try {
    let query = knex("inventory_transactions")
      .join("inventory_items", "inventory_transactions.inventory_item_id", "inventory_items.id")
      .leftJoin("orders", "inventory_transactions.related_order_id", "orders.id")
      .leftJoin("purchases", "inventory_transactions.related_purchase_id", "purchases.id")
      .leftJoin("suppliers", "purchases.supplier_id", "suppliers.id")
      .where({ "inventory_items.restaurant_id": restaurantId })
      .select(
        "inventory_transactions.id",
        "inventory_transactions.transaction_type",
        "inventory_transactions.quantity",
        "inventory_transactions.unit",
        "inventory_transactions.notes",
        "inventory_transactions.created_at",
        "inventory_items.id as inventory_item_id",
        "inventory_items.name as item_name",
        "inventory_items.cost_price",
        "inventory_items.current_stock",
        "orders.id as order_id",
        "orders.order_number",
        "orders.customer_name",
        "orders.fulfillment_type",
        "suppliers.name as supplier_name"
      )
      .orderBy("inventory_transactions.created_at", "desc")
      .limit(200);

    if (rawMaterialId && isValidUUID(rawMaterialId)) {
      query = query.where({ "inventory_items.id": rawMaterialId });
    }

    const rows = await query;

    let summaryQuery = knex("inventory_transactions")
      .join("inventory_items", "inventory_transactions.inventory_item_id", "inventory_items.id")
      .where({ "inventory_items.restaurant_id": restaurantId });

    if (rawMaterialId && isValidUUID(rawMaterialId)) {
      summaryQuery = summaryQuery.where({ "inventory_items.id": rawMaterialId });
    }

    const [agg] = await summaryQuery.select(
      knex.raw("COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN quantity ELSE 0 END), 0) as total_purchased_qty"),
      knex.raw("COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN quantity ELSE 0 END), 0) as total_used_qty"),
      knex.raw("COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN quantity ELSE 0 END), 0) as total_adjusted_qty")
    );

    const history = rows.map(r => {
      const qty = Number(r.quantity || 0);
      const cost = Number(r.cost_price || 0);
      return {
        id: r.id,
        transaction_type: r.transaction_type,
        quantity: qty,
        unit: r.unit,
        approx_cost: Math.round(qty * cost * 100) / 100,
        notes: r.notes,
        created_at: r.created_at,
        item_id: r.inventory_item_id,
        item_name: r.item_name,
        current_stock: Number(r.current_stock || 0),
        order_id: r.order_id,
        order_number: r.order_number,
        customer_name: r.customer_name,
        fulfillment_type: r.fulfillment_type,
        supplier_name: r.supplier_name,
      };
    });

    return res.json({
      summary: {
        total_purchased_qty: Number(agg?.total_purchased_qty || 0),
        total_used_qty: Number(agg?.total_used_qty || 0),
        total_adjusted_qty: Number(agg?.total_adjusted_qty || 0),
      },
      history,
    });
  } catch (err) {
    console.error("Usage report error:", err);
    return res.status(500).json({ error: err.message || "Failed to load usage history" });
  }
});

// -------------------------------------------------------------------------
// 7. POS CHECKOUT & REAL-TIME SALE INVOICING + AUTOMATIC RECIPE DEDUCTION
// -------------------------------------------------------------------------
router.post("/checkout", optionalAuth, requireAuth, async (req, res) => {
  const {
    restaurant_id,
    customer_name = "Walk-in Customer",
    customer_phone = "",
    fulfillment_type = "dine_in",
    table_id,
    table_number,
    payment_method = "cash",
    payment_status = "paid",
    payments = [],
    cash_tendered = 0,
    change_due = 0,
    notes,
    discount_amount = 0,
    tax_amount = 0,
    lines = [],
    order_status = "delivered",
  } = req.body;

  // Derive target restaurant from explicit param or auth user
  const targetRestaurantId = restaurant_id || req.user?.restaurantIds?.[0];
  if (!checkRestaurantAccess(req, targetRestaurantId)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "Cart is empty. Please add items to checkout." });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    // 1. Fetch official item details & prices from DB (never trust client prices)
    const menuItemIds = lines
      .map(l => l.menu_item_id)
      .filter(id => id && isValidUUID(id));

    const dbMenuItems = menuItemIds.length > 0
      ? await trx("menu_items")
          .where({ restaurant_id: targetRestaurantId })
          .whereIn("id", menuItemIds)
          .select("id", "name", "price", "is_available")
      : [];

    const dbMenuMap = new Map(dbMenuItems.map(m => [m.id, m]));

    // Build verified line items with authoritative prices
    const verifiedLines = [];
    let calculatedSubtotal = 0;

    for (const line of lines) {
      const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
      let unitPrice = 0;
      let itemName = "Item";

      if (line.menu_item_id && dbMenuMap.has(line.menu_item_id)) {
        const dbItem = dbMenuMap.get(line.menu_item_id);
        unitPrice = Number(dbItem.price || 0);
        itemName = dbItem.name;
      } else {
        // Fallback for custom items without catalog menu_item_id
        unitPrice = Math.max(0, Number(line.unit_price || line.custom_price || 0));
        itemName = line.item_name ? String(line.item_name).trim() : "Custom Item";
      }

      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      calculatedSubtotal += lineTotal;

      verifiedLines.push({
        menu_item_id: line.menu_item_id && isValidUUID(line.menu_item_id) ? line.menu_item_id : null,
        item_name: itemName,
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
        notes: line.notes ? String(line.notes).trim() : null,
      });
    }

    calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
    const discount = Math.min(calculatedSubtotal, Math.max(0, Number(discount_amount) || 0));
    const tax = Math.max(0, Number(tax_amount) || 0);
    const totalAmount = Math.max(0, Math.round((calculatedSubtotal - discount + tax) * 100) / 100);

    // 2. Generate per-restaurant race-safe order number
    const orderNumber = await nextOrderNumber(trx, targetRestaurantId);
    const trackingCode = "POS-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // 3. Determine Payment Status & Split Payments
    let effectivePaymentMethod = payment_method || "cash";
    let validPayments = [];

    if (Array.isArray(payments) && payments.length > 0) {
      validPayments = payments
        .map(p => ({
          method: ["cash", "card", "online", "other"].includes(p.method) ? p.method : "cash",
          amount: Math.max(0, Number(p.amount) || 0),
        }))
        .filter(p => p.amount > 0);

      if (validPayments.length > 1) {
        effectivePaymentMethod = "split";
      } else if (validPayments.length === 1) {
        effectivePaymentMethod = validPayments[0].method;
      }
    } else if (payment_status !== "unpaid" && totalAmount > 0) {
      // Single payment default
      validPayments = [{
        method: ["cash", "card", "online", "other"].includes(payment_method) ? payment_method : "cash",
        amount: totalAmount,
      }];
    }

    const totalPaid = Math.round(validPayments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    let computedPaymentStatus = "unpaid";
    if (totalPaid >= totalAmount && totalAmount > 0) {
      computedPaymentStatus = "paid";
    } else if (totalPaid > 0 && totalPaid < totalAmount) {
      computedPaymentStatus = "partial";
    } else if (totalAmount === 0) {
      computedPaymentStatus = "paid";
    }

    // 4. Insert into orders table
    const [order] = await trx("orders")
      .insert({
        restaurant_id: targetRestaurantId,
        order_number: orderNumber,
        bill_no: orderNumber,
        tracking_code: trackingCode,
        customer_name: customer_name ? String(customer_name).trim() : "Walk-in Guest",
        customer_phone: customer_phone ? String(customer_phone).trim() : (table_number ? `Table ${table_number}` : "Walk-in"),
        fulfillment_type: fulfillment_type || "dine_in",
        delivery_address: fulfillment_type === "dine_in"
          ? `Table ${table_number || "Counter"}`
          : (fulfillment_type === "pickup" ? "Counter Pickup" : "Delivery"),
        table_id: table_id && isValidUUID(table_id) ? table_id : null,
        taken_by: req.user?.id || null,
        notes: notes ? String(notes).trim() : null,
        source: "pos",
        status: order_status || "delivered",
        payment_method: effectivePaymentMethod,
        payment_status: computedPaymentStatus,
        subtotal: calculatedSubtotal,
        discount_amount: discount,
        tax_amount: tax,
        delivery_fee: 0,
        total_amount: totalAmount,
        auto_assigned: true,
        assignment_status: "assigned",
      })
      .returning("*");

    // 5. Insert order items
    await trx("order_items").insert(
      verifiedLines.map(l => ({
        order_id: order.id,
        menu_item_id: l.menu_item_id,
        item_name: l.item_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        line_total: l.line_total,
        notes: l.notes,
      }))
    );

    // 6. Insert order payments (split payment support & cash overpayment net amount fix)
    const insertedPayments = [];
    let remainingBillToCover = totalAmount;

    for (const p of validPayments) {
      // Net amount actually applied to the bill (change due excluded)
      const netAppliedAmount = Math.min(p.amount, remainingBillToCover);
      if (netAppliedAmount <= 0 && totalAmount > 0) continue;

      const [pmt] = await trx("order_payments")
        .insert({
          restaurant_id: targetRestaurantId,
          order_id: order.id,
          method: p.method,
          amount: totalAmount === 0 ? 0 : netAppliedAmount,
          received_by: req.user?.id || null,
        })
        .returning("*");

      insertedPayments.push(pmt);
      remainingBillToCover = Math.max(0, remainingBillToCover - netAppliedAmount);
    }

    // 7. Deduct stock for order via shared stockDeduction module
    const stockResult = await deductStockForOrder(trx, order.id);
    const consumedMaterials = stockResult.consumed || [];

    await trx.commit();

    return res.status(201).json({
      success: true,
      order,
      payments: insertedPayments,
      consumed_materials: consumedMaterials,
      receipt: {
        order_number: order.order_number,
        bill_no: order.bill_no || order.order_number,
        date: order.created_at,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        fulfillment_type: order.fulfillment_type,
        table_number: table_number || null,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        subtotal: calculatedSubtotal,
        discount,
        tax,
        total_amount: totalAmount,
        total_paid: totalPaid,
        cash_tendered: Number(cash_tendered) || totalPaid,
        change_due: Number(change_due) || 0,
        payments: insertedPayments,
        items: verifiedLines,
      },
    });
  } catch (err) {
    await trx.rollback();
    console.error("POS Checkout error:", err);
    return res.status(500).json({ error: err.message || "Failed to process POS checkout" });
  }
});

// -------------------------------------------------------------------------
// 7B. GET POS ORDER DETAILS BY ID (FOR RECEIPT REPRINT & AUDIT)
// -------------------------------------------------------------------------
router.get("/orders/:id", optionalAuth, requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id || !isValidUUID(id)) {
    return res.status(400).json({ error: "Valid order ID required" });
  }

  const knex = getKnex();
  try {
    const order = await knex("orders").where({ id }).first();
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!checkRestaurantAccess(req, order.restaurant_id)) {
      return res.status(403).json({ error: "Access denied for this restaurant" });
    }

    const items = await knex("order_items")
      .where({ order_id: id })
      .select("id", "menu_item_id", "item_name", "quantity", "unit_price", "line_total", "notes");

    const payments = await knex("order_payments")
      .where({ order_id: id })
      .orderBy("created_at", "asc");

    return res.json({
      order,
      items,
      payments,
      receipt: {
        order_number: order.order_number,
        bill_no: order.bill_no || order.order_number,
        date: order.created_at,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        fulfillment_type: order.fulfillment_type,
        delivery_address: order.delivery_address,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        subtotal: Number(order.subtotal || 0),
        discount: Number(order.discount_amount || 0),
        tax: Number(order.tax_amount || 0),
        total_amount: Number(order.total_amount || 0),
        payments,
        items: items.map(i => ({
          ...i,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          line_total: Number(i.line_total),
        })),
      },
    });
  } catch (err) {
    console.error("Get POS order error:", err);
    return res.status(500).json({ error: err.message || "Failed to load order" });
  }
});

// -------------------------------------------------------------------------
// 8. ONE-CLICK SEED DEMO DATA FOR TESTING POS & RAW MATERIALS
// -------------------------------------------------------------------------
router.post("/seed-sample-data", optionalAuth, requireAuth, async (req, res) => {
  const { restaurant_id } = req.body;
  if (!checkRestaurantAccess(req, restaurant_id)) {
    return res.status(403).json({ error: "Access denied for this restaurant" });
  }

  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const sampleCats = ["Meat & Poultry", "Bakery & Buns", "Dairy & Cheese", "Vegetables & Produce", "Oils & Sauces", "Packaging"];
    const catMap = {};
    for (const cName of sampleCats) {
      let cat = await trx("inventory_categories").where({ restaurant_id, name: cName }).first();
      if (!cat) {
        const [newCat] = await trx("inventory_categories").insert({ restaurant_id, name: cName }).returning("*");
        cat = newCat;
      }
      catMap[cName] = cat.id;
    }

    const sampleSuppliers = [
      { name: "Al-Madina Meat Supply", company_name: "Al-Madina Foods Ltd", phone: "+92 300 1234567", email: "meat@almadina.com" },
      { name: "Golden Crust Bakery", company_name: "Golden Crust Wholesalers", phone: "+92 321 9876543", email: "orders@goldencrust.com" },
      { name: "Prime Dairy & Cold Storage", company_name: "Prime Agro", phone: "+92 333 4567890", email: "sales@primedairy.com" },
      { name: "EcoPack Containers", company_name: "EcoPack Packaging", phone: "+92 312 5556677", email: "info@ecopack.com" },
    ];

    const supplierMap = {};
    for (const s of sampleSuppliers) {
      let supp = await trx("suppliers").where({ restaurant_id, name: s.name }).first();
      if (!supp) {
        const [newSupp] = await trx("suppliers").insert({ restaurant_id, ...s }).returning("*");
        supp = newSupp;
      }
      supplierMap[s.name] = supp.id;
    }

    const rawMaterialsList = [
      { name: "Chicken Patty / Mince", unit: "kg", cost_price: 3.50, current_stock: 45.0, minimum_stock: 10.0, cat: "Meat & Poultry", supp: "Al-Madina Meat Supply" },
      { name: "Beef Steak / Mince", unit: "kg", cost_price: 4.80, current_stock: 30.0, minimum_stock: 8.0, cat: "Meat & Poultry", supp: "Al-Madina Meat Supply" },
      { name: "Brioche Burger Buns", unit: "pcs", cost_price: 0.35, current_stock: 180, minimum_stock: 30, cat: "Bakery & Buns", supp: "Golden Crust Bakery" },
      { name: "Pizza Dough Balls", unit: "pcs", cost_price: 0.50, current_stock: 90, minimum_stock: 20, cat: "Bakery & Buns", supp: "Golden Crust Bakery" },
      { name: "Cheddar Cheese Slices", unit: "pcs", cost_price: 0.20, current_stock: 250, minimum_stock: 50, cat: "Dairy & Cheese", supp: "Prime Dairy & Cold Storage" },
      { name: "Mozzarella Cheese Block", unit: "kg", cost_price: 5.20, current_stock: 25.0, minimum_stock: 5.0, cat: "Dairy & Cheese", supp: "Prime Dairy & Cold Storage" },
      { name: "Cooking Canola Oil", unit: "liters", cost_price: 2.10, current_stock: 60.0, minimum_stock: 15.0, cat: "Oils & Sauces", supp: "Prime Dairy & Cold Storage" },
      { name: "Signature Burger Sauce", unit: "liters", cost_price: 3.00, current_stock: 18.0, minimum_stock: 5.0, cat: "Oils & Sauces", supp: "Prime Dairy & Cold Storage" },
      { name: "French Fries Strips", unit: "kg", cost_price: 1.40, current_stock: 75.0, minimum_stock: 20.0, cat: "Vegetables & Produce", supp: "Prime Dairy & Cold Storage" },
      { name: "Fresh Iceberg Lettuce", unit: "kg", cost_price: 0.90, current_stock: 12.0, minimum_stock: 4.0, cat: "Vegetables & Produce", supp: "Prime Dairy & Cold Storage" },
      { name: "Takeaway Burger Box", unit: "pcs", cost_price: 0.15, current_stock: 350, minimum_stock: 50, cat: "Packaging", supp: "EcoPack Containers" },
    ];

    const rawMaterialMap = {};
    for (const rm of rawMaterialsList) {
      let item = await trx("inventory_items").where({ restaurant_id, name: rm.name }).first();
      if (!item) {
        const [newItem] = await trx("inventory_items")
          .insert({
            restaurant_id,
            name: rm.name,
            sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
            category_id: catMap[rm.cat] || null,
            unit: rm.unit,
            cost_price: rm.cost_price,
            current_stock: rm.current_stock,
            minimum_stock: rm.minimum_stock,
            supplier_id: supplierMap[rm.supp] || null,
            status: "active",
          })
          .returning("*");
        item = newItem;

        await trx("inventory_transactions").insert({
          inventory_item_id: item.id,
          transaction_type: "purchase",
          quantity: rm.current_stock,
          unit: rm.unit,
          notes: "Initial inventory setup",
        });
      }
      rawMaterialMap[rm.name] = item;
    }

    const existingPurchases = await trx("purchases").where({ restaurant_id }).count().first();
    if (Number(existingPurchases?.count || 0) === 0) {
      const p1Supplier = supplierMap["Al-Madina Meat Supply"];
      if (p1Supplier) {
        const [p1] = await trx("purchases")
          .insert({
            restaurant_id,
            supplier_id: p1Supplier,
            purchase_date: new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0],
            total_amount: 301.0,
            status: "received",
            notes: "Weekly fresh poultry & meat batch",
          })
          .returning("*");

        const chickItem = rawMaterialMap["Chicken Patty / Mince"];
        const beefItem = rawMaterialMap["Beef Steak / Mince"];
        if (chickItem) {
          await trx("purchase_items").insert({
            purchase_id: p1.id,
            inventory_item_id: chickItem.id,
            quantity: 45,
            unit_price: 3.50,
          });
        }
        if (beefItem) {
          await trx("purchase_items").insert({
            purchase_id: p1.id,
            inventory_item_id: beefItem.id,
            quantity: 30,
            unit_price: 4.80,
          });
        }
      }

      const p2Supplier = supplierMap["Golden Crust Bakery"];
      if (p2Supplier) {
        const [p2] = await trx("purchases")
          .insert({
            restaurant_id,
            supplier_id: p2Supplier,
            purchase_date: new Date(Date.now() - 1 * 86400000).toISOString().split("T")[0],
            total_amount: 108.0,
            status: "received",
            notes: "Fresh bakery buns & pizza dough delivery",
          })
          .returning("*");

        const bunItem = rawMaterialMap["Brioche Burger Buns"];
        const doughItem = rawMaterialMap["Pizza Dough Balls"];
        if (bunItem) {
          await trx("purchase_items").insert({
            purchase_id: p2.id,
            inventory_item_id: bunItem.id,
            quantity: 180,
            unit_price: 0.35,
          });
        }
        if (doughItem) {
          await trx("purchase_items").insert({
            purchase_id: p2.id,
            inventory_item_id: doughItem.id,
            quantity: 90,
            unit_price: 0.50,
          });
        }
      }
    }

    const menuItems = await trx("menu_items").where({ restaurant_id }).select("id", "name");
    for (const mi of menuItems) {
      const lower = mi.name.toLowerCase();
      const existingRecipe = await trx("recipes").where({ restaurant_id, selling_item_id: mi.id }).first();
      if (!existingRecipe) {
        if (lower.includes("burger") || lower.includes("beef") || lower.includes("chicken")) {
          const [rec] = await trx("recipes")
            .insert({
              restaurant_id,
              selling_item_id: mi.id,
              name: `${mi.name} Recipe`,
              description: "Standard chef recipe",
            })
            .returning("*");

          const isChicken = lower.includes("chicken");
          const meatItem = isChicken ? rawMaterialMap["Chicken Patty / Mince"] : rawMaterialMap["Beef Steak / Mince"];
          const bunItem = rawMaterialMap["Brioche Burger Buns"];
          const cheeseItem = rawMaterialMap["Cheddar Cheese Slices"];
          const sauceItem = rawMaterialMap["Signature Burger Sauce"];
          const boxItem = rawMaterialMap["Takeaway Burger Box"];

          if (meatItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: meatItem.id, quantity: 0.15, unit: "kg" });
          if (bunItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: bunItem.id, quantity: 1, unit: "pcs" });
          if (cheeseItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: cheeseItem.id, quantity: 1, unit: "pcs" });
          if (sauceItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: sauceItem.id, quantity: 0.02, unit: "liters" });
          if (boxItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: boxItem.id, quantity: 1, unit: "pcs" });
        } else if (lower.includes("pizza")) {
          const [rec] = await trx("recipes")
            .insert({
              restaurant_id,
              selling_item_id: mi.id,
              name: `${mi.name} Recipe`,
              description: "Pizza crust and toppings",
            })
            .returning("*");

          const doughItem = rawMaterialMap["Pizza Dough Balls"];
          const cheeseItem = rawMaterialMap["Mozzarella Cheese Block"];
          const chickenItem = rawMaterialMap["Chicken Patty / Mince"];

          if (doughItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: doughItem.id, quantity: 1, unit: "pcs" });
          if (cheeseItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: cheeseItem.id, quantity: 0.15, unit: "kg" });
          if (chickenItem) await trx("recipe_ingredients").insert({ recipe_id: rec.id, inventory_item_id: chickenItem.id, quantity: 0.10, unit: "kg" });
        }
      }
    }

    await trx.commit();
    return res.json({ success: true, message: "Demo POS & Inventory data generated successfully!" });
  } catch (err) {
    await trx.rollback();
    console.error("Seed sample data error:", err);
    return res.status(500).json({ error: err.message || "Failed to seed demo data" });
  }
});

export default router;
