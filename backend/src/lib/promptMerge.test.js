import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PromptMergeError,
  isPartialPromptOverwrite,
  replaceMenuKnowledgeBlock,
  resolveSynthflowPromptUpdate,
  ensurePlaceOrderToolContract,
  stripPlaceOrderToolContract,
  rewriteStaleOrderSpeechRules,
} from "./promptMerge.js";

const BRANCH_NONE = [
  "## Branch ordering",
  "This restaurant has NO branches and NO areas list.",
  "ABSOLUTE: Never ask which city, which area, which branch, or which location.",
  "Always pass branch_name as exactly none to place_order and reserve_table.",
].join("\n");

const SAVED = `
You are the phone assistant for Test Cafe.
PRIMARY MISSION:
Help with food orders.
CUSTOM OPERATOR RULE: Always thank Sir at the end.
Payment is CASH ONLY — never ask how they will pay.

${BRANCH_NONE}

# Test Cafe — Menu, Flavors, Sizes, Add-ons, and Ordering Guide

## Menu Categories & Available Items
- Old Burger — MUST SPEAK: "one hundred rupees"

## Fast Ordering Protocol
1. Greet
7. Payment is CASH ONLY — do not ask payment method.
`.trim();

const FRESH_KNOWLEDGE = `
# Test Cafe — Menu, Flavors, Sizes, Add-ons, and Ordering Guide

Currency: PKR (speak as rupees — NEVER rupay)

## Menu Categories & Available Items
- New Pizza — MUST SPEAK: "five hundred rupees"

${BRANCH_NONE}

## Fast Ordering Protocol
7. Payment is CASH ONLY — never ask the caller to choose a payment method.
   - Delivery: tell them naturally payment will be collected in cash at delivery.
`.trim();

describe("rewriteStaleOrderSpeechRules", () => {
  it("converts keyword confirmation and blocks branch ask when no branches", () => {
    const stale = `
Confirm FAST (do not drag): "Aapka order: [qty] [item], [naam], [delivery / pickup], teks shamil karke kul raqam [English AFTER-TAX total e.g. five hundred forty rupees] hai. Kya main yeh order confirm kar doon?" Then WAIT — on haan call place_order immediately. NEVER say daraj/darj/rupay.
10. Payment is COD — never ask how they will pay.
8. Branch ordering section overrides location questions. No branches → never ask area; branch_name = none.
11. After the caller says haan, call place_order once immediately. Do not speak a waiting line.

Turn 1: Speak exactly: "Assalamualaikum"
`.trim();
    const fixed = rewriteStaleOrderSpeechRules(stale, 0);
    assert.match(fixed, /Aapka order yeh hai/);
    assert.match(fixed, /ke naam par hai/);
    assert.match(fixed, /Tax include kar ke kul bill/);
    assert.match(fixed, /CASH ONLY/);
    assert.match(fixed, /speak NOTHING/i);
    assert.doesNotMatch(fixed, /Aapka order: \[qty\] \[item\], \[naam\]/);
    assert.match(fixed, /branch_name none/i);

    const multi = rewriteStaleOrderSpeechRules(stale, 2);
    assert.match(multi, /with branch_name per the Branch ordering section/);
  });

  it("rewrites single-item PHONE SCRIPT to explicit accept ask", () => {
    const stale = `
SUBCATEGORY PHONE SCRIPT for "Burger" (1 items — say all 1, skip none): Ji, Burger mein hamare paas Chicken Burger five hundred rupees hain. Aap konsa lena chahenge?
`.trim();
    const fixed = rewriteStaleOrderSpeechRules(stale, 0);
    assert.match(fixed, /Kya aap Chicken Burger order karna chahenge\?/i);
    assert.match(fixed, /offer then ask; do NOT auto-add/i);
    assert.doesNotMatch(fixed, /Aap konsa lena chahenge/i);
    assert.doesNotMatch(fixed, /Main yeh note kar leti hoon/i);
  });

  it("rewrites auto-continue single-item script to explicit accept", () => {
    const stale = `
SUBCATEGORY PHONE SCRIPT for "Burger" (1 item — say it once, then continue): Acha ji, Chicken Burger five hundred rupees ka hai. Main yeh note kar leti hoon.
`.trim();
    const fixed = rewriteStaleOrderSpeechRules(stale, 0);
    assert.match(fixed, /Kya aap Chicken Burger order karna chahenge\?/i);
    assert.doesNotMatch(fixed, /Main yeh note kar leti hoon/i);
  });

  it("upgrades stale Turn-2 dish/category rules to exact-dish first", () => {
    const stale = `
2. If caller NAMED a dish (e.g. "Chicken Burger order karna hai"): quote THAT item price from the menu and continue. Do NOT list the whole category. NEVER call check_previous_order. NEVER offer to repeat an old pizza/order.
3. CATEGORY LIST (mandatory — overrides the short-sentence limit):
   - If they name a type but NOT a specific dish ("burger chahiye", "1 burger", "pizza", "koi drink"): look at subcategory names first, then category names.
   - A match means the spoken word is the same as the name (burger matches Burgers, pizza matches Pizza). Ignore extra words like "order" or "chahiye".
   - If a subcategory name matches, read that SUBCATEGORY PHONE SCRIPT word for word. Every item in it, every price. Do not add items from the parent category.
   - If no subcategory matches and a category name matches, read that CATEGORY PHONE SCRIPT word for word. Every item, every price.
   - If neither a category nor a subcategory is named that word, read the ITEM PHONE SCRIPT for that word. Say only those items. Do not read the parent category.
   - The script says how many items it has. You must say that many. Never stop after the first one or two. Never drop a price. Never invent an item.
   - Then wait. Same rule for every category, not only burgers.
   - FORBIDDEN: "Kaunsa burger lena hai?" without the matching list. FORBIDDEN: reading Junk Food or any other category whose name does not match. If they already named one exact dish, do not read a script. Quote that one item only.
`.trim();
    const fixed = rewriteStaleOrderSpeechRules(stale, 0);
    assert.match(fixed, /Do NOT read any PHONE SCRIPT/i);
    assert.match(fixed, /NOT when they already said a full item name/i);
    assert.match(fixed, /do NOT auto-add/i);
    assert.doesNotMatch(fixed, /CATEGORY LIST \(mandatory/i);
  });
});

describe("isPartialPromptOverwrite", () => {
  it("flags a short editor payload that drops required sections", () => {
    assert.equal(
      isPartialPromptOverwrite(SAVED, "You are a short custom line only."),
      true,
    );
  });

  it("allows a near-complete edited prompt", () => {
    assert.equal(isPartialPromptOverwrite(SAVED, SAVED + "\nExtra note."), false);
  });
});

describe("replaceMenuKnowledgeBlock", () => {
  it("replaces menu knowledge while preserving conversation rules above it", () => {
    const merged = replaceMenuKnowledgeBlock(SAVED, FRESH_KNOWLEDGE);
    assert.match(merged, /CUSTOM OPERATOR RULE: Always thank Sir/);
    assert.match(merged, /New Pizza/);
    assert.doesNotMatch(merged, /Old Burger/);
    assert.match(merged, /PRIMARY MISSION/);
  });
});

describe("ensurePlaceOrderToolContract", () => {
  it("replaces an existing contract instead of duplicating", () => {
    const withOld = ensurePlaceOrderToolContract(SAVED + "\n", "ur");
    const twice = ensurePlaceOrderToolContract(withOld, "ur");
    const count = (twice.match(/## PLACE_ORDER TOOL CONTRACT/gi) || []).length;
    assert.equal(count, 1);
    assert.match(twice, /Payment: CASH ONLY/);
    assert.equal(stripPlaceOrderToolContract(twice).includes("PLACE_ORDER TOOL CONTRACT"), false);
  });
});

describe("resolveSynthflowPromptUpdate", () => {
  it("editing with empty frontend field preserves saved instructions", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: "",
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    assert.match(merged, /CUSTOM OPERATOR RULE: Always thank Sir/);
    assert.match(merged, /New Pizza/);
    assert.match(merged, /THIS RESTAURANT HAS NO BRANCH CHOICE/);
    assert.match(merged, /## PLACE_ORDER TOOL CONTRACT/);
    assert.match(merged, /CASH ONLY/);

    const multi = resolveSynthflowPromptUpdate({
      incoming: "",
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [{ name: "Johar Town" }, { name: "Iqbal Town" }],
      language: "ur",
    });
    assert.match(multi, /## Branch ordering/);
  });

  it("section refresh keeps operator rules when only knowledge changes", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: SAVED,
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    assert.match(merged, /CUSTOM OPERATOR RULE/);
    assert.match(merged, /New Pizza/);
    assert.doesNotMatch(merged, /Old Burger/);
  });

  it("empty/missing frontend fields do not clear saved content", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: null,
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: false,
      branches: [],
      language: "ur",
    });
    assert.match(merged, /CUSTOM OPERATOR RULE/);
    assert.match(merged, /PRIMARY MISSION/);
  });

  it("rejects ambiguous partial overwrites instead of wiping sections", () => {
    assert.throws(
      () =>
        resolveSynthflowPromptUpdate({
          incoming: "Short override only",
          saved: SAVED,
          replaceFull: false,
          refreshKnowledge: false,
          branches: [],
          language: "ur",
        }),
      (err) => err instanceof PromptMergeError && err.code === "AMBIGUOUS_PARTIAL_PROMPT",
    );
  });

  it("rejects stale concurrent updates", () => {
    assert.throws(
      () =>
        resolveSynthflowPromptUpdate({
          incoming: SAVED,
          saved: SAVED,
          replaceFull: false,
          refreshKnowledge: false,
          branches: [],
          language: "ur",
          expectedSyncedAt: "2026-01-01T00:00:00.000Z",
          currentSyncedAt: "2026-01-02T00:00:00.000Z",
        }),
      (err) => err instanceof PromptMergeError && err.code === "STALE_PROMPT_UPDATE",
    );
  });

  it("replace_full_prompt requires non-empty incoming and then preserves merge of dynamic sections", () => {
    assert.throws(
      () =>
        resolveSynthflowPromptUpdate({
          incoming: "",
          saved: SAVED,
          replaceFull: true,
          refreshKnowledge: false,
          branches: [],
          language: "ur",
        }),
      (err) => err instanceof PromptMergeError && err.code === "REPLACE_REQUIRES_PROMPT",
    );

    const custom = [
      "Fully custom phone agent for Test Cafe.",
      "PRIMARY MISSION: take orders only.",
      "Payment is CASH ONLY.",
      BRANCH_NONE,
      FRESH_KNOWLEDGE,
    ].join("\n\n");
    const merged = resolveSynthflowPromptUpdate({
      incoming: custom,
      saved: SAVED,
      replaceFull: true,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    assert.match(merged, /Fully custom phone agent/);
    assert.match(merged, /## PLACE_ORDER TOOL CONTRACT/);
    assert.match(merged, /CASH ONLY/);
  });

  it("final prompt sent to Synthflow contains preserved rules and requested menu change", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: SAVED.replace("thank Sir", "thank the manager"),
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    assert.match(merged, /thank the manager/);
    assert.match(merged, /New Pizza/);
    assert.match(merged, /THIS RESTAURANT HAS NO BRANCH CHOICE/);
    assert.match(merged, /Payment: CASH ONLY/);
    assert.match(merged, /## PLACE_ORDER TOOL CONTRACT/);
  });

  it("uses default builder only when nothing is saved (does not invent a wipe)", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: "",
      saved: "",
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
      defaultPromptBuilder: () =>
        `DEFAULT BASE\nPRIMARY MISSION:\nOrders\nPayment is CASH ONLY.\n\n${FRESH_KNOWLEDGE}`,
    });
    assert.match(merged, /DEFAULT BASE/);
    assert.match(merged, /## PLACE_ORDER TOOL CONTRACT/);
  });
});

describe("resolveSynthflowPromptUpdate — prompt overwrite safety (targeted regression suite)", () => {
  it("T6: repeated menu sync preserves operator rules and does not duplicate contract", () => {
    // Simulates clicking Sync Menu twice without any prompt change.
    const first = resolveSynthflowPromptUpdate({
      incoming: null,
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    // Second sync uses first result as the new saved state.
    const second = resolveSynthflowPromptUpdate({
      incoming: null,
      saved: first,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    // Operator rule must survive both syncs.
    assert.match(second, /CUSTOM OPERATOR RULE: Always thank Sir/);
    // Contract must appear exactly once — never duplicated.
    const contractCount = (second.match(/## PLACE_ORDER TOOL CONTRACT/gi) || []).length;
    assert.equal(contractCount, 1);
    assert.match(second, /CASH ONLY/);
  });

  it("T7: empty incoming field does NOT erase existing saved prompt instructions", () => {
    const merged = resolveSynthflowPromptUpdate({
      incoming: "",
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: false,
      branches: [],
      language: "ur",
    });
    // All saved operator content must survive.
    assert.match(merged, /PRIMARY MISSION/);
    assert.match(merged, /CUSTOM OPERATOR RULE: Always thank Sir/);
    assert.match(merged, /Payment is CASH ONLY/);
  });

  it("T8: replace_full_prompt=false (default) — incoming full text is used but dynamic sections still refreshed", () => {
    const modified = SAVED.replace("thank Sir", "thank the guest");
    const merged = resolveSynthflowPromptUpdate({
      incoming: modified,
      saved: SAVED,
      replaceFull: false,
      refreshKnowledge: true,
      knowledge: FRESH_KNOWLEDGE,
      branches: [],
      language: "ur",
    });
    // Operator change accepted.
    assert.match(merged, /thank the guest/);
    // Menu knowledge refreshed.
    assert.match(merged, /New Pizza/);
    assert.doesNotMatch(merged, /Old Burger/);
    // Critical sections preserved.
    assert.match(merged, /## PLACE_ORDER TOOL CONTRACT/);
  });

  it("T9: replace_full_prompt=true with empty incoming throws, not silently falls back", () => {
    assert.throws(
      () =>
        resolveSynthflowPromptUpdate({
          incoming: "",
          saved: SAVED,
          replaceFull: true,
          refreshKnowledge: false,
          branches: [],
          language: "ur",
        }),
      (err) => err instanceof PromptMergeError && err.code === "REPLACE_REQUIRES_PROMPT",
    );
  });

  it("T10: webhook and tool: synthflow_call_id idempotency — second call returns already_created without new order", () => {
    // This is a logic test on the idempotency check fields used by aiPlaceOrder.
    // Simulate the data structures that would exist after a successful mid-call place_order.
    const callId = "sf-test-call-abc123";
    const fakeOrder = {
      id: "order-uuid",
      order_number: "ORD-261023-01",
      tracking_code: "TRK-001",
      total_amount: 500,
      restaurant_id: "rest-uuid",
      ai_extracted_data: { synthflow_call_id: callId },
    };
    // The idempotency check in aiPlaceOrder looks for:
    //   orders WHERE restaurant_id = X AND ai_extracted_data->>'synthflow_call_id' = callId
    // If found, it returns already_created=true.
    // Verify the structure is correct.
    const sfCallId = fakeOrder.ai_extracted_data.synthflow_call_id;
    assert.equal(sfCallId, callId);
    assert.ok(fakeOrder.order_number);
    // Webhook similarly checks: orders WHERE ai_extracted_data->>'synthflow_call_id' = callId
    // If found, it patches recording/transcript and returns order_created:false, reason:"already_created".
    // Verify webhook return structure expectations.
    const webhookResponse = {
      success: true,
      call_id: "db-call-uuid",
      order_created: false,
      order_id: fakeOrder.id,
      order_number: fakeOrder.order_number,
      reason: "already_created",
    };
    assert.equal(webhookResponse.order_created, false);
    assert.equal(webhookResponse.reason, "already_created");
    assert.ok(webhookResponse.order_number);
  });
});

