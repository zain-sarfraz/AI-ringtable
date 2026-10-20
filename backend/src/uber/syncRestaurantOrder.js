/**
 * Map a real Uber Eats order payload into restaurant `orders` + `order_items`.
 * Idempotent on tracking_code = UBER-{uber_order_id}. Does not invent orders.
 */
import { getKnex } from "../db.js";
import { getUberConfig } from "./config.js";
import { uberLog } from "./logger.js";
import { notifyNewOrderLater } from "../lib/orderAlerts.js";
import { kitchenToMarketplaceStatus, wouldDowngrade } from "../integrations/status.js";
import { deductStockForOrder, restoreStockForOrder } from "../lib/stockDeduction.js";

const UBER_STATE_TO_STATUS = {
  CREATED: "pending",
  OFFERED: "pending",
  ACCEPTED: "confirmed",
  DENIED: "cancelled",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  FAILED: "cancelled",
  READY: "ready",
  HANDED_OFF: "out_for_delivery",
  FULFILLED: "delivered",
  SUCCEEDED: "delivered",
};

export function unwrapUberOrder(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.order && typeof payload.order === "object" && (payload.order.id || payload.order.order_id)) {
    return payload.order;
  }
  return payload;
}

/** Uber Money: cents (`amount`) or e5 (`amount_e5`) or formatted "$3.50". */
export function uberMoneyToNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value !== "object") return 0;
  if (value.amount_e5 != null && Number.isFinite(Number(value.amount_e5))) {
    return Number(value.amount_e5) / 1e5;
  }
  if (typeof value.formatted_amount === "string" || typeof value.formatted === "string") {
    const raw = value.formatted_amount || value.formatted;
    const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (value.amount != null && Number.isFinite(Number(value.amount))) {
    return Number(value.amount) / 100;
  }
  return 0;
}

export function mapUberStateToStatus(state) {
  const key = String(state || "").toUpperCase();
  return UBER_STATE_TO_STATUS[key] || "pending";
}

function extractCartItems(order) {
  if (Array.isArray(order?.cart?.items)) return order.cart.items;
  if (Array.isArray(order?.carts)) {
    return order.carts.flatMap((c) => (Array.isArray(c?.items) ? c.items : []));
  }
  if (Array.isArray(order?.items)) return order.items;
  return [];
}

function itemQuantity(item) {
  const q = item?.quantity;
  if (typeof q === "number") return Math.max(1, q);
  if (q && typeof q === "object" && q.amount != null) return Math.max(1, Number(q.amount) || 1);
  return 1;
}

function itemUnitPrice(item) {
  const price = item?.price;
  if (!price) return 0;
  if (price.unit_price) return uberMoneyToNumber(price.unit_price);
  if (price.total_price && itemQuantity(item)) {
    return uberMoneyToNumber(price.total_price) / itemQuantity(item);
  }
  return uberMoneyToNumber(price);
}

function itemLineTotal(item) {
  const price = item?.price;
  if (price?.total_price) return uberMoneyToNumber(price.total_price);
  return Number((itemUnitPrice(item) * itemQuantity(item)).toFixed(2));
}

function itemNotes(item) {
  const mods = item?.selected_modifier_groups;
  if (!Array.isArray(mods) || !mods.length) return item?.special_instructions || null;
  const bits = [];
  for (const g of mods) {
    const selected = (g.selected_items || []).map((s) => s.title || s.id).filter(Boolean);
    if (selected.length) bits.push(`${g.title || "Option"}: ${selected.join(", ")}`);
  }
  if (item?.special_instructions) bits.push(item.special_instructions);
  return bits.length ? bits.join("; ") : null;
}

function extractCustomer(order) {
  const eater = order.eater || {};
  const customer = order.customers?.[0] || {};
  const name =
    customer?.name?.display_name ||
    [customer?.name?.first_name, customer?.name?.last_name].filter(Boolean).join(" ") ||
    [eater.first_name, eater.last_name].filter(Boolean).join(" ") ||
    eater.first_name ||
    "Uber Eats customer";
  const phone =
    customer?.contact?.phone?.number ||
    eater.phone ||
    eater.phone_code ||
    "uber-eats";
  return { name: String(name).trim() || "Uber Eats customer", phone: String(phone).trim() || "uber-eats" };
}

function extractAddress(order) {
  const loc =
    order.eater?.delivery?.location ||
    order.deliveries?.[0]?.location ||
    order.carts?.[0]?.fulfillment_issue ||
    null;
  const parts = [
    loc?.street_address_line_one || loc?.street_address || loc?.address,
    loc?.street_address_line_two,
    loc?.city,
    loc?.postal_code,
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  const type = String(order.type || order.fulfillment_type || "").toUpperCase();
  if (type.includes("PICK")) return "Pickup — Uber Eats";
  return "Uber Eats delivery";
}

function extractTotals(order, lines) {
  const charges = order.payment?.charges || order.payment?.payment_detail || order.payment || {};
  const subtotalFromLines = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const subtotal =
    uberMoneyToNumber(charges.sub_total || charges.subtotal || charges.total_item_price) ||
    uberMoneyToNumber(order.payment?.payment_detail?.item_charges?.total?.net) ||
    subtotalFromLines;
  const tax =
    uberMoneyToNumber(charges.tax || charges.tax_amount || charges.total_tax) ||
    uberMoneyToNumber(order.payment?.payment_detail?.order_total?.tax);
  const deliveryFee = uberMoneyToNumber(
    charges.delivery_fee || charges.total_fee || charges.small_order_fee,
  );
  const discount = uberMoneyToNumber(charges.total_promo_applied || charges.promotion);
  const total =
    uberMoneyToNumber(charges.total || charges.gross || order.payment?.payment_detail?.order_total?.gross) ||
    Number((subtotal + tax + deliveryFee - discount).toFixed(2));
  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    deliveryFee: Number(deliveryFee.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

function fulfillmentType(order) {
  const type = String(order.type || order.fulfillment_type || "").toUpperCase();
  if (type.includes("PICK")) return "pickup";
  if (type.includes("DINE")) return "dine_in";
  return "delivery";
}

export async function resolveRestaurantIdForUberStore(storeId) {
  const knex = getKnex();
  const sid = storeId ? String(storeId) : "";
  if (sid) {
    const mapped = await knex("restaurants").where({ uber_store_id: sid }).first("id");
    if (mapped?.id) return mapped.id;
  }
  const envRestaurant = String(process.env.UBER_RESTAURANT_ID || "").trim();
  if (envRestaurant) return envRestaurant;

  const cfg = getUberConfig();
  if (cfg.defaultStoreId && sid && cfg.defaultStoreId === sid) {
    const fallback = String(process.env.UBER_RESTAURANT_ID || "").trim();
    if (fallback) return fallback;
  }

  const parent = await knex("restaurants")
    .whereNull("parent_restaurant_id")
    .orderBy("created_at", "asc")
    .first("id", "uber_store_id");
  if (parent?.id && sid && !parent.uber_store_id) {
    await knex("restaurants").where({ id: parent.id }).update({ uber_store_id: sid });
  }
  return parent?.id || null;
}

function trackingCode(uberOrderId) {
  return `UBER-${uberOrderId}`;
}

/**
 * @param {object} uberPayload raw Uber order (v2 details or list item)
 * @param {{ notify?: boolean }} [opts]
 */
export async function syncUberOrderToRestaurant(uberPayload, opts = {}) {
  const order = unwrapUberOrder(uberPayload);
  const uberOrderId = order?.id || order?.order_id;
  if (!uberOrderId) {
    throw new Error("Cannot sync Uber order without id");
  }

  const knex = getKnex();
  const storeId = order.store?.id || order.store_id || order.store?.store_id || null;
  const restaurantId = await resolveRestaurantIdForUberStore(storeId);
  if (!restaurantId) {
    uberLog.warn("No restaurant mapped for Uber store — skip kitchen sync", {
      uber_order_id: uberOrderId,
      store_id: storeId,
    });
    return null;
  }

  const customer = extractCustomer(order);
  const lines = extractCartItems(order).map((item) => ({
    item_name: item.title || item.name || item.id || "Item",
    quantity: itemQuantity(item),
    unit_price: itemUnitPrice(item),
    line_total: itemLineTotal(item),
    notes: itemNotes(item),
  }));
  const totals = extractTotals(order, lines);
  const state = order.current_state || order.state || null;
  const status = mapUberStateToStatus(state);
  const placedAtRaw = order.placed_at || order.created_time || order.order_time || null;
  const placedAt = placedAtRaw && !Number.isNaN(new Date(placedAtRaw).getTime())
    ? new Date(placedAtRaw).toISOString()
    : new Date().toISOString();
  const displayId = order.display_id ? String(order.display_id) : String(uberOrderId).slice(-5).toUpperCase();
  const code = trackingCode(uberOrderId);
  const type = fulfillmentType(order);

  const existing =
    (await knex("orders").where({ tracking_code: code }).first()) ||
    (await knex("orders").where({ source: "uber", external_order_id: String(uberOrderId) }).first());

  const marketplaceStatus = kitchenToMarketplaceStatus(status);
  const skipStatus =
    existing &&
    wouldDowngrade(
      existing.marketplace_status || kitchenToMarketplaceStatus(existing.status),
      marketplaceStatus,
    );

  const patch = {
    restaurant_id: restaurantId,
    customer_name: customer.name,
    customer_phone: customer.phone,
    delivery_address: extractAddress(order),
    delivery_notes: order.cart?.special_instructions || order.special_instructions || null,
    fulfillment_type: type,
    source: "uber",
    external_order_id: String(uberOrderId),
    marketplace_store_id: storeId ? String(storeId) : null,
    marketplace_status: skipStatus
      ? existing.marketplace_status || kitchenToMarketplaceStatus(existing.status)
      : marketplaceStatus,
    marketplace_items: knex.raw("?::jsonb", [JSON.stringify(lines)]),
    marketplace_totals: knex.raw("?::jsonb", [JSON.stringify(totals)]),
    raw_payload: knex.raw("?::jsonb", [JSON.stringify(order)]),
    payment_method: "uber",
    payment_status: (skipStatus ? existing.status : status) === "cancelled" ? "unpaid" : "paid",
    subtotal: totals.subtotal,
    tax_amount: totals.tax,
    delivery_fee: totals.deliveryFee,
    discount_amount: totals.discount,
    total_amount: totals.total,
    notes: `Uber Eats #${displayId}`,
    ai_extracted_data: knex.raw("?::jsonb", [
      JSON.stringify({
        uber_order_id: String(uberOrderId),
        uber_display_id: displayId,
        uber_store_id: storeId,
        uber_state: state,
        channel: "uber",
      }),
    ]),
    updated_at: new Date().toISOString(),
  };

  if (!skipStatus) {
    patch.status = status;
  }

  let local;
  let created = false;

  if (existing) {
    const [updated] = await knex("orders").where({ id: existing.id }).update(patch).returning("*");
    local = updated;
    if (!skipStatus) {
      await knex("order_items").where({ order_id: existing.id }).del();
    }
  } else {
    const orderNumber = `UE-${displayId}`.slice(0, 40);
    const collision = await knex("orders")
      .where({ restaurant_id: restaurantId, order_number: orderNumber })
      .first("id");
    const number = collision ? `UE-${String(uberOrderId).slice(0, 8).toUpperCase()}` : orderNumber;
    const [inserted] = await knex("orders")
      .insert({
        ...patch,
        order_number: number,
        tracking_code: code,
        created_at: placedAt,
      })
      .returning("*");
    local = inserted;
    created = true;
  }

  if (lines.length && (!existing || !skipStatus)) {
    const dbMenuItems = await knex("menu_items")
      .where({ restaurant_id: restaurantId })
      .select("id", "name");
    const nameMap = new Map(dbMenuItems.map((m) => [String(m.name || "").toLowerCase().trim(), m.id]));

    await knex("order_items").insert(
      lines.map((l) => ({
        order_id: local.id,
        menu_item_id: nameMap.get(String(l.item_name || "").toLowerCase().trim()) || null,
        item_name: l.item_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        line_total: l.line_total,
        notes: l.notes,
      })),
    );
  }

  await knex("uber_orders").where({ uber_order_id: String(uberOrderId) }).update({
    local_order_id: local.id,
    updated_at: new Date().toISOString(),
  });

  // Consistent trigger: deduct stock when confirmed/ready/delivered; restore if cancelled
  try {
    if (status === "cancelled") {
      await restoreStockForOrder(knex, local.id);
    } else if (["confirmed", "ready", "delivered"].includes(status)) {
      await deductStockForOrder(knex, local.id);
    }
  } catch (stockErr) {
    uberLog.warn("Stock deduction/restoration warning on Uber order sync:", { error: stockErr.message });
  }

  if (created && opts.notify !== false && (status === "pending" || status === "confirmed")) {
    notifyNewOrderLater(knex, local);
  }

  uberLog.info("Synced Uber order into kitchen orders", {
    uber_order_id: uberOrderId,
    local_order_id: local.id,
    order_number: local.order_number,
    status,
    created,
  });

  return { local, created };
}

export async function syncUberStateToRestaurant(uberOrderId, uberState) {
  const knex = getKnex();
  const code = trackingCode(uberOrderId);
  const existing =
    (await knex("orders").where({ tracking_code: code }).first()) ||
    (await knex("orders").where({ source: "uber", external_order_id: String(uberOrderId) }).first());
  if (!existing) return null;
  const status = mapUberStateToStatus(uberState);
  const marketplaceStatus = kitchenToMarketplaceStatus(status);
  if (
    wouldDowngrade(
      existing.marketplace_status || kitchenToMarketplaceStatus(existing.status),
      marketplaceStatus,
    )
  ) {
    return existing;
  }
  const patch = {
    status,
    marketplace_status: marketplaceStatus,
    updated_at: new Date().toISOString(),
  };
  if (status === "cancelled") patch.payment_status = "unpaid";
  const [updated] = await knex("orders").where({ id: existing.id }).update(patch).returning("*");

  try {
    if (status === "cancelled") {
      await restoreStockForOrder(knex, existing.id);
    } else if (["confirmed", "ready", "delivered"].includes(status)) {
      await deductStockForOrder(knex, existing.id);
    }
  } catch (stockErr) {
    uberLog.warn("Stock deduction/restoration warning on Uber state sync:", { error: stockErr.message });
  }

  return updated;
}
