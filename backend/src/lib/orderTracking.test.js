import "dotenv/config";
import test, { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { getKnex } from "../db.js";
import { aiOrderStatus } from "../fns/aiOrderStatus.js";

describe("aiOrderStatus user-friendly phone tracking & kitchen notes", () => {
  const knex = getKnex();

  function mockReqRes(body = {}) {
    let statusCode = 200;
    let jsonResult = null;
    const req = {
      body,
      query: {},
    };
    const res = {
      set() {
        return res;
      },
      status(code) {
        statusCode = code;
        return res;
      },
      json(data) {
        jsonResult = data;
        return res;
      },
    };
    return { req, res, getResult: () => jsonResult, getStatus: () => statusCode };
  }

  it("asks for phone number when neither phone nor order number is provided", async () => {
    const { req, res, getResult } = mockReqRes({});
    await aiOrderStatus(req, res);
    const result = getResult();

    assert.equal(result.found, false);
    assert.equal(result.phone_required, true);
    assert.equal(result.order_number_required, true);
    assert.match(result.speak, /kis phone number se place hua tha/i);
  });

  it("prioritizes active order among multiple orders for the same phone, includes items, name, bill, and notes instruction when preparing", async () => {
    // 1. Get or pick a test restaurant
    const rest = await knex("restaurants").select("id").first();
    assert.ok(rest, "Restaurant must exist in db");
    const testPhone = "+923249998877";
    const testCustName = "Hamza TestUser";

    // Clean up any previous test orders for this phone
    const oldOrders = await knex("orders").where({ customer_phone: testPhone }).select("id");
    if (oldOrders.length) {
      await knex("order_items").whereIn("order_id", oldOrders.map((o) => o.id)).del();
      await knex("orders").where({ customer_phone: testPhone }).del();
    }

    // 2. Insert 2 delivered orders (older)
    const [deliv1] = await knex("orders")
      .insert({
        restaurant_id: rest.id,
        order_number: `ORD-TEST-D1-${Date.now()}`,
        tracking_code: `TRK-D1-${Date.now()}`,
        customer_name: testCustName,
        customer_phone: testPhone,
        delivery_address: "Street 1, Lahore",
        status: "delivered",
        total_amount: 1200,
        created_at: new Date(Date.now() - 86400000), // yesterday
      })
      .returning("*");

    await knex("order_items").insert({
      order_id: deliv1.id,
      item_name: "Small Pizza",
      quantity: 1,
      unit_price: 1200,
      line_total: 1200,
    });

    const [deliv2] = await knex("orders")
      .insert({
        restaurant_id: rest.id,
        order_number: `ORD-TEST-D2-${Date.now()}`,
        tracking_code: `TRK-D2-${Date.now()}`,
        customer_name: testCustName,
        customer_phone: testPhone,
        delivery_address: "Street 1, Lahore",
        status: "delivered",
        total_amount: 800,
        created_at: new Date(Date.now() - 3600000), // 1 hour ago
      })
      .returning("*");

    await knex("order_items").insert({
      order_id: deliv2.id,
      item_name: "Garlic Bread",
      quantity: 2,
      unit_price: 400,
      line_total: 800,
    });

    // 3. Insert 1 ACTIVE order in 'preparing' status
    const [activeOrder] = await knex("orders")
      .insert({
        restaurant_id: rest.id,
        order_number: `ORD-TEST-ACT-${Date.now()}`,
        tracking_code: `TRK-ACT-${Date.now()}`,
        customer_name: testCustName,
        customer_phone: testPhone,
        delivery_address: "Street 1, Lahore",
        status: "preparing",
        total_amount: 2150,
        created_at: new Date(),
      })
      .returning("*");

    await knex("order_items").insert([
      {
        order_id: activeOrder.id,
        item_name: "Chicken Fajita Pizza Large",
        quantity: 1,
        unit_price: 1750,
        line_total: 1750,
      },
      {
        order_id: activeOrder.id,
        item_name: "Cold Drink 1.5L",
        quantity: 1,
        unit_price: 400,
        line_total: 400,
      },
    ]);

    try {
      // 4. Test tracking by phone without order number, passing customer instruction
      const { req, res, getResult } = mockReqRes({
        customer_phone: "0324-9998877", // local format with dash
        instruction: "chilli garlic sauce zyada rakhna",
      });

      await aiOrderStatus(req, res);
      const result = getResult();

      assert.equal(result.found, true);
      assert.equal(result.order_number, activeOrder.order_number);
      assert.equal(result.status, "preparing");
      assert.equal(result.customer_name, testCustName);
      assert.equal(result.instruction_updated, true);

      // Speak order: status → name → items → bill
      assert.match(result.speak, /^Ji, is waqt aapka order kitchen mein tayyar ho raha hai/i);
      assert.match(result.speak, new RegExp(testCustName, "i"), "Must mention customer name");
      assert.match(result.speak, /Chicken Fajita Pizza Large/i, "Must mention ordered items");
      assert.match(result.speak, /Cold Drink/i, "Must mention all items");
      assert.match(result.speak, /two thousand one hundred fifty/i, "Must mention bill amount");
      assert.match(result.speak, /kitchen notes mein darj/i, "Must confirm instruction added to kitchen notes");

      // Verify DB was updated with the instruction
      const updatedOrder = await knex("orders").where({ id: activeOrder.id }).first();
      assert.match(updatedOrder.notes, /Customer instruction: chilli garlic sauce zyada rakhna/i);
      assert.match(updatedOrder.delivery_notes, /chilli garlic sauce zyada rakhna/i);
    } finally {
      // Clean up test data
      await knex("order_items").whereIn("order_id", [deliv1.id, deliv2.id, activeOrder.id]).del();
      await knex("orders").whereIn("id", [deliv1.id, deliv2.id, activeOrder.id]).del();
    }
  });

  after(async () => {
    await knex.destroy();
  });
});
