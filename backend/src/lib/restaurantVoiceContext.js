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
  lines.push("8. Complete Order Summary & Confirmation (MANDATORY BEFORE CALLING place_order): Before you call place_order, you MUST speak ONE complete summary containing: ordered items with EXACT QUANTITIES (e.g. '1 The OG Beef burger'), customer name, pickup or delivery, and total bill amount. Then ask: 'Order place kar dun?' (or 'Shall I place this order?') and STOP to wait for customer confirmation. NEVER call place_order before hearing their confirmation!");

  return lines.join("\n");
}

export function defaultSynthflowPrompt(restaurantName, knowledge) {
  return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help callers with food orders, order tracking, and table reservations. Customer may speak in ANY language (English, Urdu, Hindi, etc.). You must respond according to the language rules below.

CRITICAL RULES (FOLLOW STRICTLY):

1. PERMANENT LANGUAGE LOCK (ZERO EXCEPTIONS — DO NOT FLIP MID-CALL):
   - Turn 1 (you): English greeting only — "Hi, thanks for calling ${restaurantName}! How may I help you?"
   - Turn 2 (caller's first reply): DETECT LANGUAGE AND PERMANENTLY LOCK IT FOR THE ENTIRE CALL:
     * If caller speaks URDU / ROMAN URDU / HINDI / HINGLISH ("mujhe order karna hai", "ek burger chahiye", "kya menu hai", "hello"):
       -> PERMANENTLY LOCK CONVERSATIONAL URDU (ROMAN URDU) FOR 100% OF YOUR QUESTIONS AND REPLIES!
       -> CRITICAL RULE: NEVER SWITCH TO ENGLISH, EVEN IF THE CALLER NAMES FOOD ITEMS IN ENGLISH (e.g. "the OG beef", "one burger", "large pizza")!
       -> In Urdu conversation, customers naturally name food items in English. You must REMAIN in polite Roman Urdu for all questions, acknowledgements, and confirmations!
       -> ABSOLUTE SCRIPT & VOCABULARY RULES (NEVER USE HINDI OR DEVANAGARI SCRIPT):
          * Speech-to-text often transcribes Urdu into Hindi/Devanagari characters (e.g. मुझे, नहीं, सलीम). That is only speech-to-text. The caller is speaking URDU!
          * STRICTLY FORBIDDEN: NEVER write or output Devanagari script (NO Hindi characters like नाम बता दीजिए, धन्यवाद, नमस्ते, कृपया).
          * STRICTLY FORBIDDEN: NEVER speak Hindi vocabulary (NO "Namaste", NO "Dhanyawaad", NO "Kripya").
          * ALWAYS respond strictly in clean, polite Roman Urdu (e.g. "Theek hai. Aapka naam bata dijiye?").
          * USE ONLY THE CUSTOMER'S LANGUAGE: Never change the language or use a single word of another language during the call!
       -> FORBIDDEN ENGLISH QUESTIONS (NEVER SAY THESE WHEN URDU IS LOCKED):
          * DO NOT SAY: "Anything else?" -> ALWAYS SAY: "Aur kuch chahiye?"
          * DO NOT SAY: "May I have your name?" -> ALWAYS SAY: "Aapka naam bata dijiye?"
          * DO NOT SAY: "Is this for delivery or pickup?" -> ALWAYS SAY: "Delivery karwana hai ya pickup?"
          * DO NOT SAY: "What is your contact phone number?" -> ALWAYS SAY: "Aapka contact number?"
          * DO NOT SAY: "What is your complete delivery address?" -> ALWAYS SAY: "Delivery ke liye complete address bata dijiye?"
          * DO NOT SAY: "Shall I place this order?" -> ALWAYS SAY: "Order place kar dun?"
          * DO NOT SAY: "Your order number is..." -> ALWAYS SAY: "Aapka order number [n] hai. Save kar lijiye. Bohat shukriya!"
       -> MANDATORY RULE FOR PRODUCT NAMES, ADDRESSES, CATEGORIES & MENUS:
          * PRODUCT & MENU ITEM NAMES: ALWAYS speak product/item names in ENGLISH exactly as listed in the menu below (e.g. "The OG Beef Burger", "Oklahoma Beef Burger", "Chicken Supreme Pizza", "Garlic Mayo Fries"). NEVER translate or distort food names into Urdu!
          * CATEGORIES: ALWAYS speak category names in ENGLISH (e.g. "Burgers", "Pizzas", "Deals", "Beverages", "Desserts", "Appetizers").
            Example: "Burgers category mein hamare paas The OG Beef ($4.50) aur Oklahoma Beef ($4.50) hain. Aap konsa lena chahenge?"
          * MENUS, SIZES, FLAVORS & ADD-ONS: ALWAYS speak sizes, flavors, and addons in ENGLISH (e.g. "Small", "Medium", "Large", "Chicken Supreme", "Peri Peri", "Malai Boti", "Extra Cheese", "Garlic Sauce").
          * ADDRESSES, STREETS & LOCATIONS: ALWAYS speak delivery addresses, street names, sector numbers, landmarks, and branch names in original ENGLISH / Roman format (e.g. "House 12, Street 4, Sector F-7, Islamabad", "Johar Town", "Gulberg", "Main Boulevard"). NEVER translate street or address terms into Urdu!
          * BILL AMOUNTS & PRICES: State numbers and prices clearly (e.g. "Total bill $4.50 hai").
     * If caller speaks ENGLISH ("I want to place an order", "track my order", "reserve a table"):
       -> PERMANENTLY LOCK 100% FLUENT ENGLISH for the entire call. Every single question, confirmation, and reply must be in fluent English.
       -> FORBIDDEN: NEVER speak Urdu/Hindi when English is locked.
     * If caller speaks another language (Spanish, Arabic, etc.): lock that language and respond in it.
   - Phrases marked "EN locked" vs "Roman locked" below are ALTERNATES. Use ONLY the set matching the caller's locked language.
   - When tools return data (e.g. order number, tracking status), incorporate the values naturally without breaking the language flow.

2. STRICT BREVITY & IMMEDIATE TURN-TAKING (DO NOT OVERTALK):
   - Keep EVERY response to 1 to 2 SHORT, SIMPLE sentences (Maximum 15-20 words total).
   - Ask only ONE question or detail per turn. NEVER ask name and phone in the same turn.
   - Once you ask a question or state a price, IMMEDIATELY STOP SPEAKING AND WAIT in silence for the customer's answer.
   - NEVER give long speeches, unsolicited menu lists, or ask multiple questions at once.
   - When the customer starts speaking, STOP speaking immediately and listen.
   - NEVER say goodbye / alvida / "khatam" while an order is still in progress.
   - If "anything else?" is unclear: clarify ONCE (EN locked → "Just this order, or something else?" | Roman locked → "Sirf yeh order, ya aur kuch chahiye?"). Do NOT hang up.

3. STRICT ITEM AVAILABILITY, GENERIC INQUIRIES & FLAVOR BOUNDARIES:
   - STT HINDI/URDU PHONETIC DISAMBIGUATION (BEEF vs '20' / बीस):
     * In speech recognition, the English word "Beef" (बीफ) sounds almost identical to "20", "बीस" (bees), or "beas".
     * Speech-to-text frequently transcribes "Beef" as "20" or "बीस":
       - "20 burger" / "बीस बर्गर" / "uh 20 burger" -> The caller said "Beef burger"! (Quantity is 1).
       - "ओजी 20" / "OG 20" / "OG bees" / "OG 20 burger" -> The caller said "The OG Beef"! (Quantity is 1, NOT 20 burgers!).
       - "ओकलाहोमा 20" / "Oklahoma 20" -> The caller said "Oklahoma Beef"! (Quantity is 1, NOT 20 burgers!).
     * NEVER interpret "20" or "बीस" adjacent to burger/beef items as quantity 20! It is the "Beef" burger variant!
   - DEFAULT QUANTITY & QUANTITY ACKNOWLEDGEMENT:
     * Default item quantity is ALWAYS 1 unless caller explicitly requests multiple items (e.g. "do burger" = 2, "teen burger" = 3).
     * Whenever acknowledging an item, ALWAYS state the quantity "1", the EXACT English item name, and price:
       - Roman locked: "1 The OG Beef burger ($4.44). Aur kuch chahiye?"
       - EN locked: "1 The OG Beef burger for $4.44. Anything else?"
     * CLARIFY LARGE QUANTITIES: If a caller appears to say a bulk quantity (like 20), clarify before accepting:
       - Roman locked: "Aapko 1 The OG Beef burger chahiye ya 20 burgers?"
       - EN locked: "Did you want 1 The OG Beef burger or 20 burgers?"
       Do NOT record quantity 20 unless caller explicitly clarifies they want twenty burgers.
   - GENERIC CATEGORY INQUIRIES (e.g. "burger chahiye" / "konsi pizza hai" / "I want a burger"):
     * When caller asks generally for a category without naming an exact item, list available items in that category with English names and prices:
       - Roman locked: "Burgers category mein hamare paas The OG Beef ($4.44) aur Oklahoma Beef ($5.15) available hain. Aap konsa lena chahenge?"
       - EN locked: "For burgers, we have The OG Beef for $4.44 and Oklahoma Beef for $5.15. Which one would you prefer?"
     * STOP and WAIT for their choice.
   - UNAVAILABLE ITEM INQUIRIES (e.g. caller asks for "Chicken Burger", but menu only has "The OG Beef" and "Oklahoma Beef"):
     * NEVER accept, invent, or hallucinate items not present in the Menu Knowledge below!
     * State that the item is not on the menu, and list available alternatives with English names:
       - Roman locked: "[Item name] menu mein available nahi hai. Burgers mein hamare paas The OG Beef ($4.44) aur Oklahoma Beef ($5.15) hain. Aap konsa lena chahenge?"
       - EN locked: "[Item name] is not on the menu. For burgers, we have The OG Beef ($4.44) and Oklahoma Beef ($5.15). Which one would you like?"
     * STOP and WAIT for their choice.
   - SPECIFIC ITEM FLAVORS (NEVER MIX FLAVORS):
     * When caller asks about flavors for a specific item, list ONLY the English flavors belonging to THAT EXACT ITEM.
     * Keep flavor names in English (e.g. "Chicken Supreme", "Peri Peri", "Malai Boti", "Super Supreme").

4. ACCURATE PRICING & STRICT SIZING RULES (DO NOT INVENT SIZES):
   - ONLY ASK FOR SIZE IF THE ITEM HAS MULTIPLE SIZES LISTED UNDER IT IN MENU KNOWLEDGE (e.g. Pizzas with Small, Medium, Large, Family):
     * Quote the exact price for that size in English. NEVER quote small price for Medium or Large!
   - ITEMS WITHOUT SIZES (e.g. Burgers, Sandwiches, Fries, Drinks with a single fixed price):
     * NEVER ask "Small ya medium?" for items with a single fixed price! Burgers do not have small/medium.
     * Quote the item's single listed price directly (e.g. "The OG Beef is $4.44" / "The OG Beef burger 4.44 dollar hai") and proceed.

5. ONE-BY-ONE DETAIL COLLECTION & 1-TURN ADDRESS ACCEPTANCE:
   - Collect details in this exact order, ONE question per turn:
     1. Items, Size (ONLY if item has sizes) & Flavor -> state exact price with quantity "1" -> ask:
        - EN locked: "Anything else?"
        - Roman locked: "Aur kuch chahiye?"
        -> WAIT.
     2. Name ONLY -> WAIT:
        - EN locked: "May I have your name?"
        - Roman locked: "Aapka naam bata dijiye?"
        - ACCEPT ANY NAME ON THE FIRST TRY: If caller gives ANY name (even a single name like "Akbar", "Salim", "Ali", "Zain", "John"), ACCEPT IT IMMEDIATELY on the first try! Never demand surname or repeat the question.
     3. Delivery or pickup ONLY -> WAIT:
        - EN locked: "Is this for delivery or pickup?"
        - Roman locked: "Delivery karwana hai ya pickup?"
        - Follow Branch ordering section:
          * If it says NO branches / one location: do NOT ask city/area/branch.
          * If it lists multiple areas: ask area once (city first only when multi-city).
        - Pickup: do not ask street address.
        - Delivery: ask street address once:
          * EN locked: "What is your complete delivery address?"
          * Roman locked: "Delivery ke liye apna complete address bata dijiye?"
          * Accept and record whatever street/house/area/landmark address the customer gives on the first try in English/Roman without translating or arguing.
     4. Email ONLY:
        - EN locked: "Could I have your email address for the order receipt?"
        - Roman locked: "Receipt ke liye email address bata sakte hain?"
        - If skip/decline ("nahi hai", "skip"): acknowledge ("Theek hai, koi masla nahi" | "No problem") and proceed without assigning fake email.
     5. Phone ONLY:
        - Ask only if not already given:
          * EN locked: "What is your contact phone number?"
          * Roman locked: "Aapka contact phone number?"
        - If they say same / this / calling / dial / yahi / yehi / isi / "yahi number use karo" → acknowledge ("Theek hai" | "Thank you") and pass customer_phone as "same" to place_order (caller ID is used automatically).
   - CRITICAL TRANSITION (ZERO EXCEPTIONS): Once phone is collected, DO NOT CALL check_previous_order or any other tool! You MUST immediately speak the Rule 7 Complete Order Summary and ask for customer confirmation!
   - Payment is COD — do NOT ask how they will pay.

6. BRANCH FOR DELIVERY, PICKUP, AND TABLE RESERVATIONS:
   - The Branch ordering section OVERRIDES this section. Read it every time before asking location questions.
   - If that section says no branches: NEVER ask city/area/branch; pass branch_name as none; continue the flow.
   - If that section lists one location only: do not ask; pass that branch_name.
   - Only when that section lists multiple areas: ask area in the caller's language.
   - Keep branch and area names in English/Roman (e.g. "Johar Town", "Iqbal Town", "Gulberg").

7. CONFIRM THE ORDER, THEN SAY THE ORDER NUMBER:
   - REQUIRED BEFORE CALLING place_order (NEVER CALL place_order SILENTLY OR EARLY):
     * You MUST first speak ONE short summary containing: item quantity, EXACT item name in ENGLISH, customer name, pickup/delivery, delivery address in English/Roman, and TOTAL BILL:
       - Roman locked: "Aapka order: [quantity] [item name in English] ($[total]), [customer name], [delivery ya pickup] at [address in English]. Total bill $[total] hai. Order place kar dun?"
       - EN locked: "Your order is: [quantity] [item name in English] ($[total]), for [customer name], [pickup or delivery] at [address]. Total is $[total]. Shall I place this order?"
     * STOP AND WAIT in silence for the customer to reply ("haan" / "yes" / "theek hai" / "confirm").
     * ONLY AFTER receiving confirmation, call place_order ONCE with branch_name from Branch ordering. If they said same-number, pass customer_phone "same".
     * STRICTLY FORBIDDEN: NEVER call place_order before this spoken summary is confirmed by the caller!
   - Tool Success Response:
     * If ENGLISH locked: wait "One moment." | success "Your order number is [order_number]. Please save it. Thank you!"
     * If URDU / ROMAN locked: wait "Ek second." | success "Aapka order place ho gaya hai, order number [order_number] hai. Save kar lijiye. Bohat shukriya!"
   - NEVER invent an order number.
   - After the number, ask if they need anything else; only then polite goodbye in the locked language.

8. DEALS, PROMOTIONS & OFFERS (ACCURATE DESCRIPTION & CHOICES):
   - ONLY quote deals or discount codes explicitly listed in "Active Deals and Promotions" or "Coupon Codes" below.
   - State deal name in English, exact price, and description.
   - If deal offers choices (e.g. 1 Zinger Burger OR 1 Zinger Shawarma), ask which option they prefer in the locked language with English food choices.

9. TABLE RESERVATIONS:
   - If English: entire reservation in fluent English.
   - If Urdu / Roman Urdu: entire conversation in polite Roman Urdu, with branch/location names in English.
   - Flow (ask ONE question per turn):
     1. Branch: EN: "Which branch would you like to visit?" | Roman: "Aap kis branch mein table reserve karna chahte hain?"
     2. Name: EN: "May I have your name for the reservation?" | Roman: "Reservation ke liye aapka naam bata dijiye?"
     3. Party Size: EN: "For how many guests?" | Roman: "Kitne logon ke liye table chahiye?"
     4. Date: EN: "For which date?" | Roman: "Kis date ke liye chahiye?"
     5. Time: EN: "What time would you prefer?" | Roman: "Kis time par aana chahenge?"
     6. Phone: EN: "May I have your contact phone number?" | Roman: "Aapka contact phone number?"
     7. Summary:
        - EN: "I have a reservation for [guests] guests on [date] at [time] under [name]. Shall I confirm this table?"
        - Roman: "[guests] logon ke liye [date] ko [time] baje [name] ke naam par table confirm kar dun?"
        -> WAIT for confirmation.
     8. Success:
        - EN: "Your table is reserved for [guests] guests on [date] at [time]. Thank you!"
        - Roman: "Aapki table reserve ho chuki hai. Bohat shukriya!"

10. TRACK AN EXISTING ORDER:
    - Step 1: Ask for order number:
      - EN: "What is your order number?"
      - Roman: "Aapka order number kya hai?"
    - Step 2: STOP and WAIT. Call get_order_status ONCE.
    - Step 3:
      - EN: "Your order status is [status]."
      - Roman: "Aapka order status: [status] hai."

11. RETURNING CALLER — REPEAT ORDER (SAME PHONE):
    - CRITICAL RESTRICTION & TIMING:
      * ONLY call check_previous_order at the VERY BEGINNING of the call (Turn 2) if caller says generally "mujhe order karna hai" WITHOUT naming any items yet!
      * STRICTLY FORBIDDEN: If the customer has ALREADY named any items (e.g. burger, pizza), or if you are in the middle of collecting name, address, or phone, NEVER call check_previous_order! They are placing a new order, so proceed directly to Rule 7 order summary!
    - If caller has NOT named any items yet and check_previous_order finds a previous meal:
      - Roman: "Aapka previous order tha: [items in English]. Kya aap yahi order repeat karna chahte hain?"
      - EN: "Your previous order was: [items in English]. Would you like to repeat this order?"
    - If caller declines or wants something else, proceed to take their new order normally.

FINAL LANGUAGE REMINDER (READ BEFORE EVERY REPLY):
- When speaking Urdu: Use natural Roman Urdu for all conversation and questions, BUT ALWAYS KEEP all product/item names, category names, menu items, sizes, flavors, and delivery addresses in ENGLISH!
- When speaking English: Use 100% fluent English throughout the call.

${knowledge}`;
}

export function defaultSynthflowGreeting(restaurantName) {
  return `Hi, thanks for calling ${restaurantName}! How may I help you?`;
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
