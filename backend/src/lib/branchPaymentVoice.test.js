import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { branchOrderingSection } from "./branchLocation.js";
import {
  normalizeVoicePaymentMethod,
  resolveVoiceBranchSelection,
} from "./phoneOrderService.js";
import {
  cashOnlyPaymentProtocolLines,
  appendPlaceOrderToolContract,
  buildRestaurantVoiceKnowledge,
} from "./restaurantVoiceContext.js";
import { rewriteStaleOrderSpeechRules } from "./promptMerge.js";

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
    assert.match(text, /Never invent areas that are not listed below/i);
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
    assert.match(prompt, /NEVER ask city\/area\/branch after the tool/i);
    assert.match(prompt, /branch_required but ## Branch ordering says NO branches/i);
    assert.doesNotMatch(prompt, /Johar Town/i);
    assert.doesNotMatch(prompt, /Iqbal Town/i);
  });

  it("branchless rewrite strips Johar/Iqbal priming and forbids post-success area ask", () => {
    const stale = [
      "## Branch ordering",
      "This restaurant has NO branches and NO areas list.",
      "Always pass branch_name as exactly none.",
      "",
      'Confirm FAST: then WAIT — on haan call place_order immediately. NEVER say daraj/darj/rupay.',
      "NEVER ask area/Johar/Iqbal after haan.",
      "8. Branch ordering section overrides location questions. No branches → never ask area/city/branch and NEVER say city/area/branch or city/area/branch; branch_name = none.",
      "11. After haan: call place_order ONCE immediately with branch_name \"none\". Do NOT ask Johar Town / Iqbal Town / area after haan.",
      "Turn 1: Hello",
    ].join("\n");
    const fixed = rewriteStaleOrderSpeechRules(stale, 0);
    assert.doesNotMatch(fixed, /Johar/i);
    assert.doesNotMatch(fixed, /Iqbal/i);
    assert.doesNotMatch(fixed, /city\/area\/branch or city\/area\/branch/i);
    assert.match(fixed, /never invent town names/i);
    assert.match(fixed, /AFTER HAAN — NO BRANCH ASK/i);
    assert.match(fixed, /After place_order: if success\/speak\/order_number is present/i);
    assert.match(fixed, /Do NOT ask another question/i);
  });

  it("multi-branch rewrite keeps configured Johar/Iqbal area labels", () => {
    const withAreas = [
      "## Branch ordering",
      'Ask: "Which area would you like: Johar Town or Iqbal Town?"',
      '- Johar Town → branch_name "Royal - Johar Town"',
      "Turn 1: Hello",
    ].join("\n");
    const fixed = rewriteStaleOrderSpeechRules(withAreas, 2);
    assert.match(fixed, /Johar Town/);
    assert.match(fixed, /Iqbal Town/);
    assert.doesNotMatch(fixed, /AFTER HAAN — NO BRANCH ASK/i);
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
    assert.match(knowledge, /pickup: ask ONLY areas printed under ## Branch ordering/i);
  });

  it("type-alone burger with one SKU asks explicit Chicken Burger accept; exact dish skips re-ask", () => {
    const knowledge = buildRestaurantVoiceKnowledge({
      restaurantName: "Pizza Go",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 8.5, delivery_fee: 0 },
      categories: [{ id: "c1", name: "Fast Food", is_active: true }],
      subCategories: [{ id: "s1", name: "Burger", category_id: "c1", is_active: true }],
      items: [
        {
          id: "i1",
          name: "Chicken Burger",
          category_id: "c1",
          sub_category_id: "s1",
          price: 500,
          is_available: true,
        },
      ],
      deals: [],
      discounts: [],
      variants: [],
      addons: [],
      itemAddons: [],
      branches: [],
    });
    assert.match(knowledge, /EXACT DISH FIRST/i);
    assert.match(knowledge, /TYPE-ALONE \/ SINGLE-ITEM/i);
    assert.match(
      knowledge,
      /SUBCATEGORY PHONE SCRIPT for "Burger" \(1 item — offer then ask; do NOT auto-add\): Ji, Burger mein hamare paas Chicken Burger five hundred rupees hai\. Kya aap Chicken Burger order karna chahenge\?/i,
    );
    assert.match(knowledge, /never re-ask the same dish/i);
    assert.match(knowledge, /Kya aap \[Item\] order karna chahenge\?/i);
    assert.match(knowledge, /NO branches/i);
    assert.match(knowledge, /speak NOTHING/i);
    assert.match(knowledge, /Delivery with no branches: street address only/i);
  });
});

describe("resolveVoiceBranchSelection", () => {
  it("no configured branches + pickup → ok, skipAsk, no area ask", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "pickup",
      branch_name: "none",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.chosenBranch, null);
  });

  it("branchless Pizza Go pickup: invented town name still succeeds without shouldAskCaller", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "pickup",
      branch_name: "Johar Town",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.chosenBranch, null);
    assert.equal(d.shouldAskCaller, undefined);
  });

  it("branchless Pizza Go delivery: never asks branch; address path stays open", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "delivery",
      branch_name: "none",
      delivery_notes: "House 12 Gulberg",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.chosenBranch, null);
  });

  it("no configured branches + delivery → ok without inventing a branch", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "delivery",
      branch_name: "Johar Town",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
  });

  it("multi-branch pickup without match → shouldAskCaller with configured areas only", () => {
    const d = resolveVoiceBranchSelection({
      branches: [johar, iqbal],
      fulfillment_type: "pickup",
      branch_name: "none",
    });
    assert.equal(d.ok, false);
    assert.equal(d.shouldAskCaller, true);
    assert.deepEqual(d.availableAreas.sort(), ["Iqbal Town", "Johar Town"].sort());
  });

  it("multi-branch delivery without spoken branch → ok (address/geo path, no area ask)", () => {
    const d = resolveVoiceBranchSelection({
      branches: [johar, iqbal],
      fulfillment_type: "delivery",
      branch_name: "none",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
  });

  it("pickup mismatch with blank area labels → shouldAskCaller false (no invented towns)", () => {
    const d = resolveVoiceBranchSelection({
      branches: [
        { id: "x1", name: "", area: "", city: "", is_active: true, is_accepting_orders: true },
        { id: "x2", name: "", area: "", city: "", is_active: true, is_accepting_orders: true },
      ],
      fulfillment_type: "pickup",
      branch_name: "somewhere",
    });
    assert.equal(d.ok, false);
    assert.equal(d.shouldAskCaller, false);
    assert.deepEqual(d.availableAreas, []);
  });

  it("multi-branch pickup with spoken area → assigns that branch", () => {
    const d = resolveVoiceBranchSelection({
      branches: [johar, iqbal],
      fulfillment_type: "pickup",
      branch_name: "Johar Town",
    });
    assert.equal(d.ok, true);
    assert.equal(d.chosenBranch?.id, "b1");
  });
});
