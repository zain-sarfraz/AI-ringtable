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
  applyBranchOrdering,
  buildRestaurantVoiceKnowledge,
  defaultSynthflowPrompt,
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
  it("0 or 1 configured branch → absolute NEVER-ask-area block (no branch choice)", () => {
    for (const text of [branchOrderingSection([]), branchOrderingSection([single])]) {
      assert.match(text, /## Branch ordering/);
      assert.match(text, /NO BRANCH CHOICE/i);
      assert.match(text, /NEVER ask which branch, area, town, or city/i);
      assert.match(text, /FORBIDDEN spoken words\/areas/i);
      assert.doesNotMatch(text, /Johar Town/i);
      assert.doesNotMatch(text, /Iqbal Town/i);
      assert.match(text, /branch_name as exactly none/i);
      assert.match(text, /NEVER ask area after haan/i);
      assert.doesNotMatch(text, /Which area would you like/i);
    }
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
    assert.match(ur, /payment delivery ke waqt cash mein kar dena/i);
    assert.doesNotMatch(ur, /card or cash/i);
  });

  it("pickup → cash-only explained without asking for a payment choice", () => {
    const ur = cashOnlyPaymentProtocolLines({ urdu: true }).join("\n");
    assert.match(ur, /pickup par payment cash mein hogi/i);
    const en = cashOnlyPaymentProtocolLines({ urdu: false }).join("\n");
    assert.match(en, /cash only at pickup/i);
    assert.match(en, /do NOT ask the caller to choose a payment method/i);
  });

  it("customer requests card → polite cash-only refusal copy is present", () => {
    const ur = cashOnlyPaymentProtocolLines({ urdu: true }).join("\n");
    assert.match(ur, /Maazrat ji, is waqt sirf cash payment available hai/);
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
  it("appends cash-only rules to the tool contract (conditional on branch count)", () => {
    const multi = appendPlaceOrderToolContract("You are a test agent.", "ur", { branchCount: 2 });
    assert.match(multi, /CASH ONLY/i);
    assert.match(multi, /place_order always uses cash/i);
    assert.match(multi, /Delivery with multiple branches → branch_name "none"/);
    assert.match(multi, /branch_required: retry place_order/i);

    const singleContract = appendPlaceOrderToolContract("You are a test agent.", "ur", { branchCount: 0 });
    assert.match(singleContract, /CASH ONLY/i);
    assert.match(singleContract, /place_order always uses cash/i);
    assert.match(singleContract, /branch_name as exactly "none"/i);
    assert.match(singleContract, /NEVER ask area\/branch\/town/i);
    assert.doesNotMatch(singleContract, /Which area would you like/i);
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
    const fixed = applyBranchOrdering(rewriteStaleOrderSpeechRules(stale, 0), []);
    assert.doesNotMatch(fixed, /Which area would you like/i);
    assert.doesNotMatch(fixed, /city\/area\/branch or city\/area\/branch/i);
    assert.doesNotMatch(fixed, /area\/city\/area\/branch/i);
    assert.doesNotMatch(fixed, /any invented town/i);
    assert.match(fixed, /AFTER HAAN — CALL IMMEDIATELY/i);
    assert.match(fixed, /NO BRANCH CHOICE/i);
    assert.match(fixed, /NEVER ask which branch, area, town, or city/i);
    assert.match(fixed, /After place_order: if success\/speak\/order_number is present/i);
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
    assert.match(knowledge, /## Branch ordering/i);
    assert.match(knowledge, /NO BRANCH CHOICE/i);
    assert.match(knowledge, /NEVER ask which branch, area, town, or city/i);
    assert.doesNotMatch(knowledge, /Which area would you like/i);
    assert.match(knowledge, /CASH ONLY/i);
    assert.match(knowledge, /payment delivery ke waqt cash mein kar dena/i);
    assert.match(knowledge, /pickup par payment cash mein hogi/i);
    assert.match(knowledge, /Fulfillment: softly ask "Kya yeh order delivery ke liye hai ya pickup karein gay\?"/);
    assert.match(knowledge, /softly ask street address/i);
    assert.match(knowledge, /Do NOT ask address, area, or branch/);
    assert.doesNotMatch(knowledge, /Johar\/Iqbal/);
    assert.match(knowledge, /TRACK ORDER: ask only the order number/i);
    assert.match(knowledge, /TABLE: collect name/i);
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
    assert.match(knowledge, /EXACT DISH/i);
    assert.match(
      knowledge,
      /SUBCATEGORY PHONE SCRIPT for "Burger" \(1 item — offer then ask; do NOT auto-add\): Ji, Burger mein hamare paas Chicken Burger five hundred rupees hai\. Kya aap Chicken Burger order karna chahengay\?/i,
    );
    assert.match(knowledge, /## Branch ordering/i);
    assert.match(knowledge, /NO BRANCH CHOICE/i);
    assert.match(knowledge, /NEVER ask which branch, area, town, or city/i);
    assert.doesNotMatch(knowledge, /Which area would you like/i);
    assert.match(knowledge, /speak NOTHING/i);
    assert.match(knowledge, /softly ask street address/i);
    assert.match(knowledge, /Pass branch_name none for both/i);
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

describe("branch bug regression: branchless Pizza Go order scenarios", () => {
  it("T1: branchless pickup with branch_name 'none' — ok, no area question", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "pickup",
      branch_name: "none",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.chosenBranch, null);
    // shouldAskCaller must never be set for branchless restaurants
    assert.equal(d.shouldAskCaller, undefined);
  });

  it("T2: branchless delivery with address — ok, no area question, no shouldAskCaller", () => {
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "delivery",
      branch_name: "none",
      delivery_notes: "House 12, Gulberg III, Lahore",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.chosenBranch, null);
    assert.equal(d.shouldAskCaller, undefined);
  });

  it("T3: branchless restaurant — even with invented town name, ok and no area question", () => {
    // LLM sometimes invents area names even when backend says none; must still succeed silently.
    const d = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "pickup",
      branch_name: "Johar Town",
    });
    assert.equal(d.ok, true);
    assert.equal(d.skipAsk, true);
    assert.equal(d.shouldAskCaller, undefined);
  });

  it("T4: branchless prompt rewrite — never asks Johar/Iqbal; absolute NO-BRANCH block injected", () => {
    const stale = [
      "## Branch ordering",
      "This restaurant has NO branches and NO areas list.",
      'Ask: "Which area would you like: Johar Town or Iqbal Town?"',
      "Turn 1: Hello",
    ].join("\n");
    const fixed = applyBranchOrdering(rewriteStaleOrderSpeechRules(stale, 0), []);
    assert.doesNotMatch(fixed, /Which area would you like/i);
    assert.doesNotMatch(fixed, /any invented town/i);
    assert.doesNotMatch(fixed, /area\/city\/area\/branch/i);
    assert.doesNotMatch(fixed, /city\/area\/branch or city\/area\/branch/i);
    assert.match(fixed, /AFTER HAAN — CALL IMMEDIATELY/i);
    assert.match(fixed, /NO BRANCH CHOICE/i);
    assert.match(fixed, /FORBIDDEN spoken words\/areas/i);
  });

  it("T5: multi-branch restaurant — branch selection still works; Johar/Iqbal labels preserved", () => {
    const d = resolveVoiceBranchSelection({
      branches: [johar, iqbal],
      fulfillment_type: "pickup",
      branch_name: "Iqbal Town",
    });
    assert.equal(d.ok, true);
    assert.equal(d.chosenBranch?.id, "b2");
    // Multi-branch prompt rewrite must keep configured area labels
    const prompt = [
      "## Branch ordering",
      'Ask: "Which area would you like: Johar Town or Iqbal Town?"',
      '- Johar Town → branch_name "Royal - Johar Town"',
      '- Iqbal Town → branch_name "Royal - Iqbal Town"',
      "Turn 1: Hello",
    ].join("\n");
    const fixed = rewriteStaleOrderSpeechRules(prompt, 2);
    assert.match(fixed, /Johar Town/);
    assert.match(fixed, /Iqbal Town/);
    assert.doesNotMatch(fixed, /AFTER HAAN — NO BRANCH ASK/i);
  });
});

describe("Step 6: single-location vs multi-branch prompt generation & order handling", () => {
  it("generates prompt for single-location restaurant that NEVER asks which area/branch", () => {
    // 0 branches (standalone restaurant)
    const knowledge0 = buildRestaurantVoiceKnowledge({
      restaurantName: "Pizza Go",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 8.5 },
      categories: [{ id: "c1", name: "Fast Food", is_active: true }],
      subCategories: [{ id: "s1", name: "Burger", category_id: "c1", is_active: true }],
      items: [{ id: "i1", name: "Chicken Burger", category_id: "c1", sub_category_id: "s1", price: 500, is_available: true }],
      branches: [],
    });
    const prompt0 = defaultSynthflowPrompt("Pizza Go", knowledge0, "PKR", "ur", "female", { branchCount: 0 });
    const full0 = appendPlaceOrderToolContract(prompt0, "ur", { branchCount: 0 });

    assert.match(full0, /NO BRANCH CHOICE/i);
    assert.match(full0, /NEVER ask which branch, area, town, or city/i);
    assert.doesNotMatch(full0, /Which area would you like/i);

    // 1 branch (single-location restaurant with 1 child branch record)
    const knowledge1 = buildRestaurantVoiceKnowledge({
      restaurantName: "Pizza Go",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 8.5 },
      categories: [{ id: "c1", name: "Fast Food", is_active: true }],
      subCategories: [{ id: "s1", name: "Burger", category_id: "c1", is_active: true }],
      items: [{ id: "i1", name: "Chicken Burger", category_id: "c1", sub_category_id: "s1", price: 500, is_available: true }],
      branches: [single],
    });
    const prompt1 = defaultSynthflowPrompt("Pizza Go", knowledge1, "PKR", "ur", "female", { branchCount: 1 });
    const full1 = appendPlaceOrderToolContract(prompt1, "ur", { branchCount: 1 });

    assert.match(full1, /NO BRANCH CHOICE/i);
    assert.doesNotMatch(full1, /Which area would you like/i);
  });

  it("generates prompt for multi-branch restaurant with branch section present", () => {
    const knowledgeMulti = buildRestaurantVoiceKnowledge({
      restaurantName: "Royal Restaurant",
      currency: "PKR",
      preferUrduPrices: true,
      settings: { currency: "PKR", tax_rate: 8.5 },
      categories: [{ id: "c1", name: "Fast Food", is_active: true }],
      items: [{ id: "i1", name: "Chicken Burger", category_id: "c1", price: 500, is_available: true }],
      branches: [johar, iqbal],
    });
    const promptMulti = defaultSynthflowPrompt("Royal Restaurant", knowledgeMulti, "PKR", "ur", "female", { branches: [johar, iqbal] });
    const fullMulti = appendPlaceOrderToolContract(promptMulti, "ur", { branches: [johar, iqbal] });

    assert.match(fullMulti, /## Branch ordering\b/i);
    assert.match(fullMulti, /Johar Town/i);
    assert.match(fullMulti, /Iqbal Town/i);
    assert.match(fullMulti, /branch_name/i);
  });

  it("backend handler accepts a place_order call with no branch_name and defaults branch cleanly", () => {
    // Single branch restaurant: with no branch_name, empty string, or "none", assigns the only branch
    const dSingleNoBranch = resolveVoiceBranchSelection({
      branches: [single],
      fulfillment_type: "pickup",
      branch_name: null,
    });
    assert.equal(dSingleNoBranch.ok, true);
    assert.equal(dSingleNoBranch.chosenBranch?.id, "b3");
    assert.equal(dSingleNoBranch.skipAsk, true);

    const dSingleEmptyBranch = resolveVoiceBranchSelection({
      branches: [single],
      fulfillment_type: "pickup",
      branch_name: "",
    });
    assert.equal(dSingleEmptyBranch.ok, true);
    assert.equal(dSingleEmptyBranch.chosenBranch?.id, "b3");

    const dSingleNoneBranch = resolveVoiceBranchSelection({
      branches: [single],
      fulfillment_type: "pickup",
      branch_name: "none",
    });
    assert.equal(dSingleNoneBranch.ok, true);
    assert.equal(dSingleNoneBranch.chosenBranch?.id, "b3");

    // 0 branches restaurant: with no branch_name, resolves with chosenBranch: null and skipAsk: true
    const dZeroBranch = resolveVoiceBranchSelection({
      branches: [],
      fulfillment_type: "pickup",
      branch_name: null,
    });
    assert.equal(dZeroBranch.ok, true);
    assert.equal(dZeroBranch.chosenBranch, null);
    assert.equal(dZeroBranch.skipAsk, true);
  });
});

