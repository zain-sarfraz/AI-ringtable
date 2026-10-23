import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { branchOrderingSection } from "./branchLocation.js";
import { normalizeVoicePaymentMethod } from "./phoneOrderService.js";
import {
  cashOnlyPaymentProtocolLines,
  appendPlaceOrderToolContract,
  buildRestaurantVoiceKnowledge,
} from "./restaurantVoiceContext.js";

const johar = {
  id: "b1",
  name: "Royal - Johar Town",
  area: "Johar Town",
  city: "Lahore",
  address: "Johar Town, Lahore",
  is_active: true,
  is_accepting_orders: true,
};

const iqbal = {
  id: "b2",
  name: "Royal - Iqbal Town",
  area: "Iqbal Town",
  city: "Lahore",
  address: "Iqbal Town, Lahore",
  is_active: true,
  is_accepting_orders: true,
};

const single = {
  id: "b3",
  name: "Main Kitchen",
  area: "DHA Phase 5",
  city: "Lahore",
  address: "DHA Phase 5, Lahore",
  is_active: true,
  is_accepting_orders: true,
};

describe("branchOrderingSection", () => {
  it("no configured branches → never ask city/area/branch", () => {
    const text = branchOrderingSection([]);
    assert.match(text, /NO branches/i);
    assert.match(text, /Never ask which city, which area, which branch/i);
    assert.match(text, /branch_name as exactly none/i);
    assert.doesNotMatch(text, /Which area would you like/i);
    assert.doesNotMatch(text, /Johar Town/i);
    assert.doesNotMatch(text, /Iqbal Town/i);
  });

  it("multiple active branches → pickup asks listed areas only; delivery uses address + none", () => {
    const text = branchOrderingSection([johar, iqbal]);
    assert.match(text, /DELIVERY: Do NOT ask which city, area, or branch/i);
    assert.match(text, /Pass branch_name as exactly none/i);
    assert.match(text, /PICKUP and TABLE RESERVATIONS/i);
    assert.match(text, /Which area would you like: Johar Town or Iqbal Town/i);
    assert.match(text, /Johar Town → branch_name "Royal - Johar Town"/);
    assert.match(text, /Iqbal Town → branch_name "Royal - Iqbal Town"/);
    assert.match(text, /never say Johar Town \/ Iqbal Town unless that exact area appears below/i);
  });

  it("one active branch → auto-use; do not ask city/area", () => {
    const text = branchOrderingSection([single]);
    assert.match(text, /one active location/i);
    assert.match(text, /Do not ask for a city, an area, or which branch/i);
    assert.match(text, /Pass branch_name as "Main Kitchen"/);
    assert.doesNotMatch(text, /Which area would you like/i);
  });

  it("never invents Johar/Iqbal when those areas are not configured", () => {
    const otherA = { ...single, id: "a", name: "Branch A", area: "Gulberg" };
    const otherB = { ...single, id: "b", name: "Branch B", area: "Model Town" };
    const text = branchOrderingSection([otherA, otherB]);
    assert.match(text, /Which area would you like: Gulberg or Model Town/i);
    assert.doesNotMatch(text, /Johar Town or Iqbal Town/i);
    // Example labels must come from the configured list only.
    assert.match(text, /e\.g\. Gulberg, Model Town/);
  });
});

describe("cashOnlyPaymentProtocolLines", () => {
  it("delivery → cash explained as payable at delivery; no payment choice", () => {
    const ur = cashOnlyPaymentProtocolLines({ urdu: true }).join("\n");
    assert.match(ur, /CASH ONLY/i);
    assert.match(ur, /never ask the caller to choose a payment method/i);
    assert.match(ur, /Payment delivery ke waqt cash mein kar dena/);
    assert.doesNotMatch(ur, /card or cash/i);
  });

  it("pickup → cash-only explained without asking for a payment choice", () => {
    const ur = cashOnlyPaymentProtocolLines({ urdu: true }).join("\n");
    assert.match(ur, /Pickup par payment cash mein hogi/);
    const en = cashOnlyPaymentProtocolLines({ urdu: false }).join("\n");
    assert.match(en, /cash only at pickup/i);
    assert.match(en, /do NOT ask the caller to choose a payment method/i);
  });

  it("customer requests card → polite cash-only refusal copy is present", () => {
    const ur = cashOnlyPaymentProtocolLines({ urdu: true }).join("\n");
    assert.match(ur, /Maazrat, filhal sirf cash payment available hai/);
    assert.match(ur, /If they ask for card/i);
    const en = cashOnlyPaymentProtocolLines({ urdu: false }).join("\n");
    assert.match(en, /politely explain only cash is accepted/i);
  });
});

describe("normalizeVoicePaymentMethod", () => {
  it("stores the backend cash value for cash/COD and rejects unsupported methods", () => {
    assert.equal(normalizeVoicePaymentMethod(undefined), "cash");
    assert.equal(normalizeVoicePaymentMethod(null), "cash");
    assert.equal(normalizeVoicePaymentMethod(""), "cash");
    assert.equal(normalizeVoicePaymentMethod("cash"), "cash");
    assert.equal(normalizeVoicePaymentMethod("COD"), "cash");
    assert.equal(normalizeVoicePaymentMethod("cash on delivery"), "cash");
    assert.equal(normalizeVoicePaymentMethod("card"), "cash");
    assert.equal(normalizeVoicePaymentMethod("online"), "cash");
    assert.equal(normalizeVoicePaymentMethod("other"), "cash");
  });
});

describe("place_order contract + knowledge preserve cash and branch rules", () => {
  it("appends cash-only and branch_name none rules to the tool contract", () => {
    const prompt = appendPlaceOrderToolContract("You are a test agent.", "ur");
    assert.match(prompt, /CASH ONLY/i);
    assert.match(prompt, /place_order always uses cash/i);
    assert.match(prompt, /If NO branches → exactly "none"/);
    assert.match(prompt, /Delivery with multiple branches → branch_name "none"/);
  });

  it("knowledge with no branches does not ask for an area; payment is cash-only", () => {
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: "Test Cafe",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 0, delivery_fee: 0 },
      categories: [],
      subCategories: [],
      items: [],
      deals: [],
      discounts: [],
      variants: [],
      addons: [],
      itemAddons: [],
      branches: [],
    });
    assert.match(knowledge, /NO branches/i);
    assert.match(knowledge, /Never ask which city, which area, which branch/i);
    assert.match(knowledge, /CASH ONLY/i);
    assert.match(knowledge, /Payment delivery ke waqt cash mein kar dena/);
    assert.match(knowledge, /Pickup par payment cash mein hogi/);
    assert.doesNotMatch(knowledge, /Which area would you like/i);
  });

  it("knowledge with multiple branches asks pickup area from config only", () => {
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: "Royal",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 0, delivery_fee: 0 },
      categories: [],
      subCategories: [],
      items: [],
      deals: [],
      discounts: [],
      variants: [],
      addons: [],
      itemAddons: [],
      branches: [johar, iqbal],
    });
    assert.match(knowledge, /DELIVERY: Do NOT ask which city, area, or branch/i);
    assert.match(knowledge, /Which area would you like: Johar Town or Iqbal Town/i);
    assert.match(knowledge, /delivery: address only \+ branch_name none; pickup: ask listed area only/);
  });
});
