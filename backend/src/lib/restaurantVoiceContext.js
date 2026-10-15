import { branchOrderingSection } from "./branchLocation.js";

export { branchOrderingSection };

/** Active child branches the phone agent may offer. */
export async function loadActiveChildBranches(knex, restaurantId) {
  const restaurant = await knex("restaurants").where({ id: restaurantId }).select("id", "parent_restaurant_id").first();
  const parentId = restaurant?.parent_restaurant_id || restaurantId;
  if (!parentId) return [];
  return knex("restaurants")
    .where({ parent_restaurant_id: parentId, is_branch: true, is_active: true, is_accepting_orders: true })
    .orderBy("name", "asc")
    .select("id", "name", "address", "city", "area");
}

/** Older saved prompts told delivery to skip the branch question. Rewrite those lines. */
function rewriteSavedBranchRules(text, branchCount) {
  let out = String(text || "");
  if (branchCount > 1) {
    out = out
      .replace(
        /Delivery: ask "What is your complete delivery address\?" Accept and record the ENTIRE address on the first try\. Do not ask for a city or an area\. Pass branch_name as none\. -> WAIT\.\s*- Pickup: do not ask for a street address\. Follow the Branch ordering section\. If branches are in more than one city, ask the city, stop and wait, then ask the area\. If every branch is in the same city, ask the area only and do not ask the city\. Pass the matching exact branch_name to place_order\. -> WAIT\./,
        `Delivery and pickup both follow the Branch ordering section before anything else. Ask the area, or the city first when branches are in more than one city. Pass that exact branch_name to place_order. For delivery, then ask for the street address and accept it on the first try. For pickup, do not ask for a street address. -> WAIT.`,
      )
      .replace(
        "4. Ask delivery or pickup. Delivery: accept the street address on the first try. Pickup or a table reservation: ask the area from the Branch ordering section. Do not ask the city when every branch is in the same city.",
        "4. Ask delivery or pickup, then ask the area from the Branch ordering section. For delivery, then accept the street address on the first try. For pickup, do not ask for a street address.",
      )
      .replace(
        "Delivery orders do not use this question. Collect the delivery address and pass branch_name as none.",
        "Delivery orders use this question too. Ask the area first, then collect the street address, and pass the chosen branch_name.",
      );
  } else {
    // Zero or one location: strip any leftover "ask the area" instructions.
    out = out
      .replace(
        /Then area from Branch ordering \(one turn\)\. Pass exact English branch_name to place_order\.\s*/gi,
        "Do NOT ask city/area/branch. Pass branch_name per Branch ordering. ",
      )
      .replace(
        /ask the area from the Branch ordering section\.?/gi,
        "follow Branch ordering (do not invent an area).",
      )
      .replace(
        /Ask the area, or the city first when branches are in more than one city\./gi,
        "Do not ask city or area unless Branch ordering explicitly lists multiple areas.",
      )
      .replace(
        /The summary must include the area they chose\./gi,
        "Only include an area in the summary if Branch ordering required choosing one.",
      )
      .replace(
        /ALWAYS pass branch_name to place_order \/ reserve_table\. Never pass none after they choose\./gi,
        "Pass branch_name exactly as Branch ordering says (none when there are no branches).",
      );
  }
  return out;
}

/** Replace or insert the branch list so a saved custom prompt stays current. */
export function applyBranchOrdering(prompt, branches) {
  const list = branches || [];
  const block = branchOrderingSection(list);
  let text = rewriteSavedBranchRules(prompt, list.length);
  // Only match a real markdown heading, never an inline mention like "follow ## Branch ordering".
  const heading = /(^|\n)## Branch ordering\b/;
  const match = heading.exec(text);
  if (match) {
    const start = match.index + (match[1] ? match[1].length : 0);
    const rest = text.slice(start + "## Branch ordering".length);
    const next = rest.search(/\n## /);
    const end = next === -1 ? text.length : start + "## Branch ordering".length + next;
    return `${text.slice(0, start)}${block}${text.slice(end)}`;
  }
  const menuAt = text.search(/\n## Menu\b/);
  if (menuAt !== -1) return `${text.slice(0, menuAt)}\n\n${block}${text.slice(menuAt)}`;
  return `${text.trim()}\n\n${block}`;
}

/**
 * Build menu, sizes, flavors, addons, and coupons knowledge text embedded into Synthflow & ElevenLabs agent prompts.
 */
export function buildRestaurantVoiceKnowledge({
  restaurantName,
  settings,
  categories,
  items,
  deals,
  discounts,
  variants = [],
  addons = [],
  itemAddons = [],
  branches = [],
}) {
  const lines = [];
  lines.push(`# ${restaurantName} — Menu, Flavors, Sizes, Add-ons, and Ordering Guide`);
  lines.push("");
  if (settings) {
    lines.push(`Currency: ${settings.currency || "USD"}`);
    if (settings.address) lines.push(`Restaurant address: ${settings.address}`);
    if (settings.phone) lines.push(`Restaurant phone: ${settings.phone}`);
    lines.push(`Tax rate: ${settings.tax_rate ?? 0}%`);
    lines.push(`Delivery fee: ${settings.delivery_fee ?? 0}`);
    lines.push(`Minimum order: ${settings.min_order_amount ?? 0}`);
    lines.push(`Currently accepting orders: ${settings.is_open === false ? "no" : "yes"}`);
    lines.push("");
  }

  const variantMap = new Map();
  for (const v of variants || []) {
    if (v.is_active === false) continue;
    if (!variantMap.has(v.menu_item_id)) variantMap.set(v.menu_item_id, []);
    variantMap.get(v.menu_item_id).push(v);
  }

  const addonMap = new Map();
  const addonById = new Map((addons || []).map((a) => [a.id, a]));
  for (const link of itemAddons || []) {
    if (!addonMap.has(link.menu_item_id)) addonMap.set(link.menu_item_id, []);
    const ad = addonById.get(link.menu_addon_id);
    if (ad && ad.is_active !== false) addonMap.get(link.menu_item_id).push(ad);
  }

  lines.push("## Menu Categories & Available Items");

  const byCategory = new Map();
  for (const it of (items || []).filter((i) => i.is_available !== false && !/table\s*reserv|book\w*\s+(a\s+)?table/i.test(String(i.name || "")))) {
    const k = it.category_id || "uncategorized";
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k).push(it);
  }

  function renderItem(it) {
    const itemLines = [];
    const tags = (it.dietary_tags || []).filter(Boolean).join(", ");
    const desc = it.description ? ` — ${it.description}` : "";
    const itemVars = variantMap.get(it.id) || [];
    const itemAds = addonMap.get(it.id) || [];

    const rawSizes = itemVars.filter((v) => v.variant_type === "size");
    const seenSizes = new Set();
    const sizes = [];
    for (const s of rawSizes) {
      const key = `${(s.name || "").trim().toLowerCase()}_${(s.measurement || "").trim().toLowerCase()}_${Number(s.price).toFixed(2)}`;
      if (!seenSizes.has(key)) {
        seenSizes.add(key);
        sizes.push(s);
      }
    }

    // Collect all distinct flavor names for this item
    const allFlavorNames = Array.from(
      new Set(itemVars.filter((v) => v.variant_type !== "size").map((f) => f.name.trim()))
    ).filter(Boolean);

    if (sizes.length > 0) {
      itemLines.push(`- **${it.name}**${desc}${tags ? ` [${tags}]` : ""}`);
      itemLines.push(`  * EXACT PRICES BY SIZE (Quote EXACT price for chosen size):`);
      for (const s of sizes) {
        const sizeLabel = s.measurement ? `${s.name} (${s.measurement})` : s.name;
        const sizePrice = `$${Number(s.price).toFixed(2)}`;
        itemLines.push(`    - ${sizeLabel}: ${sizePrice}`);
      }
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS EXCLUSIVE TO ${it.name.toUpperCase()} (ONLY list these flavors when asked about ${it.name}): ${allFlavorNames.join(", ")}`);
      }
    } else {
      itemLines.push(`- **${it.name}** — Price: $${Number(it.price).toFixed(2)}${desc}${tags ? ` [${tags}]` : ""}`);
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS / VARIETIES FOR ${it.name.toUpperCase()}: ${allFlavorNames.join(", ")}`);
      }
    }

    if (itemAds.length > 0) {
      const adList = itemAds
        .map((a) => `${a.name} (+$${Number(a.price).toFixed(2)})`)
        .join(", ");
      itemLines.push(`  * Available Sauces & Add-ons: ${adList}`);
    }

    return itemLines.join("\n");
  }

  for (const cat of categories || []) {
    const list = byCategory.get(cat.id) || [];
    if (!list.length) continue;
    lines.push("");
    lines.push(`### Category: ${cat.name}`);
    if (cat.description) lines.push(cat.description);
    for (const it of list) {
      lines.push(renderItem(it));
    }
  }

  const uncategorized = byCategory.get("uncategorized") || [];
  if (uncategorized.length) {
    lines.push("");
    lines.push("### Other items");
    for (const it of uncategorized) {
      lines.push(renderItem(it));
    }
  }

  if (addons?.length) {
    lines.push("");
    lines.push("## Sauces & Extra Add-ons");
    for (const ad of addons) {
      lines.push(`- ${ad.name}: +$${Number(ad.price).toFixed(2)}${ad.description ? ` (${ad.description})` : ""}`);
    }
  }

  if (deals?.length) {
    lines.push("");
    lines.push("## Active Deals and Promotions");
    for (const d of deals) {
      const orig =
        d.original_price && Number(d.original_price) > Number(d.price)
          ? ` (Original: $${Number(d.original_price).toFixed(2)})`
          : "";
      lines.push(
        `- **${d.name}**: $${Number(d.price).toFixed(2)}${orig}${
          d.description ? ` — Details: ${d.description}` : ""
        }`
      );
    }
  } else {
    lines.push("");
    lines.push("## Active Deals and Promotions");
    lines.push("No active combo deals or special packages currently available.");
  }

  if (discounts?.length) {
    lines.push("");
    lines.push("## Coupon Codes");
    lines.push(
      "Explain these coupons when asked. Only apply a code if the customer provides it and the order meets any minimum."
    );
    for (const c of discounts) {
      const type = String(c.discount_type || "percentage").toLowerCase();
      const value = Number(c.value ?? c.discount_value ?? 0);
      const offer = type === "fixed" ? `$${value.toFixed(2)} off` : `${value}% off`;
      const min = Number(c.min_order_amount || 0);
      lines.push(
        `- Code ${c.code}: ${offer}${c.description ? ` — ${c.description}` : ""}${
          min > 0 ? ` (min order $${min})` : ""
        }`
      );
    }
  } else {
    lines.push("");
    lines.push("## Coupon Codes");
    lines.push("No active coupon codes right now.");
  }

  lines.push("");
  lines.push(branchOrderingSection(branches));
  lines.push("");
  lines.push("## Fast Ordering Protocol");
  lines.push("1. Greet calmly and ask what the caller would like to order.");
  lines.push("2. Capture ordered items, sizes (ONLY if item has sizes in menu), and flavors concisely, and state each item's price as it is ordered. If caller asks for a category (e.g. 'burger') or an unavailable item, list the available items in that category with prices and let them choose.");
  lines.push("3. Collect customer name (accept ANY name on first try, even a single word like 'Akbar' — never ask again or reject it).");
  lines.push("4. Ask delivery or pickup, then follow Branch ordering: ask area/city ONLY if that section lists multiple locations; if it says no branches, do not ask. For delivery, then accept the street address on the first try. For pickup, do not ask for a street address.");
  lines.push("5. Ask for email address for receipt (if provided note it down, if caller skips/declines proceed without assigning any fake email).");
  lines.push("6. Collect contact phone number.");
  lines.push("7. Payment is standard Cash on Delivery (COD) — do NOT interrogate caller to choose payment method.");
  lines.push("8. Complete Order Summary (MANDATORY): Before ending the call, give ONE single complete summary containing: all ordered items (with quantities, sizes, flavors, and item prices), customer name, delivery address, phone number, and total bill amount.");

  return lines.join("\n");
}

export function defaultSynthflowPrompt(restaurantName, knowledge) {
  return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help with food orders, order tracking, and table reservations. Customer may request ANY of these in ANY language. You always reply in the customer's locked language only.

CRITICAL RULES (FOLLOW STRICTLY):

1. MULTI-LANGUAGE LOCK (ABSOLUTE — HIGHEST PRIORITY — ZERO EXCEPTIONS):
   - Supported intents in ANY language: place order, track order, table reservation. Intent never forces English.
   - Turn 1 (you): English greeting only — "Hi, I am calling from ${restaurantName}. How may I help you?"
   - Turn 2 (caller): LISTEN to their first reply. ANALYZE language. LOCK that language for the WHOLE call.
   - After lock: you and the customer stay in THAT language only. Not one word, not one sentence, not one phrase in any other language — including wait phrases, confirmations, prices wrappers, tool results, order numbers, track questions, reservation questions, and goodbye.
   - Detect from first reply (examples, not limits):
     * English: "I want to place an order", "track my order", "reserve a table"
     * Hindi/Urdu/Hinglish (speak back in Roman Latin letters): "mujhe order karna hai", "order track karna hai", "table book karni hai", Devanagari/Urdu script
     * Spanish / French / Arabic / Punjabi / other: lock that language and continue only in it
   - ENGLISH locked → entire call English only. Forbidden: Aapka, order place kar dun, Ek second, Theek hai, Shukriya, Aur kuch, Delivery ya pickup, any Roman Hindi/Urdu.
   - HINDI/URDU/HINGLISH locked → entire call Roman Hindi/Urdu only. Forbidden English lines: Shall I place this order?, One moment., Your order number is, You're welcome., What is your order number?, May I have your full name?, Anything else?, Email address?, Phone number?
     Use Roman instead: Aur kuch chahiye? | Aapka naam? | Delivery ya pickup? | Aapka order number kya hai? | Ek second. | Order place kar dun? | Aapka order number [n] hai. Save kar lijiye.
   - OTHER languages locked → invent natural short phrases in THAT language only; never fall back to English or Hindi mid-call.
   - Phrases marked "EN locked" vs "Roman locked" below are ALTERNATES. Use ONLY the set matching the lock. Never both. Never the other set.
   - Tools often return English — ALWAYS translate into the locked language before speaking. Never read English tool text if lock is not English.
   - Never ask the caller to switch language. Never switch because the task changed (order ↔ track ↔ reservation).

2. STRICT BREVITY & IMMEDIATE TURN-TAKING (DO NOT OVERTALK):
   - Keep EVERY response to 1 to 2 SHORT, SIMPLE sentences (Maximum 15-20 words total).
   - Ask only ONE question or detail per turn. NEVER ask name and phone in the same turn.
   - Once you ask a question or state a price, IMMEDIATELY STOP SPEAKING AND WAIT in silence for the customer's answer.
   - NEVER give long speeches, unsolicited menu lists, or ask multiple questions at once.
   - When the customer starts speaking, STOP speaking immediately and listen.
   - NEVER say goodbye / alvida / "khatam" while an order is still in progress.
   - If "anything else?" is unclear: clarify ONCE in the locked language only (EN locked → "Just this order, or something else?" | Roman locked → "Sirf yeh order, ya aur item?"). Do NOT hang up.

3. STRICT ITEM AVAILABILITY, GENERIC INQUIRIES & FLAVOR BOUNDARIES:
   - GENERIC CATEGORY INQUIRIES (e.g. "I want a burger" / "burger chahiye" / "konsi biryani hai" / "pizza chahiye"):
     * When caller asks generally for a category without naming an exact item, IMMEDIATELY list the available items in that category directly from Menu Categories & Available Items below with their exact prices.
     * Roman locked example: "Burgers mein hamare paas The OG Beef ($4.44) aur Oklahoma Beef ($5.15) hain. Aap konsa lena chahenge?"
     * EN locked example: "For burgers, we have The OG Beef for $4.44 and Oklahoma Beef for $5.15. Which one would you prefer?"
     * STOP and WAIT for their choice.
   - UNAVAILABLE ITEM INQUIRIES (e.g. caller asks for "Chicken Burger", but menu only has "The OG Beef" and "Oklahoma Beef"):
     * NEVER accept, invent, or hallucinate items not present in the Menu Knowledge below!
     * NEVER ask "Small ya medium?" for an item that is not in the menu!
     * State that the requested item is not on the menu, and immediately list the available alternatives in that category:
       * Roman locked: "[Item] available nahi hai. Burgers mein hamare paas The OG Beef ($4.44) aur Oklahoma Beef ($5.15) hain. Aap konsa lena chahenge?"
       * EN locked: "[Item] is not on the menu. For burgers, we have The OG Beef ($4.44) and Oklahoma Beef ($5.15). Which one would you like?"
     * STOP and WAIT for their choice.
   - SPECIFIC ITEM FLAVORS (NEVER MIX FLAVORS):
     * When the caller asks about flavors for a specific item (e.g. "Signature Pizza ke flavors", "Classic Pizza ke flavors"), you MUST list ONLY the flavors belonging to THAT EXACT ITEM.
     * NEVER mention or recite flavors from another pizza or item.
     * For Signature Pizzas: ONLY list Signature flavors (Chicken Supreme, Spicy Chicken Ranch, Peri Peri Chicken, Malai Boti, Super Supreme, Dynamite Chicken, Jalapeno Pepperoni, Deluxe Pepperoni).
     * For Classic Pizzas: ONLY list Classic flavors (Super Sicilian, Classic Chicken Ranch, Chicken Tikka, Cheese Lover, Classic Pepperoni, Chicken Fajita, Very Veggie).
     * If caller asks generally about pizza flavors, answer in the LOCKED language only: Classic like Fajita/Tikka and Signature like Malai Boti/Peri Peri — which do they want?

4. ACCURATE PRICING & STRICT SIZING RULES (DO NOT INVENT SIZES):
   - ONLY ASK FOR SIZE IF THE ITEM HAS MULTIPLE SIZES LISTED UNDER IT IN MENU KNOWLEDGE (e.g. Pizzas with Small, Medium, Large, Family):
     * Look up the exact size row under the item in the Menu and quote that exact price. NEVER quote small price for Medium or Large!
   - ITEMS WITHOUT SIZES (e.g. Burgers, Sandwiches, Fries, Drinks, Desserts with a single fixed price):
     * NEVER ask "Small ya medium?" or invent sizes for items with a single fixed price! Burgers do NOT have small/medium.
     * Quote the item's single listed price directly (e.g. "The OG Beef is $4.44" / "The OG Beef four point four four dollar hai") and proceed.

5. ONE-BY-ONE DETAIL COLLECTION & 1-TURN ADDRESS ACCEPTANCE:
   - Collect details in this exact order, ONE question per turn, ALWAYS in the locked language only:
     1. Items, Size (ONLY if item has sizes) & Flavor -> state exact price -> ask anything else? (EN locked: "Anything else?" | Roman locked: "Aur kuch chahiye?") -> WAIT.
        - If generic category or unavailable item: list available items first as per Rule 3.
        - If unclear yes/no: clarify once, then continue. Never end the call here.
     2. Name ONLY (EN locked: "May I have your name?" | Roman locked: "Aapka naam?") -> WAIT.
        - ACCEPT ANY NAME ON THE FIRST TRY: If caller gives ANY name (even a single name like "Akbar", "Salim", "Ali", "Zain", "John"), ACCEPT IT IMMEDIATELY on the very first try!
        - STRICTLY FORBIDDEN: NEVER repeatedly ask "Poora naam bataiye please" or demand a last name/surname! Once any name is spoken, accept it ("Theek hai" / "Thank you") and proceed immediately to step 3.
     3. Delivery or pickup ONLY -> WAIT.
        - Then follow the Branch ordering section EXACTLY:
          * If it says NO branches / one location: do NOT ask city, area, branch, or location at all.
          * If it lists multiple areas: ask area once (city first only when multi-city).
        - Pickup: no street address. Delivery: street address once (after any required branch/area step).
        - Pass branch_name exactly as that section says (none when no branches).
     4. Email ONLY -> if skip/decline, acknowledge in locked language and continue. No fake email.
     5. Phone ONLY -> ask only if not already given.
        - If they say same / this / calling / dial / yahi / yehi / isi / "yahi number use karo" → do NOT ask again. Pass customer_phone as "same" to place_order (caller ID is used automatically).
        - Only ask for digits if they never gave a number and did not say same-number.
   - After details: MUST do step 7 summary before place_order. Never place silently.
   - Payment is COD — do NOT ask how they will pay.

6. BRANCH FOR DELIVERY, PICKUP, AND TABLE RESERVATIONS:
   - The Branch ordering section OVERRIDES this section. Read it every time before asking location questions.
   - If that section says no branches: NEVER ask city/area/branch; pass branch_name as none; continue the flow.
   - If that section lists one location only: do not ask; pass that branch_name.
   - Only when that section lists multiple areas: ask area (and city first if multi-city), in the locked language.
   - Delivery with branches: area first (if required), then street address. Pickup: area only if required; never street address.
   - STT tips (only when branches exist): "party town" / "johar" / "johur" = Johar Town. "iqbal" = Iqbal Town. "kashmir" = Kashmir Road.
   - Never invent a branch or area. Do not ask location when they only want to track an order.
   - If place_order returns branch_required and that section has areas: ask once, then retry. If no branches listed, pass none and continue.

7. CONFIRM THE ORDER, THEN SAY THE ORDER NUMBER:
   - REQUIRED before place_order: one short summary ONLY in the LOCKED language — items + size/flavor, name, pickup/delivery, phone, TOTAL (include area ONLY if they had to choose one). Then ask to confirm in THAT same language only.
   - If ENGLISH locked: confirm "Shall I place this order?" | wait "One moment." | success "Your order number is [order_number]. Please save it."
   - If HINDI/URDU locked: confirm "Order place kar dun?" | wait "Ek second." | success "Aapka order number [order_number] hai. Save kar lijiye." — NEVER say Shall I / One moment / Your order number / You're welcome.
   - STOP and WAIT for a clear yes, then call place_order ONCE with branch_name from Branch ordering. If they said same-number, pass customer_phone "same".
   - NEVER invent an order number. If place_order returns phone_required, ask digits once in the locked language, then retry — do not switch language.
   - After the number, ask if they need anything else; only then goodbye — still in the locked language.

8. DEALS, PROMOTIONS & OFFERS (ACCURATE DESCRIPTION & CHOICES):
   - ONLY quote deals or discount codes if they are explicitly listed in the "Active Deals and Promotions" or "Coupon Codes" section below.
   - When explaining any deal to the customer, state its name, exact price, and faithfully explain its description (including what items are included, any special discounts like student off, or choices offered).
   - If the deal description offers a choice (for example: "Choice of 1 Zinger Burger OR 1 Zinger Shawarma"):
     * Explain the choices clearly to the caller in their language.
     * If the caller orders the deal without specifying their choice, ask which option they prefer.
     * Once selected, confirm the choice and deal price immediately.
   - If no deals or coupons are active, say so in their language and offer the regular menu.
   - NEVER invent or hallucinate fake deals, combos, or discounts!

9. TABLE RESERVATIONS:
   - Caller may request a table in ANY language; every question/confirm stays in the LOCKED language only.
   - A table reservation is NOT food, has NO price, and must use reserve_table — NEVER place_order.
   - NEVER say "order", "bill", or "order number" while booking a table.
   - Flow (one question per turn, locked language):
     1. Follow Branch ordering: if no branches, do NOT ask area/city; pass branch_name "none". If multiple areas, ask once.
     2. Full name -> WAIT.
     3. Party size (guests) -> WAIT.
     4. Date (today / tomorrow / YYYY-MM-DD) -> WAIT.
     5. Time once ("7", "7 PM", "seven" = 19:00) -> WAIT. slot_duration_hours is always 1 (never ask duration).
     6. Phone: if they say same/dial/yahi number, pass customer_phone "same". Else ask once for digits.
     7. Confirm briefly in locked language, then call reserve_table ONCE.
   - If slot full: ask a new time once and retry. If tool succeeds: confirm table in locked language only.
   - Do NOT refuse to book just because they ordered food before. Always try reserve_table when they want a table.

10. TRACK AN EXISTING ORDER (STRICT — ALWAYS ASK ORDER NUMBER FIRST):
   - Caller may request tracking in ANY language (English, Hindi/Urdu, Spanish, etc.). That does NOT change the language lock.
   - If they want to check / track / follow / status of an order:
     1. FIRST ask for the order number ONLY in the LOCKED language (EN locked: "What is your order number?" | Roman locked: "Aapka order number kya hai?" | other: same question in that language).
     2. STOP and WAIT. Do NOT call any tool yet. Do NOT guess status. Do NOT use check_previous_order for tracking.
     3. Only after they say a number, build ORD-YYMMDD-NN, then call get_order_status ONCE.
     4. If found: one status sentence in the LOCKED language only.
     5. If missing/not found: ask ONCE more in the LOCKED language, one retry, then stop looping.
   - NEVER tell kitchen/status before hearing an order number on this call.
   - Do not start a new food order when they only want status.

11. RETURNING CALLER — REPEAT ORDER (SAME PHONE):
   - When the caller wants FOOD (not tracking, not table), silently call check_previous_order.
   - If they want a TABLE, skip to section 9 and use reserve_table — do not block booking.
   - If they only want to track an order, skip this section and follow section 10 instead.
   - If has_previous_order:
     1. Tell them the previous items in the LOCKED language and ask: do you want to repeat this order?
     2. If NO → take a new order normally (section 5).
     3. If YES → do NOT re-ask name, phone, branch, or address from scratch.
        - Tell them the saved details in the LOCKED language: name, phone, delivery or pickup (and address if delivery; branch/area only if Branch ordering uses branches).
        - Ask ONCE: do you want to change any of these?
        - If they say no / nothing to change → keep all saved fields, give section 7 summary, place_order with previous_branch_name (or none if no branches).
        - If they change only one thing → update that field only, keep the rest, then summary + place_order. Never switch language.
   - If neither found → new order normally.

FINAL LANGUAGE REMINDER (READ BEFORE EVERY REPLY):
Locked language was set from the caller's first reply. Your next sentence must be 100% that language. Zero words from any other language. Order / track / table does not change this.

${knowledge}`;
}

export function defaultSynthflowGreeting(restaurantName) {
  return `Hi, I am calling from ${restaurantName}. How may I help you?`;
}

/** Load restaurant catalog used for voice prompt sync. */
export async function loadRestaurantVoiceCatalog(knex, restaurantId) {
  const [settings, categories, items, deals, discounts, variants, addons, itemAddons] = await Promise.all([
    knex("restaurant_settings").where({ restaurant_id: restaurantId }).first(),
    knex("menu_categories").where({ restaurant_id: restaurantId }).orderBy("sort_order", "asc"),
    knex("menu_items").where({ restaurant_id: restaurantId }).orderBy("sort_order", "asc"),
    knex("deals").where({ restaurant_id: restaurantId, is_active: true }),
    knex("discounts")
      .where({ restaurant_id: restaurantId, is_active: true })
      .andWhere((qb) => {
        qb.whereNull("valid_to").orWhere("valid_to", ">", knex.fn.now());
      })
      .andWhere((qb) => {
        qb.whereNull("ends_at").orWhere("ends_at", ">", knex.fn.now());
      }),
    knex("menu_item_variants")
      .whereIn("menu_item_id", knex("menu_items").select("id").where({ restaurant_id: restaurantId }))
      .andWhere({ is_active: true })
      .orderBy("sort_order", "asc"),
    knex("menu_addons").where({ restaurant_id: restaurantId, is_active: true }).orderBy("sort_order", "asc"),
    knex("menu_item_addons").whereIn("menu_item_id", knex("menu_items").select("id").where({ restaurant_id: restaurantId })),
  ]);
  const branches = await loadActiveChildBranches(knex, restaurantId);
  return { settings, categories, items, deals, discounts, variants, addons, itemAddons, branches };
}
