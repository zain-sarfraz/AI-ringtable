import {
  applyBranchOrdering,
  appendPlaceOrderToolContract,
  SOFT_TONE_MANNER_BLOCK,
} from "./restaurantVoiceContext.js";

export class PromptMergeError extends Error {
  constructor(message, code = "PROMPT_MERGE_ERROR") {
    super(message);
    this.name = "PromptMergeError";
    this.code = code;
  }
}

const CRITICAL_MARKERS = [
  { re: /PRIMARY MISSION/i, label: "PRIMARY MISSION" },
  { re: /## Branch ordering\b/i, label: "## Branch ordering" },
  { re: /## PLACE_ORDER TOOL CONTRACT/i, label: "## PLACE_ORDER TOOL CONTRACT" },
  { re: /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b/i, label: "payment rules" },
];

export function promptHasMenuKnowledge(text) {
  return /# .+ — Menu/m.test(String(text || "")) || /## Menu Categories/i.test(String(text || ""));
}

/**
 * Rewrite stale keyword-style confirmation + leftover COD / branch-ask lines in saved prompts.
 * Keeps custom conversation rules; only patches known bad templates.
 */
export function rewriteStaleOrderSpeechRules(prompt, branchCount = 0) {
  let text = String(prompt || "");

  // Soft manners: inject or refresh so live agents stop sounding rude/aggressive.
  if (/TONE & MANNERS \(CRITICAL/i.test(text)) {
    text = text.replace(
      /={3,}\s*\nTONE & MANNERS[\s\S]*?\n={3,}/i,
      SOFT_TONE_MANNER_BLOCK.trim(),
    );
  } else {
    const afterMission = text.search(/\nPRIMARY MISSION:[\s\S]*?\n\n/);
    if (afterMission !== -1) {
      const end = text.indexOf("\n\n", afterMission + 1);
      const insertAt = end !== -1 ? end + 2 : afterMission;
      text = `${text.slice(0, insertAt)}${SOFT_TONE_MANNER_BLOCK.trim()}\n\n${text.slice(insertAt)}`;
    } else {
      text = `${SOFT_TONE_MANNER_BLOCK.trim()}\n\n${text}`;
    }
  }
  text = text.replace(
    /You are the (?:friendly|polite, calm, direct, and concise) (?:phone ordering assistant|AI phone ordering assistant) for /gi,
    "You are the soft, warm, and polite phone ordering assistant for ",
  );
  text = text.replace(
    /a calm, confident Pakistani voice/gi,
    "a calm, gentle Pakistani voice",
  );
  text = text.replace(
    /Keep the order moving politely — never rush or sound impatient —\s*keep the order moving/gi,
    "Keep the order moving politely — one question, accept answer, next step, then confirm calmly",
  );
  text = text.replace(
    /DO NOT DRAG(?: the order)?(?: —|:)/gi,
    "Keep the order moving politely — one question, accept answer, next step, then confirm calmly —",
  );
  text = text.replace(
    /CONFIRM THE ORDER FAST \(DO NOT DRAG\)/gi,
    "CONFIRM THE ORDER CALMLY (POLITE — NEVER RUSH)",
  );
  text = text.replace(
    /"Maazrat, filhal sirf cash payment available hai\."/g,
    '"Maazrat ji, is waqt sirf cash payment available hai."',
  );

  text = text.replace(
    /Confirm FAST \(do not drag\): "Aapka order: \[qty\] \[item\], \[naam\], \[delivery \/ pickup\], (?:teks shamil karke|tax include kar ke|tax include kar k|tax shamil kar ke) (?:kul raqam|kul bill) \[English AFTER-TAX total e\.g\. five hundred forty [^\"]+\] hai\. Kya main yeh order confirm kar doon\?" Then WAIT — on haan(?: \/ kar do)? call place_order immediately\. NEVER say daraj\/darj\/rupay\./gi,
    'Confirm FAST in natural sentences (NOT keyword lists): "Aapka order yeh hai: [ek/do/teen] [item]. Yeh order [EXACT naam] ke naam par hai, [delivery / pickup] ke liye. Tax include kar ke kul bill [English AFTER-TAX total] rupees bana hai. Kya main yeh order confirm kar doon?" Then WAIT — on haan / kar do call place_order immediately. NEVER say daraj/darj/rupay.',
  );

  text = text.replace(
    /"Aapka order: \[quantity\] \[item name\], \[naam\], \[delivery ya pickup\], \[pata\], (?:teks shamil karke|tax include kar ke|tax include kar k|tax shamil kar ke) (?:kul raqam|kul bill) \[e\.g\. five hundred forty\] ([^"]+) hai\. Kya main yeh order confirm kar doon\?"/gi,
    '"Aapka order yeh hai: [ek/do/teen] [item name]. Yeh order [EXACT naam] ke naam par hai, [delivery ya pickup] ke liye. Tax include kar ke kul bill [e.g. five hundred forty three] $1 bana hai. Kya main yeh order confirm kar doon?"',
  );

  text = text.replace(
    /(?:teks shamil karke|tax include kar ke|tax include kar k|tax shamil kar ke)\s+kul\s+(?:bill|raqam)/gi,
    "Tax include kar ke kul bill",
  );

  text = text.replace(
    /10\. Payment is COD — never ask how they will pay\./g,
    '10. Payment is CASH ONLY — never ask how they will pay. Delivery: cash at delivery. Pickup: cash at pickup.',
  );

  text = text.replace(
    /Name:\s*"Aap(?:ka naam bata (?:dijiye|dein)| kis naam pe order karna chaheng[ei]| kis naam se order note karwana chaheng[ei])\?"/gi,
    'Name: "Ji, aap kis naam se order note karwana chahengay?"',
  );
  text = text.replace(
    /Phone:\s*ask once only\s*—\s*"Aapka (?:raabta|phone) number (?:bata (?:dijiye|dein)|share kar dein)\?"/gi,
    'Phone: ask once only — "Apna phone number share kar dein?"',
  );
  text = text.replace(
    /Ask once(?:,\s*naturally and warmly)?:\s*"Aapka (?:raabta|phone) number (?:bata (?:dijiye|dein)|share kar dein)\?"/gi,
    'Ask once: "Apna phone number share kar dein?"',
  );
  text = text.replace(
    /naam \(ask "Aap kis naam pe order karna chaheng[ei]\?", accept EXACT name first try\)/g,
    'naam (softly ask "Ji, aap kis naam se order note karwana chahengay?", accept EXACT name first try)',
  );
  text = text.replace(
    /naam \(softly ask "Ji, aap kis naam se order note karwana chaheng(?:e|ay)\?", accept EXACT name first try[^)]*\)/g,
    'naam (softly ask "Ji, aap kis naam se order note karwana chahengay?", accept EXACT name first try)',
  );
  text = text.replace(
    /Aapka naam bata dijiye\?/gi,
    "Ji, aap kis naam se order note karwana chahengay?",
  );
  text = text.replace(
    /(?:raabta|phone) number \(ask "Apna (?:raabta|phone) number (?:bata|share) (?:dein|dijiye|kar dein)\?", once; yahi = "same"\)/g,
    'phone (ask "Apna phone number share kar dein?", once; yahi = "same")',
  );
  text = text.replace(
    /Delivery:\s*softly ask "Apna mukammal address bata (?:dein|dijiye)\?", accept on first try, then phone\./gi,
    'Delivery: softly ask "Apna mukammal address bata dein?", accept on first try, then phone.',
  );
  text = text.replace(
    /(?:Apna Aapka|Aapka Apna|Ji,\s+apna|Apna|Aapka)\s+(?:raabta|rabta|phone)\s+number\s+(?:bata (?:dijiye|dein)|share kar dein)\?/gi,
    "Apna phone number share kar dein?",
  );
  text = text.replace(
    /Apna mukammal address bata dijiye\?/gi,
    'Apna mukammal address bata dein?',
  );
  text = text.replace(/teks shamil karke/gi, "Tax include kar ke");
  text = text.replace(/tax shamil kar ke/gi, "Tax include kar ke");
  text = text.replace(
    /Kya yeh order delivery ke liye hai ya pickup\?(?! karein)/gi,
    "Kya yeh order delivery ke liye hai ya pickup karein gay?",
  );
  text = text.replace(
    /Aapka (?:raabta|rabta) number bata dijiye\?/gi,
    "Apna phone number share kar dein?",
  );
  text = text.replace(
    /9\.\s*Track order: ask "Aapka order number kya hai\?"[^\n]*/gi,
    '9. TRACK ORDER: ask "Ji zaroor, aapka order kis phone number se place hua tha?" WAIT. Call get_order_status with customer_phone (yahi/same → "same"). If they already said an order number, pass order_number. READ speak EXACTLY — status first, then items, then bill.',
  );
  text = text.replace(
    /SOLE FOCUS: Catch the order number and get the status\./gi,
    "SOLE FOCUS: Ask the phone number the order was placed with, call get_order_status, READ speak (status, then items, then bill).",
  );
  text = text.replace(
    /TRACK → only order number; never area\/phone for status\./gi,
    "TRACK → ask placement phone number, then get_order_status. NEVER ask area.",
  );
  text = text.replace(
    /TRACK → never ask area\/branch; only order number \+ get_order_status\./gi,
    "TRACK → never ask area/branch; ask placement phone, then get_order_status.",
  );
  text = text.replace(
    /Ji,\s*aapka order confirm ho gaya hai/gi,
    'Aapka order confirm ho gaya hai',
  );
  // Stale single-item scripts that auto-continued → require explicit accept.
  text = text.replace(
    /(\w+ PHONE SCRIPT for "[^"]+" \(1 item — say it once, then continue\): )Acha ji, (.+?) ka hai\. Main yeh note kar leti hoon\./gi,
    (_m, prefix, bit) => {
      const itemName =
        String(bit)
          .replace(
            /\s+(small|medium|large|family|four|five|six|seven|eight|nine|one|two|three|hundred|thousand|rupees|\d|"|').*$/i,
            "",
          )
          .trim() || bit;
      const label = prefix.match(/PHONE SCRIPT for "([^"]+)"/i)?.[1] || "menu";
      return (
        `${prefix.replace(/say it once, then continue/i, "offer then ask; do NOT auto-add")}` +
        `Ji, ${label} mein hamare paas ${bit} hai. Kya aap ${itemName} order karna chahengay?`
      );
    },
  );
  text = text.replace(
    /(\w+ PHONE SCRIPT for "[^"]+" \(1 items? — say all 1, skip none\): )Ji, ([^.]+?) hain\. Aap konsa lena (?:chahenge|chahengi|chahengay)\?/gi,
    (_m, prefix, list) => {
      const itemBit = String(list)
        .replace(/^[^]*?\bmein hamare paas\s+/i, "")
        .trim();
      const itemName =
        itemBit
          .replace(
            /\s+(small|medium|large|family|four|five|six|seven|eight|nine|one|two|three|hundred|thousand|rupees|\d|"|').*$/i,
            "",
          )
          .trim() || itemBit;
      const label = prefix.match(/PHONE SCRIPT for "([^"]+)"/i)?.[1] || "menu";
      return (
        `${prefix.replace(/say all 1, skip none/i, "offer then ask; do NOT auto-add")}` +
        `Ji, ${label} mein hamare paas ${itemBit} hai. Kya aap ${itemName} order karna chahengay?`
      );
    },
  );
  text = text.replace(/\bchahengi\b/gi, (match, offset) => {
    const before = text.slice(Math.max(0, offset - 100), offset);
    if (/FORBIDDEN|NEVER/i.test(before)) return match;
    return "chahengay";
  });
  text = text.replace(/\bchahenge\b/gi, (match, offset) => {
    const before = text.slice(Math.max(0, offset - 100), offset);
    if (/FORBIDDEN|NEVER/i.test(before)) return match;
    return "chahengay";
  });
  text = text.replace(/chahein\s*gi\b/gi, (match, offset) => {
    const before = text.slice(Math.max(0, offset - 100), offset);
    if (/FORBIDDEN|NEVER/i.test(before)) return match;
    return "chahengay";
  });
  text = text.replace(
    /SINGLE-ITEM SCRIPT: if a PHONE SCRIPT has only 1 item, say that item \+ price and continue the order — NEVER ask which one they want\./gi,
    'TYPE-ALONE / SINGLE-ITEM: if they said only a type (e.g. "burger") and the matching script has 1 item, speak that item + price, then ask explicitly "Kya aap [Item] order karna chahengay?" WAIT for haan. Do NOT add the item until they accept. Never auto-select.',
  );

  // Turn-2 rules 2–3: exact dish must win over category PHONE SCRIPT (merge keeps old Turn rules).
  text = text.replace(
    /2\. If caller NAMED a dish \(e\.g\. "Chicken Burger order karna hai"\): quote THAT item price from the menu and continue\. Do NOT list the whole category\. NEVER call check_previous_order\. NEVER offer to repeat an old pizza\/order\.\n3\. CATEGORY LIST \(mandatory — overrides the short-sentence limit\):[\s\S]*?FORBIDDEN: "Kaunsa burger lena hai\?" without the matching list\. FORBIDDEN: reading Junk Food or any other category whose name does not match\. If they already named one exact dish, do not read a script\. Quote that one item only\./g,
    `2. FRESH ORDER FIRST (ABSOLUTE): If caller says they want to order or names any item/type (e.g. "Mujhe burger order karna hai"), PROCEED WITH THE NEW ORDER IMMEDIATELY. NEVER say "Aapka pehle wala order mil gaya hai" and NEVER ask "kya aap wahi order repeat karna chahengay?". NEVER call check_previous_order unless caller explicitly asks: "Mera pichla order repeat kar do" or "Pehle wala order bhej do".
   - CATEGORY OR GENERIC TYPE ("burger", "1 burger", "ek burger", "mujhe 1 burger order karna hai", "pizza", "koi drink"): Caller named a category or generic food type, NOT an exact menu item. You MUST read the matching PHONE SCRIPT from rule 3 ("Ji, Burger mein hamare paas Chicken Burger five hundred rupees ka hai. Kya aap Chicken Burger order karna chahengay?") and STOP and WAIT for their answer.
     * STRICTLY FORBIDDEN: NEVER ask for customer name in the same turn!
     * STRICTLY FORBIDDEN: NEVER merge price and name into one sentence!
     * STRICTLY FORBIDDEN: NEVER call place_order when caller says haan to this question!
     * Only after caller answers "Haan" or "Ji", in the NEXT turn ask: "Ji, aap kis naam se order note karwana chahengay?"
   - EXACT FULL DISH NAMED BY CALLER (caller literally speaks the exact words "Chicken Burger" / "1 Chicken Burger"): Softly confirm price and ask name: "Ji bilkul, Chicken Burger five hundred rupees ka hai. Ji, aap kis naam se order note karwana chahengay?" Do NOT read any PHONE SCRIPT. Do NOT ask again "Kya aap Chicken Burger order karna chahengay?" after they already named Chicken Burger. NEVER call check_previous_order.
3. CATEGORY LIST (only when they named a TYPE, not a full dish — overrides the short-sentence limit):
   - Use ONLY for type-alone phrases ("burger chahiye", "1 burger", "pizza", "koi drink") — NOT when they already said a full item name like "Chicken Burger".
   - A type match means the spoken TYPE word equals the subcategory/category name (burger → Burgers). Extra words like "order"/"chahiye" are ignored, but a full dish name is NOT a type match.
   - If a subcategory name matches, read that SUBCATEGORY PHONE SCRIPT word for word. Every item in it, every price. Do not add items from the parent category.
   - If no subcategory matches and a category name matches, read that CATEGORY PHONE SCRIPT word for word. Every item, every price.
   - If neither a category nor a subcategory is named that word, read the ITEM PHONE SCRIPT for that word. Say only those items. Do not read the parent category.
   - Multi-item script: say every listed item + price, then wait for their choice. Single-item script (1 item): say item + price, ask "Kya aap [Item] order karna chahengay?", WAIT for haan — do NOT auto-add.
   - FORBIDDEN: reading a PHONE SCRIPT after an exact dish was named. FORBIDDEN: auto-selecting the only item in a category without the caller's yes.`,
  );
  text = text.replace(
    /Multi-item script: say every listed item \+ price, then wait\. Single-item script \(1 item\): say that one item \+ price and CONTINUE — never ask which one\.\n\s*- FORBIDDEN: reading a PHONE SCRIPT after an exact dish was named\. FORBIDDEN: "Kaunsa burger lena hai\?" \/ "Aap konsa lena chahenge\?" when only 1 item exists or the dish is already chosen\./g,
    `Multi-item script: say every listed item + price, then wait for their choice. Single-item script (1 item): say item + price, ask "Kya aap [Item] order karna chahengay?", WAIT for haan — do NOT auto-add.
   - FORBIDDEN: reading a PHONE SCRIPT after an exact dish was named. FORBIDDEN: auto-selecting the only item in a category without the caller's yes.`,
  );
  text = text.replace(
    /7\. NEVER call check_previous_order unless caller clearly says they want the OLD\/LAST order repeated \("pehle wala", "wahi order", "repeat last"\)\. If any dish is named → fresh order only\./g,
    '7. FRESH ORDER FIRST: If caller says "Mujhe burger order karna hai" or names ANY item, proceed with fresh order immediately — NEVER say "Aapka pehle wala order mil gaya hai" and NEVER ask to repeat previous order. NEVER call check_previous_order unless caller clearly says they want the OLD/LAST order repeated ("pehle wala", "wahi order", "repeat last"). If any dish or type is named → fresh order only.',
  );

  text = text.replace(
    /Acha ji, Chicken Burger five hundred rupees ka hai\.\s*["']?\s*then continue to naam\/fulfillment\./gi,
    'Ji bilkul, Chicken Burger five hundred rupees ka hai. Ji, aap kis naam se order note karwana chahengay?" then continue to fulfillment.',
  );
  text = text.replace(
    /Call place_order ONLY after the caller confirms \(haan \/ theek hai \/ yes \/ kar do \/ confirm\) — then call IMMEDIATELY/gi,
    'Call place_order ONLY after caller confirms the FINAL ORDER SUMMARY ("Kya main yeh order confirm kar doon?" -> haan / kar do). STRICTLY FORBIDDEN to call on menu item accept questions',
  );

  const waitReplacement =
    Number(branchCount) <= 1
      ? "Then WAIT — on haan / kar do speak NOTHING; call place_order immediately. NEVER say daraj/darj/rupay."
      : 'Then WAIT — on haan / kar do speak NOTHING; call place_order immediately with branch_name per the Branch ordering section (NO branches → "none"). NEVER invent city/area names after haan. NEVER say daraj/darj/rupay.';
  text = text.replace(
    /Then WAIT — on haan(?:\s*\/\s*kar do)? call place_order immediately\. NEVER say daraj\/darj\/rupay\./gi,
    waitReplacement,
  );

  // Never teach the agent a failure script — it gets spoken even when the order later succeeds.
  text = text.replace(
    /Only after TWO hard failures \(no phone_required, no speak\) say once: "Order save nahi ho saka, ek baar phir try karte hain\."/gi,
    'FORBIDDEN forever on this call: "Order save nahi ho saka" / order fail / error. If success/speak/order_number is present, READ speak — order IS saved.',
  );
  text = text.replace(
    /If phone_required: read "speak", get digits, retry place_order — do NOT say order failed\. Only after TWO hard failures[^\n]*/gi,
    'If phone_required: READ speak once, take digits, retry place_order ONCE — NEVER say order failed. If success/speak present, READ speak EXACTLY.',
  );

  // Forbid agent from explaining that email is not needed on pickup
  text = text.replace(
    /\*\s*FORBIDDEN after pickup:\s*"Raseed ke liye email\?",\s*"Email bata dein\?",\s*"Koi email\?"/g,
    '* NEVER say "Raseed ke liye email nahi chahiye", "email nahi chahiye", or explain that email is not needed. Say NOTHING at all about email or receipts (complete silence).\n  * FORBIDDEN after pickup: any mention of email or receipt whatsoever.',
  );
  text = text.replace(
    /5\. Email: Pickup = NEVER ask email \/ raseed — jump to raabta number, customer_email=none\./g,
    "5. Email: Pickup = NEVER mention email or raseed at all (do NOT say 'email nahi chahiye' — complete silence on email), customer_email=none.",
  );

  if (Number(branchCount) <= 1) {
    // 1. Strip any multi-branch "## Branch ordering" (applyBranchOrdering re-injects the absolute NO-BRANCH block).
    text = text.replace(
      /## Branch ordering[^\n]*(?:\n(?!(?:#{1,6}\s|={3,}|-{3,}|\n|Turn\s+\d+:)).*)*/gi,
      "",
    );

    // 2. Replace Rule 8 and Rule 11 cleanly — never ask area when there is no branch choice.
    text = text.replace(
      /8\. Branch ordering section overrides location questions[^\n]*/gi,
      '8. Fulfillment: ask "Kya yeh order delivery ke liye hai ya pickup karein gay?"\n   - Delivery: ask street address ("Apna mukammal address bata dein?"), then phone number. Pass branch_name none.\n   - Pickup: customer collects directly from the restaurant. Say: "Theek hai ji, pickup ke liye note kar liya. Apna phone number share kar dein?" Go straight to phone. Pass branch_name none.',
    );
    text = text.replace(
      /11\. After (?:the caller says )?haan[^\n]*/gi,
      '11. After haan / kar do: speak NOTHING — call place_order ONCE immediately with branch_name none.',
    );

    // 3. Remove stale multi-branch ask lines and any town/area names completely.
    text = text.replace(/^[ \t]*(?:Ask|Which area|PICKUP and TABLE)[^\n]*(?:Johar|Iqbal|Which area|branch_name ")[^\n]*\r?\n?/gim, "");
    text = text.replace(
      /Then WAIT — on haan speak NOTHING; call place_order immediately[^\n]*?\. NEVER say daraj\/darj\/rupay\./gi,
      "Then WAIT — on haan speak NOTHING; call place_order immediately. NEVER say daraj/darj/rupay.",
    );
    text = text.replace(/Which area would you like:[^\n]*/gi, "");
    text = text.replace(/\(no Johar[^)]*\)/gi, "");
    text = text.replace(/\(FORBIDDEN:[^)]*(?:Johar|Iqbal)[^)]*\)/gi, "");
    text = text.replace(/\(FORBIDDEN:\s*\/\/any town\)/gi, "");
    text = text.replace(/\b(?:Johar|Iqbal)(?:\s+Town)?\b/gi, "");
    text = text.replace(/Johar\s*\/\s*Iqbal/gi, "");
    text = text.replace(/FORBIDDEN:\s*Johar Town,\s*Iqbal Town[^\n]*/gi, "This restaurant has only ONE location and NO branches.");
    text = text.replace(/\bJhajhar\s+Town\b/gi, "");
    text = text.replace(/with branch_name per the Branch ordering section(\s*\(NO branches → "none"\))?/gi, "with branch_name none");
    text = text.replace(/with branch_name per[^\n]*/gi, "with branch_name none.");
    text = text.replace(/\(NO branches → branch_name "none"\)/gi, "");
    text = text.replace(/\(NO branches → branch_name none\)/gi, "");
    text = text.replace(/- NEVER invent "branch 2" or a city\/area[^\n]*\n?/gi, "");

    const guardBody = `
=======================================================
AFTER HAAN — CALL IMMEDIATELY (CRITICAL):
- When caller confirms (haan / kar do / yes / theek hai / confirm): speak NOTHING — call place_order immediately with branch_name none.
- NEVER ask which branch/area and NEVER say "kaunsa area" after confirmation.
- While the tool runs: stay SILENT. Do not invent a problem.
- FORBIDDEN after haan (even if the tool is slow): "thora sa masla", "masla aa gaya", "dobara koshish", "dobara try", "line par rahen", "Order save nahi ho saka", "ek dafa phir try", "agar aap ready hon".
- After place_order: if success / speak / order_number is present, READ "speak" EXACTLY once — the order IS already saved. NEVER paraphrase. NEVER say fail.
=======================================================
`;
    if (/AFTER HAAN — /i.test(text)) {
      text = text.replace(
        /={3,}\s*\nAFTER HAAN[\s\S]*?\n={3,}/i,
        guardBody.trim(),
      );
    } else {
      const turn1 = text.search(/\nTurn 1:/);
      if (turn1 !== -1) {
        text = `${text.slice(0, turn1)}\n${guardBody.trim()}\n${text.slice(turn1)}`;
      } else {
        text = `${text.trim()}\n\n${guardBody.trim()}`;
      }
    }
  }

  return text;
}

/** Remove an existing place_order contract block so it can be refreshed in place. */
export function stripPlaceOrderToolContract(prompt) {
  return String(prompt || "")
    .replace(
      /\n?={3,}[^\n]*\n## PLACE_ORDER TOOL CONTRACT[\s\S]*?(?:\n={3,}[^\n]*\n?|(?=\n## )|$)/gi,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Always end with the current place_order contract (replace if present, else append). */
export function ensurePlaceOrderToolContract(prompt, lang = "ur", options = {}) {
  const stripped = stripPlaceOrderToolContract(prompt);
  return appendPlaceOrderToolContract(stripped, lang, options);
}

/**
 * Replace the menu/knowledge block (`# Name — Menu…`) while keeping conversation rules above it.
 */
export function replaceMenuKnowledgeBlock(prompt, knowledge) {
  const text = String(prompt || "");
  const block = String(knowledge || "").trim();
  if (!block) return text.trim();

  const startRe = /^# .+ — Menu[^\n]*/m;
  const match = startRe.exec(text);
  if (!match) {
    if (/## Menu Categories/i.test(text)) {
      const cat = /^## Menu Categories[^\n]*/im.exec(text);
      if (cat) {
        const start = cat.index;
        const after = text.slice(start);
        const contractRel = after.search(/\n={3,}[\s\S]*?## PLACE_ORDER TOOL CONTRACT/i);
        const end = contractRel === -1 ? text.length : start + contractRel;
        return `${text.slice(0, start).trimEnd()}\n\n${block}${text.slice(end)}`.trim();
      }
    }
    return `${text.trim()}\n\n${block}`.trim();
  }

  const start = match.index;
  const after = text.slice(start);
  const contractRel = after.search(/\n={3,}[\s\S]*?## PLACE_ORDER TOOL CONTRACT/i);
  const end = contractRel === -1 ? text.length : start + contractRel;
  return `${text.slice(0, start).trimEnd()}\n\n${block}${text.slice(end)}`.trim();
}

/**
 * Detect a short/partial frontend payload that would wipe a rich saved prompt.
 */
export function isPartialPromptOverwrite(saved, incoming) {
  const s = String(saved || "").trim();
  const i = String(incoming || "").trim();
  if (!s || !i) return false;
  if (i.length >= s.length * 0.7) return false;

  const savedMarkers = CRITICAL_MARKERS.filter((m) => m.re.test(s));
  if (!savedMarkers.length) {
    return i.length < 200 && s.length > 1000;
  }
  const missing = savedMarkers.filter((m) => !m.re.test(i));
  if (missing.length >= 2) return true;
  if (missing.length >= 1 && i.length < s.length * 0.5) return true;
  return false;
}

function syncedAtMs(value) {
  if (value == null || value === "") return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Resolve the prompt to send to Synthflow without silently wiping saved instructions.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.incoming - Prompt from the frontend editor (may be empty)
 * @param {string|null|undefined} opts.saved - Latest DB / backend prompt (source of truth)
 * @param {boolean} [opts.replaceFull=false] - Explicit full replace with incoming text
 * @param {boolean} [opts.refreshKnowledge=true] - Refresh menu/knowledge from catalog
 * @param {string} [opts.knowledge] - Fresh knowledge from buildRestaurantVoiceKnowledge
 * @param {array} [opts.branches]
 * @param {string} [opts.language]
 * @param {() => string} [opts.defaultPromptBuilder] - Used only when nothing is saved
 * @param {string|null} [opts.expectedSyncedAt] - Client's last known synthflow_synced_at
 * @param {string|null} [opts.currentSyncedAt] - DB synthflow_synced_at
 * @returns {string}
 */
export function resolveSynthflowPromptUpdate({
  incoming,
  saved,
  replaceFull = false,
  refreshKnowledge = true,
  refreshBranches = true,
  knowledge = "",
  branches = [],
  language = "ur",
  defaultPromptBuilder,
  expectedSyncedAt = null,
  currentSyncedAt = null,
} = {}) {
  const expectedMs = syncedAtMs(expectedSyncedAt);
  const currentMs = syncedAtMs(currentSyncedAt);
  if (expectedMs != null && currentMs != null && expectedMs !== currentMs) {
    throw new PromptMergeError(
      "Prompt was updated elsewhere since you loaded this page. Reload the settings, then try again.",
      "STALE_PROMPT_UPDATE",
    );
  }

  const incomingTrim = String(incoming ?? "").trim();
  const savedTrim = String(saved ?? "").trim();
  const wantReplace = Boolean(replaceFull);

  let base;
  if (wantReplace) {
    if (!incomingTrim) {
      throw new PromptMergeError(
        "Replace full prompt requires a non-empty system prompt. Paste the complete prompt, or turn off Replace full prompt.",
        "REPLACE_REQUIRES_PROMPT",
      );
    }
    base = incomingTrim;
  } else if (!incomingTrim) {
    // Empty/missing frontend field must never clear the saved prompt.
    if (savedTrim) {
      base = savedTrim;
    } else if (typeof defaultPromptBuilder === "function") {
      base = String(defaultPromptBuilder() || "").trim();
    } else {
      throw new PromptMergeError(
        "No saved agent prompt is available to update. Reload settings or provide a full system prompt.",
        "PROMPT_UNAVAILABLE",
      );
    }
  } else {
    if (savedTrim && isPartialPromptOverwrite(savedTrim, incomingTrim)) {
      throw new PromptMergeError(
        "Incoming prompt is missing required sections that exist in the saved prompt (e.g. branch, payment, or place_order rules). Load the full prompt in the editor, or enable Replace full prompt only if you intend to overwrite everything.",
        "AMBIGUOUS_PARTIAL_PROMPT",
      );
    }
    base = incomingTrim;
  }

  if (!base) {
    throw new PromptMergeError("Resolved agent prompt is empty.", "EMPTY_PROMPT");
  }

  let merged = base;
  let knowledgeTrim = String(knowledge || "").trim();
  if (refreshKnowledge && knowledgeTrim) {
    if (!refreshBranches && /## Branch ordering\b/i.test(knowledgeTrim)) {
      // In existing prompts, keep existing branches intact: do not inject branch block via menu knowledge
      knowledgeTrim = knowledgeTrim.replace(/\n## Branch ordering[\s\S]*?(?=\n## |\n={3,}|\n\n#|$)/gi, "");
    }
    if (promptHasMenuKnowledge(merged)) {
      merged = replaceMenuKnowledgeBlock(merged, knowledgeTrim);
    } else {
      merged = `${merged.trim()}\n\n${knowledgeTrim}`;
    }
  }

  const branchList = branches || [];
  if (refreshBranches) {
    merged = rewriteStaleOrderSpeechRules(merged, branchList.length);
    merged = applyBranchOrdering(merged, branchList);
  }
  merged = ensurePlaceOrderToolContract(merged, language, { branchCount: branchList.length });

  if (!String(merged || "").trim()) {
    throw new PromptMergeError("Merged agent prompt is empty after applying sections.", "EMPTY_PROMPT");
  }

  // Soft validation: if the saved prompt had cash/branch markers, the merge must keep them.
  if (savedTrim) {
    const hadCash = /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b|payment/i.test(savedTrim);
    const hasCash = /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b|Payment: CASH/i.test(merged);
    if (hadCash && !hasCash) {
      throw new PromptMergeError(
        "Merged prompt lost payment rules. Update aborted to protect cash-only configuration.",
        "LOST_PAYMENT_RULES",
      );
    }
    if (branchList.length >= 2 && /## Branch ordering\b/i.test(savedTrim) && !/## Branch ordering\b/i.test(merged)) {
      throw new PromptMergeError(
        "Merged prompt lost ## Branch ordering. Update aborted.",
        "LOST_BRANCH_SECTION",
      );
    }
  }

  if (!/## PLACE_ORDER TOOL CONTRACT/i.test(merged)) {
    throw new PromptMergeError(
      "Merged prompt is missing the place_order contract. Update aborted.",
      "LOST_PLACE_ORDER_CONTRACT",
    );
  }

  return merged.trim();
}
