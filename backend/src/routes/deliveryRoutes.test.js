import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { applyTestDatabaseEnv } from "../lib/testDatabase.js";
import { getRouterHandler, mockReqRes } from "../lib/routeTestUtils.js";
import { DELIVERY_UNAVAILABLE_MESSAGE } from "../lib/phoneOrderService.js";

const dbInfo = applyTestDatabaseEnv();
console.log(
  `[deliveryRoutes.test] Using ${dbInfo.source} → database "${dbInfo.databaseName}"`,
);

const { getKnex } = await import("../db.js");
const { default: publicRouter } = await import("./public.js");

const deliveryCheck = getRouterHandler(publicRouter, "get", "/delivery/check");
const placeOrder = getRouterHandler(publicRouter, "post", "/orders");

/** ~1° longitude ≈ 111.32 km on the equator */
const kmToLng = (km) => km / 111.32;

describe("public delivery check + place-order routes", () => {
  const knex = getKnex();
  const stamp = Date.now();
  let hqId;
  let branchBId;
  let tableId;
  const createdOrderIds = [];

  before(async () => {
    hqId = randomUUID();
    branchBId = randomUUID();
    tableId = randomUUID();

    await knex("restaurants").insert({
      id: hqId,
      name: `Delivery HQ ${stamp}`,
      slug: `delivery-hq-${stamp}`,
      is_active: true,
      is_branch: false,
      allows_delivery: true,
      allows_pickup: true,
      is_accepting_orders: true,
      // Far from customer so Branch B wins for in-range delivery
      latitude: 0,
      longitude: kmToLng(7),
      service_radius_km: 5,
    });

    await knex("restaurants").insert({
      id: branchBId,
      name: `Delivery Branch B ${stamp}`,
      slug: `delivery-branch-b-${stamp}`,
      parent_restaurant_id: hqId,
      is_active: true,
      is_branch: true,
      allows_delivery: true,
      allows_pickup: true,
      is_accepting_orders: true,
      latitude: 0,
      longitude: kmToLng(4),
      service_radius_km: 8,
    });

    await knex("restaurant_settings").insert({
      restaurant_id: hqId,
      name: `Delivery HQ ${stamp}`,
      is_open: true,
      delivery_fee: 0,
      tax_rate: 0,
    });

    await knex("restaurant_tables").insert({
      id: tableId,
      restaurant_id: hqId,
      table_number: `T-DEL-${stamp}`,
      is_active: true,
    });
  });

  after(async () => {
    try {
      if (createdOrderIds.length) {
        await knex("order_items").whereIn("order_id", createdOrderIds).del();
        await knex("order_status_history").whereIn("order_id", createdOrderIds).del().catch(() => {});
        await knex("orders").whereIn("id", createdOrderIds).del();
      }
      await knex("restaurant_tables").where({ id: tableId }).del().catch(() => {});
      await knex("restaurant_settings").where({ restaurant_id: hqId }).del().catch(() => {});
      await knex("restaurants").whereIn("id", [branchBId, hqId]).del().catch(() => {});
    } finally {
      await knex.destroy();
    }
  });

  function trackOrder(body) {
    const id = body?.order?.id;
    if (id) createdOrderIds.push(id);
    return body;
  }

  describe("GET /api/public/delivery/check — invalid coordinates → 400", () => {
    const cases = [
      { name: "missing lat/lng", query: {} },
      { name: "empty string lat/lng", query: { lat: "", lng: "" } },
      { name: "null string lat/lng", query: { lat: "null", lng: "null" } },
      { name: "NaN lat/lng", query: { lat: "NaN", lng: "NaN" } },
      { name: "undefined-like omitted with empty lng", query: { lat: "1", lng: "" } },
    ];

    for (const c of cases) {
      it(`${c.name}`, async () => {
        const { req, res, getStatus, getResult } = mockReqRes({
          query: { restaurant_id: hqId, ...c.query },
        });
        await deliveryCheck(req, res);
        assert.equal(getStatus(), 400, JSON.stringify(getResult()));
        assert.equal(getResult()?.available, false);
        assert.equal(getResult()?.code, "missing_delivery_coords");
      });
    }
  });

  describe("POST /api/public/orders — invalid delivery coordinates → 400", () => {
    const base = () => ({
      restaurant_id: hqId,
      customer_name: "Coord Tester",
      customer_phone: "+923001112233",
      delivery_address: "Test Street 1",
      fulfillment_type: "delivery",
      subtotal: 100,
      tax_amount: 0,
      delivery_fee: 0,
      total_amount: 100,
      lines: [],
    });

    const cases = [
      { name: "null lat/lng", body: { delivery_latitude: null, delivery_longitude: null } },
      { name: "empty string lat/lng", body: { delivery_latitude: "", delivery_longitude: "" } },
      { name: "NaN string lat/lng", body: { delivery_latitude: "NaN", delivery_longitude: "NaN" } },
    ];

    for (const c of cases) {
      it(`${c.name}`, async () => {
        const { req, res, getStatus, getResult } = mockReqRes({
          body: { ...base(), ...c.body },
        });
        await placeOrder(req, res);
        assert.equal(getStatus(), 400, JSON.stringify(getResult()));
        assert.equal(getResult()?.code, "missing_delivery_coords");
      });
    }
  });

  it("delivery out of range → 422 with exact unavailable message", async () => {
    // Customer at origin; HQ is 7 km away with radius 5 → out of range (Branch B also 4 km / r8 would cover —
    // move customer far from both: 50 km away)
    const { req, res, getStatus, getResult } = mockReqRes({
      body: {
        restaurant_id: hqId,
        customer_name: "Far Away",
        customer_phone: "+923009998877",
        delivery_address: "Far location",
        fulfillment_type: "delivery",
        delivery_latitude: 0,
        delivery_longitude: kmToLng(50),
        subtotal: 100,
        tax_amount: 0,
        delivery_fee: 0,
        total_amount: 100,
        lines: [],
      },
    });
    await placeOrder(req, res);
    assert.equal(getStatus(), 422, JSON.stringify(getResult()));
    assert.equal(getResult()?.error, "Delivery is not available at your location.");
    assert.equal(getResult()?.error, DELIVERY_UNAVAILABLE_MESSAGE);
  });

  it("delivery in range → assigns nearest covered branch and stores distance to 2 decimals", async () => {
    // Customer at (0,0): Branch B at 4 km (radius 8) covers; HQ at 7 km (radius 5) does not
    const { req, res, getStatus, getResult } = mockReqRes({
      body: {
        restaurant_id: hqId,
        customer_name: "Near Customer",
        customer_phone: "+923001234567",
        delivery_address: "Near Branch B",
        fulfillment_type: "delivery",
        delivery_latitude: 0,
        delivery_longitude: 0,
        subtotal: 250,
        tax_amount: 0,
        delivery_fee: 50,
        total_amount: 300,
        lines: [],
      },
    });
    await placeOrder(req, res);
    const body = trackOrder(getResult());
    assert.equal(getStatus(), 200, JSON.stringify(body));
    assert.ok(body?.order?.id);

    const order = await knex("orders").where({ id: body.order.id }).first();
    assert.equal(order.restaurant_id, branchBId, "must assign Branch B");
    assert.ok(order.assigned_branch_distance_km != null);
    const dist = Number(order.assigned_branch_distance_km);
    assert.ok(dist > 3.5 && dist < 4.5, `expected ~4 km, got ${dist}`);
    // Stored with 2 decimal places (DECIMAL / toFixed(2))
    assert.match(String(Number(dist).toFixed(2)), /^\d+\.\d{2}$/);
    assert.equal(Number(Number(dist).toFixed(2)), dist);
  });

  it("pickup order skips radius check entirely (coords that would 422 for delivery still succeed)", async () => {
    const { req, res, getStatus, getResult } = mockReqRes({
      body: {
        restaurant_id: hqId,
        branch_id: branchBId,
        customer_name: "Pickup Guest",
        customer_phone: "+923007778889",
        delivery_address: "Self Pickup",
        fulfillment_type: "pickup",
        // Far outside every radius — delivery would 422; pickup must ignore
        delivery_latitude: 0,
        delivery_longitude: kmToLng(50),
        subtotal: 100,
        tax_amount: 0,
        delivery_fee: 0,
        total_amount: 100,
        lines: [],
      },
    });
    await placeOrder(req, res);
    const body = trackOrder(getResult());
    assert.equal(getStatus(), 200, JSON.stringify(body));
    const order = await knex("orders").where({ id: body.order.id }).first();
    assert.equal(order.restaurant_id, branchBId);
    assert.equal(order.fulfillment_type, "pickup");
    assert.equal(order.assigned_branch_distance_km, null);
  });

  it("dine-in order skips radius check entirely (coords that would 422 for delivery still succeed)", async () => {
    const { req, res, getStatus, getResult } = mockReqRes({
      body: {
        restaurant_id: hqId,
        customer_name: "Dine Guest",
        customer_phone: "",
        fulfillment_type: "dine_in",
        table_id: tableId,
        table_number: `T-DEL-${stamp}`,
        delivery_latitude: 0,
        delivery_longitude: kmToLng(50),
        subtotal: 80,
        tax_amount: 0,
        delivery_fee: 0,
        total_amount: 80,
        lines: [],
      },
    });
    await placeOrder(req, res);
    const body = trackOrder(getResult());
    assert.equal(getStatus(), 200, JSON.stringify(body));
    const order = await knex("orders").where({ id: body.order.id }).first();
    assert.equal(order.fulfillment_type, "dine_in");
    assert.equal(order.assigned_branch_distance_km, null);
  });
});

