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

export function getCurrencyDetails(rawCurrency = "USD") {
  const code = String(rawCurrency || "USD").trim().toUpperCase();
  const map = {
    PKR: { code: "PKR", symbol: "Rs", urduUnit: "rupay", urduUnitSingular: "rupiya", englishUnit: "rupees", exampleUrdu: "500 rupay" },
    USD: { code: "USD", symbol: "$", urduUnit: "dollar", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "4 dollar 50 cent" },
    EUR: { code: "EUR", symbol: "€", urduUnit: "euro", urduUnitSingular: "euro", englishUnit: "euros", exampleUrdu: "10 euro" },
    GBP: { code: "GBP", symbol: "£", urduUnit: "pound", urduUnitSingular: "pound", englishUnit: "pounds", exampleUrdu: "10 pound" },
    AED: { code: "AED", symbol: "AED", urduUnit: "dirham", urduUnitSingular: "dirham", englishUnit: "dirhams", exampleUrdu: "25 dirham" },
    SAR: { code: "SAR", symbol: "SAR", urduUnit: "riyal", urduUnitSingular: "riyal", englishUnit: "riyals", exampleUrdu: "30 riyal" },
    CAD: { code: "CAD", symbol: "C$", urduUnit: "dollar", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "15 dollar" },
    AUD: { code: "AUD", symbol: "A$", urduUnit: "dollar", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "15 dollar" },
    INR: { code: "INR", symbol: "₹", urduUnit: "rupay", urduUnitSingular: "rupiya", englishUnit: "rupees", exampleUrdu: "250 rupay" },
    KWD: { code: "KWD", symbol: "KWD", urduUnit: "dinar", urduUnitSingular: "dinar", englishUnit: "dinars", exampleUrdu: "5 dinar" },
    QAR: { code: "QAR", symbol: "QAR", urduUnit: "riyal", urduUnitSingular: "riyal", englishUnit: "riyals", exampleUrdu: "20 riyal" },
    OMR: { code: "OMR", symbol: "OMR", urduUnit: "rial", urduUnitSingular: "rial", englishUnit: "rials", exampleUrdu: "5 rial" },
    BHD: { code: "BHD", symbol: "BHD", urduUnit: "dinar", urduUnitSingular: "dinar", englishUnit: "dinars", exampleUrdu: "5 dinar" },
  };
  return (
    map[code] || {
      code,
      symbol: code,
      urduUnit: code.toLowerCase(),
      urduUnitSingular: code.toLowerCase(),
      englishUnit: code.toLowerCase(),
      exampleUrdu: `100 ${code.toLowerCase()}`,
    }
  );
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
  const currency = settings?.currency || "USD";
  const currInfo = getCurrencyDetails(currency);

  function fmtPrice(amount) {
    const num = Number(amount || 0);
    const val = num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    if (["$", "€", "£", "₹", "C$", "A$"].includes(currInfo.symbol)) {
      return `${currInfo.symbol}${val}`;
    }
    return `${currInfo.symbol} ${val}`;
  }

  const lines = [];
  lines.push(`# ${restaurantName} — Menu, Flavors, Sizes, Add-ons, and Ordering Guide`);
  lines.push("");
  if (settings) {
    lines.push(`Currency: ${currInfo.code} (${currInfo.englishUnit} / Urdu: ${currInfo.urduUnit})`);
    if (settings.address) lines.push(`Restaurant address: ${settings.address}`);
    if (settings.phone) lines.push(`Restaurant phone: ${settings.phone}`);
    lines.push(`Tax rate: ${settings.tax_rate ?? 0}%`);
    lines.push(`Delivery fee: ${fmtPrice(settings.delivery_fee ?? 0)}`);
    lines.push(`Minimum order: ${fmtPrice(settings.min_order_amount ?? 0)}`);
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
        const sizePrice = fmtPrice(s.price);
        itemLines.push(`    - ${sizeLabel}: ${sizePrice}`);
      }
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS EXCLUSIVE TO ${it.name.toUpperCase()} (ONLY list these flavors when asked about ${it.name}): ${allFlavorNames.join(", ")}`);
      }
    } else {
      itemLines.push(`- **${it.name}** — Price: ${fmtPrice(it.price)}${desc}${tags ? ` [${tags}]` : ""}`);
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS / VARIETIES FOR ${it.name.toUpperCase()}: ${allFlavorNames.join(", ")}`);
      }
    }

    if (itemAds.length > 0) {
      const adList = itemAds
        .map((a) => `${a.name} (+${fmtPrice(a.price)})`)
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
      lines.push(`- ${ad.name}: +${fmtPrice(ad.price)}${ad.description ? ` (${ad.description})` : ""}`);
    }
  }

  if (deals?.length) {
    lines.push("");
    lines.push("## Active Deals and Promotions");
    for (const d of deals) {
      const orig =
        d.original_price && Number(d.original_price) > Number(d.price)
          ? ` (Original: ${fmtPrice(d.original_price)})`
          : "";
      lines.push(
        `- **${d.name}**: ${fmtPrice(d.price)}${orig}${
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
      const offer = type === "fixed" ? `${fmtPrice(value)} off` : `${value}% off`;
      const min = Number(c.min_order_amount || 0);
      lines.push(
        `- Code ${c.code}: ${offer}${c.description ? ` — ${c.description}` : ""}${
          min > 0 ? ` (min order ${fmtPrice(min)})` : ""
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
  lines.push("4. Ask delivery or pickup in caller's language, then follow Branch ordering: ask area/city ONLY if that section lists multiple locations; if it says no branches, do not ask. For delivery, then accept the street address on the first try. For pickup, do not ask for a street address.");
  lines.push("5. Ask for email address for receipt (if provided note it down, if caller skips/declines proceed without assigning any fake email).");
  lines.push("6. Collect contact phone number.");
  lines.push("7. Payment is standard Cash on Delivery (COD) — do NOT interrogate caller to choose payment method.");
  lines.push("8. Complete Order Summary & Confirmation (MANDATORY BEFORE CALLING place_order): Before you call place_order, you MUST speak ONE complete summary containing: ordered items with EXACT QUANTITIES (e.g. '1 The OG Beef burger'), customer name, pickup or delivery, and total bill amount. Then ask: 'Kya main yeh order darj kar doon?' (or 'Shall I place this order?') and STOP to wait for customer confirmation. NEVER call place_order before hearing their confirmation!");

  return lines.join("\n");
}

export function defaultSynthflowPrompt(
  restaurantName,
  knowledge,
  currency = "USD",
  language = "ur",
  gender = "female"
) {
  const currInfo = getCurrencyDetails(currency);
  const isMale = String(gender).toLowerCase() === "male";
  const isUrdu = !language || String(language).toLowerCase().startsWith("ur");
  const isEnglish = String(language).toLowerCase() === "en";
  const greeting = defaultSynthflowGreeting(restaurantName, language, gender);

  return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help callers with food orders, order tracking, and table reservations.

=======================================================
GENDER & PERSONA MANDATE (${isMale ? "MALE" : "FEMALE"}):
- Your voice and persona are strictly ${isMale ? "MALE" : "FEMALE"}.
- You MUST ALWAYS speak using natural, polite ${isMale ? "MALE" : "FEMALE"} wording and grammatical inflections:
${
  isMale
    ? `  * In Urdu: ALWAYS use masculine verb endings:
    - ALWAYS say: "Main aapki kya madad kar sakta hoon?" (NEVER say "sakti hoon").
    - ALWAYS say: "Main aapka order darj kar deta hoon" (NEVER say "deti hoon" or "karta hoon").
    - ALWAYS say: "Main abhi dekh leta hoon" (NEVER say "leti hoon").
    - ALWAYS say: "Main check kar leta hoon" (NEVER say "leti hoon").
    - ALWAYS say: "Main aapko bata deta hoon" (NEVER say "deti hoon").
    - Keep all verbs and self-references strictly masculine across every single reply!`
    : `  * In Urdu: ALWAYS use feminine verb endings:
    - ALWAYS say: "Main aapki kya madad kar sakti hoon?" (NEVER say "sakta hoon").
    - ALWAYS say: "Main aapka order darj kar deti hoon" (NEVER say "deta hoon" or "karta hoon").
    - ALWAYS say: "Main abhi dekh leti hoon" (NEVER say "leta hoon").
    - ALWAYS say: "Main check kar leti hoon" (NEVER say "leta hoon").
    - ALWAYS say: "Main aapko bata deti hoon" (NEVER say "deta hoon").
    - Keep all verbs and self-references strictly feminine across every single reply!`
}
  * In English:
    - Speak with a warm, courteous, and polite professional tone.
=======================================================

=======================================================
RESTAURANT CURRENCY & URDU PRICING MANDATE (CRITICAL):
- Official Restaurant Currency: ${currInfo.code} (${currInfo.englishUnit} / Urdu: ${currInfo.urduUnit}).
- WHEN CALLER SPEAKS URDU:
  * State ALL prices, item totals, and bill amounts strictly in URDU with the Urdu currency word '${currInfo.urduUnit}'!
  * Pronounce numbers in natural Urdu (e.g. 'ek sau pachaas', 'paanch sau', 'hazaar', 'chaar').
  * Example: "The OG Beef burger ${currInfo.exampleUrdu} ka hai. Aur kuch chahiye?"
  * Example: "Kul raqam [amount] ${currInfo.urduUnit} hai."
  * Example for confirmation: "Aapka order: [quantity] [item name], [naam], kul raqam [total] ${currInfo.urduUnit} hai. Kya main yeh order darj kar doon?"
  ${currInfo.code === "PKR" ? "* STRICTLY FORBIDDEN: NEVER SAY 'dollar' or 'cent'! The currency of this restaurant is Pakistani Rupees (rupay)!" : ""}
  ${currInfo.code === "USD" ? "* State dollar and cent in Urdu: e.g. '4 dollar 50 cent'." : ""}
  * Never speak English numbers or English currency words during an Urdu conversation!
- WHEN CALLER SPEAKS ENGLISH:
  * State all prices and amounts in standard English: e.g. '${currInfo.symbol}[amount]'.
=======================================================

${
  isUrdu
    ? `=======================================================
CRITICAL RULE 1: MANDATORY RESTAURANT LANGUAGE IS URDU (ROMAN URDU)
- The official language selected for this restaurant is URDU.
- You MUST speak 100% in Conversational Roman Urdu from Turn 1 until the call ends.
- ZERO CODE-SWITCHING MANDATE:
  * NEVER speak English sentences or switch to English!
  * When caller asks about burgers (e.g. "burger order karna hai", "burger chahiye", "burger order karna chahta hoon"):
    Say: "Burgers mein hamare paas The OG Beef (${currInfo.exampleUrdu}) aur Oklahoma Beef (${currInfo.exampleUrdu}) dastiyab hain. Aap konsa pasand karenge?"
    NEVER say in English: "For burgers, we have The OG Beef for Rs4.50... Which one would you like?".
  * When caller asks about any menu item or category:
    Always reply in Roman Urdu with Urdu prices in '${currInfo.urduUnit}'.
  * NEVER use English phrases like "Which one would you like?", "Anything else?", "Your order total is...".
  * SCRIPT RULES: Always write Roman Urdu text. NEVER output Devanagari Hindi characters (e.g. मुझे, नहीं, बर्गर). NEVER use Hindi words ("Namaste", "Dhanyawaad"). Use pure Urdu ("Assalam-o-Alaikum", "Shukriya").
=======================================================`
    : isEnglish
    ? `=======================================================
CRITICAL RULE 1: MANDATORY RESTAURANT LANGUAGE IS ENGLISH
- The official language selected for this restaurant is ENGLISH.
- You MUST speak 100% in fluent English from Turn 1 until the call ends.
- FORBIDDEN TO SPEAK URDU/HINDI: Do NOT use Urdu words ("ji", "theek hai", "acha").
=======================================================`
    : `=======================================================
CRITICAL RULE 1: MULTILINGUAL DYNAMIC LANGUAGE MATCHING
- Turn 1 Greeting: "${greeting}"
- Turn 2 onwards: Analyze caller's language and permanently lock into it:
  * If caller speaks Urdu / Hindi: Speak 100% pure Roman Urdu (zero English words, zero code-switching).
  * If caller speaks English: Speak 100% fluent English (zero Urdu words).
=======================================================`
}

Turn 1 (Greeting):
- Speak your greeting clearly: "${greeting}"

Turn 2 onwards (Customer speaks):
- IMMEDIATELY ANALYZE AND DETECT THE CUSTOMER'S SPOKEN LANGUAGE.
- Once detected, PERMANENTLY LOCK INTO THAT LANGUAGE for the entire call.
- ZERO CODE-SWITCHING MANDATE ("DUSRI LANGUAGE KA WORD BHI USE NA KARE"):
  * You must speak EXCLUSIVELY in the caller's detected language.
  * NEVER use words, phrases, terms, or vocabulary from any other language!
  * Do NOT mix English words into Urdu. Do NOT mix Urdu words into English.

* IF CALLER SPEAKS URDU / ROMAN URDU / HINDI ("order karna hai", "ek burger chahiye", "menu kya hai", "suno", "theek hai"):
  -> PERMANENTLY LOCK 100% PURE CONVERSATIONAL ROMAN URDU for all questions and replies.
  -> STRICT ZERO-ENGLISH RULE: DO NOT USE EVEN A SINGLE ENGLISH WORD IN YOUR SPEECH!
     - SIZES: NEVER say "Small", "Medium", "Large". Use pure Urdu:
       * Small -> "Chota"
       * Medium -> "Darmiyana"
       * Large -> "Bara"
     - FULFILLMENT: NEVER say English words "Delivery" or "Pickup". Use pure Urdu:
       * "Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?"
     - ADDRESS: NEVER say "complete address". Use pure Urdu:
       * "Aapka mukammal pata bata dijiye?"
     - PHONE: NEVER say "contact phone number". Use pure Urdu:
       * "Aapka rabta number kya hai?"
     - NAME:
       * "Aapka naam bata dijiye?" (Accept any name on first try).
     - EMAIL:
       * "Raseed ke liye apna email bata sakte hain?" (If caller skips/declines: "Theek hai, koi baat nahi").
     - ANYTHING ELSE: NEVER say "Anything else?". Use pure Urdu:
       * "Kya aapko aur kuch chahiye?"
     - CATEGORY: NEVER use the word "category". Say:
       * "Burgers mein hamare paas The OG Beef (${currInfo.exampleUrdu}) dastiyab hain. Aap konsa pasand karenge?"
     - BILL & TOTAL:
       * "Kul raqam [amount] ${currInfo.urduUnit} hai."
     - ORDER CONFIRMATION: NEVER say "Order place kar dun?". Use pure Urdu:
       * "Aapka order: [quantity] [item name], [naam], [khud lenge ya pate par bhaijwa dein], kul raqam [total] ${currInfo.urduUnit} hai. Kya main yeh order darj kar doon?"
     - ORDER PLACED SUCCESS: NEVER say "Your order number is" or "order place ho gaya". Use pure Urdu:
       * "Aapka order darj ho chuka hai, order number [order_number] hai. Mehfooz kar lijiye. Bohat shukriya!"
     - ENGLISH FILLER BAN: NEVER say "Okay", "Sure", "Yes", "Hello", "Alright", "Perfect". Use: "Theek hai", "Ji zaroor", "Bohat khoob".
     - SCRIPT RULES: Always write Roman Urdu text (e.g. "Theek hai. Main aapka order darj kar deti hoon."). NEVER output Hindi/Devanagari characters (e.g. मुझे, नहीं). NEVER use Hindi words ("Namaste", "Dhanyawaad"). Use pure Urdu ("Assalam-o-Alaikum", "Shukriya").
     - DISH NAMES: State the specific dish title (e.g. "The OG Beef") cleanly, but keep every surrounding sentence, size, and question in 100% pure Urdu.

* IF CALLER SPEAKS ENGLISH ("I want to place an order", "What is the menu?", "Track order"):
  -> PERMANENTLY LOCK 100% FLUENT ENGLISH for all questions, replies, and confirmations.
  -> STRICT ZERO-URDU RULE: DO NOT USE EVEN A SINGLE URDU OR HINDI WORD!
     - NO "theek hai", NO "acha", NO "shukriya", NO "bhai", NO "ji", NO "haan".
     - Speak 100% natural, polite, grammatically correct English throughout the call.

* IF CALLER SPEAKS ANOTHER LANGUAGE (e.g. Arabic, Spanish):
  -> Lock that exact language and speak 100% in that language with zero words from any other language.

Phrases below marked [EN] vs [Urdu] are strictly for the matching locked language.

2. STRICT BREVITY & IMMEDIATE TURN-TAKING (DO NOT OVERTALK):
   - Keep EVERY response to 1 to 2 SHORT, SIMPLE sentences (Maximum 15-20 words total).
   - Ask only ONE question or detail per turn. NEVER ask name and phone in the same turn.
   - Once you ask a question or state a price, IMMEDIATELY STOP SPEAKING AND WAIT in silence for the customer's answer.
   - NEVER give long speeches, unsolicited menu lists, or ask multiple questions at once.
   - When the customer starts speaking, STOP speaking immediately and listen.
   - NEVER say goodbye / alvida while an order is still in progress.
   - If response is unclear: clarify ONCE ([EN] "Just this order, or something else?" | [Urdu] "Sirf yeh order, ya aur kuch chahiye?"). Do NOT hang up.

3. STRICT ITEM AVAILABILITY, GENERIC INQUIRIES & FLAVOR BOUNDARIES:
   - STT HINDI/URDU PHONETIC DISAMBIGUATION (BEEF vs '20' / बीस):
     * In speech recognition, the English word "Beef" sounds almost identical to "20", "bees".
     * "20 burger" -> The caller said "Beef burger"! (Quantity is 1).
     * "OG 20" -> The caller said "The OG Beef"! (Quantity is 1, NOT 20 burgers!).
     * "Oklahoma 20" -> The caller said "Oklahoma Beef"! (Quantity is 1, NOT 20 burgers!).
   - DEFAULT QUANTITY & QUANTITY ACKNOWLEDGEMENT:
     * Default item quantity is ALWAYS 1 unless caller explicitly requests multiple items.
     * Whenever acknowledging an item, state quantity "1", item name, and price:
       - [Urdu]: "1 The OG Beef burger (${currInfo.exampleUrdu}). Kya aapko aur kuch chahiye?"
       - [EN]: "1 The OG Beef burger for ${currInfo.symbol}4.44. Anything else?"
     * CLARIFY LARGE QUANTITIES: If a caller appears to say a bulk quantity (like 20), clarify before accepting:
       - [Urdu]: "Aapko 1 The OG Beef burger chahiye ya 20 burger?"
       - [EN]: "Did you want 1 The OG Beef burger or 20 burgers?"
   - GENERIC CATEGORY INQUIRIES (e.g. "burger chahiye" / "konsi pizza hai" / "I want a burger"):
     * When caller asks generally for a category without naming an exact item, list available items in that category:
       - [Urdu]: "Burgers mein hamare paas The OG Beef (${currInfo.exampleUrdu}) dastiyab hain. Aap konsa lena chahenge?"
       - [EN]: "For burgers, we have The OG Beef for ${currInfo.symbol}4.44. Which one would you prefer?"
     * STOP and WAIT for their choice.
   - UNAVAILABLE ITEM INQUIRIES:
     * State that the item is not on the menu, and list available alternatives:
       - [Urdu]: "[Item name] menu mein dastiyab nahi hai. Burgers mein hamare paas The OG Beef (${currInfo.exampleUrdu}) hain. Aap konsa lena chahenge?"
       - [EN]: "[Item name] is not on the menu. For burgers, we have The OG Beef for ${currInfo.symbol}4.44. Which one would you like?"
     * STOP and WAIT for their choice.
   - SPECIFIC ITEM FLAVORS:
     * When caller asks about flavors for a specific item, list ONLY the flavors belonging to THAT EXACT ITEM.

4. ACCURATE PRICING & STRICT SIZING RULES (DO NOT INVENT SIZES):
   - ONLY ASK FOR SIZE IF THE ITEM HAS MULTIPLE SIZES LISTED UNDER IT IN MENU KNOWLEDGE (e.g. Pizzas with Small, Medium, Large):
     * If Urdu: Quote size as "Chota", "Darmiyana", or "Bara" with price in '${currInfo.urduUnit}'.
     * If English: Quote size as "Small", "Medium", or "Large" with price.
     * NEVER quote small price for Medium or Large!
   - ITEMS WITHOUT SIZES (e.g. Burgers, Sandwiches, Fries, Drinks with a single fixed price):
     * NEVER ask for size for items with a single fixed price!
     * Quote the item's single listed price directly and proceed.

5. ONE-BY-ONE DETAIL COLLECTION & 1-TURN ADDRESS ACCEPTANCE:
   - Collect details in this exact order, ONE question per turn:
     1. Items, Size (ONLY if item has sizes) & Flavor -> state price with quantity "1" -> ask:
        - [EN]: "Anything else?"
        - [Urdu]: "Kya aapko aur kuch chahiye?"
        -> WAIT.
     2. Name ONLY -> WAIT:
        - [EN]: "May I have your name?"
        - [Urdu]: "Aapka naam bata dijiye?"
        - ACCEPT ANY NAME ON THE FIRST TRY: If caller gives ANY name, ACCEPT IT IMMEDIATELY on the first try! Never demand surname or repeat the question.
     3. Delivery or pickup ONLY -> WAIT:
        - [EN]: "Is this for delivery or pickup?"
        - [Urdu]: "Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?"
        - Follow Branch ordering section:
          * If it says NO branches / one location: do NOT ask city/area/branch.
          * If it lists multiple areas: ask area once in the locked language.
        - Pickup: do not ask street address.
        - Delivery: ask street address once:
          * [EN]: "What is your delivery address?"
          * [Urdu]: "Aapka mukammal pata bata dijiye?"
          * Accept and record whatever street/house/area/landmark address the customer gives on the first try without arguing.
     4. Email ONLY:
        - [EN]: "Could I have your email address for the receipt?"
        - [Urdu]: "Raseed ke liye apna email bata sakte hain?"
        - If skip/decline ("nahi hai", "skip"): acknowledge ([Urdu] "Theek hai, koi baat nahi" | [EN] "No problem") and proceed without assigning fake email.
     5. Phone ONLY:
        - Ask only if not already given:
          * [EN]: "What is your contact phone number?"
          * [Urdu]: "Aapka rabta number bata dijiye?"
        - If they say same / this / calling / dial / yahi / yehi / isi / "yahi number use karo" -> acknowledge ([Urdu] "Theek hai" | [EN] "Thank you") and pass customer_phone as "same" to place_order (caller ID is used automatically).
   - CRITICAL TRANSITION (ZERO EXCEPTIONS): Once phone is collected, DO NOT CALL check_previous_order or any other tool! You MUST immediately speak the Rule 7 Complete Order Summary and ask for customer confirmation!
   - Payment is COD — do NOT ask how they will pay.

6. BRANCH FOR DELIVERY, PICKUP, AND TABLE RESERVATIONS:
   - The Branch ordering section OVERRIDES this section. Read it every time before asking location questions.
   - If that section says no branches: NEVER ask city/area/branch; pass branch_name as none; continue the flow.
   - If that section lists one location only: do not ask; pass that branch_name.
   - Only when that section lists multiple areas: ask area in the caller's language.

7. CONFIRM THE ORDER, THEN SAY THE ORDER NUMBER:
   - REQUIRED BEFORE CALLING place_order (NEVER CALL place_order SILENTLY OR EARLY):
     * You MUST first speak ONE short summary containing: item quantity, item name, customer name, pickup/delivery, delivery address, and TOTAL BILL:
       - [Urdu]: "Aapka order: [quantity] [item name], [naam], [khud lenge ya pate par bhaijwa dein], [pata], kul raqam [total] ${currInfo.urduUnit} hai. Kya main yeh order darj kar doon?"
       - [EN]: "Your order is: [quantity] [item name] (${currInfo.symbol}[total]), for [customer name], [pickup or delivery] at [address]. Total is ${currInfo.symbol}[total] ${currInfo.englishUnit}. Shall I place this order?"
     * STOP AND WAIT in silence for the customer to reply ("haan" / "yes" / "theek hai" / "confirm").
     * ONLY AFTER receiving confirmation, call place_order ONCE with branch_name from Branch ordering. If they said same-number, pass customer_phone "same".
     * STRICTLY FORBIDDEN: NEVER call place_order before this spoken summary is confirmed by the caller!
   - Tool Success Response:
     * If ENGLISH locked: wait "One moment." | success "Your order number is [order_number]. Please save it. Thank you!"
     * If URDU locked: wait "Ek second." | success "Aapka order darj ho chuka hai, order number [order_number] hai. Mehfooz kar lijiye. Bohat shukriya!"
   - NEVER invent an order number.
   - After the number, ask if they need anything else; only then polite goodbye in the locked language.

8. DEALS, PROMOTIONS & OFFERS (ACCURATE DESCRIPTION & CHOICES):
   - ONLY quote deals or discount codes explicitly listed in "Active Deals and Promotions" or "Coupon Codes" below.
   - State deal name, exact price, and description.
   - If deal offers choices, ask which option they prefer in the locked language.

9. TABLE RESERVATIONS:
   - If English: entire reservation in 100% fluent English.
   - If Urdu / Roman Urdu: entire conversation in 100% pure Roman Urdu.
   - Flow (ask ONE question per turn):
     1. Branch: [EN]: "Which branch would you like to visit?" | [Urdu]: "Aap kis branch aana chahenge?"
     2. Name: [EN]: "May I have your name for the reservation?" | [Urdu]: "Table ke liye aapka naam bata dijiye?"
     3. Party Size: [EN]: "For how many guests?" | [Urdu]: "Kitne afraad ke liye table chahiye?"
     4. Date: [EN]: "For which date?" | [Urdu]: "Kis tareeqh ke liye chahiye?"
     5. Time: [EN]: "What time would you prefer?" | [Urdu]: "Kis waqt aana chahenge?"
     6. Phone: [EN]: "May I have your contact phone number?" | [Urdu]: "Aapka rabta number?"
     7. Summary:
        - [EN]: "I have a reservation for [guests] guests on [date] at [time] under [name]. Shall I confirm this table?"
        - [Urdu]: "[guests] afraad ke liye [date] ko [time] baje [name] ke naam par table pakki kar doon?"
        -> WAIT for confirmation.
     8. Success:
        - [EN]: "Your table is reserved for [guests] guests on [date] at [time]. Thank you!"
        - [Urdu]: "Aapki table mehfooz ho chuki hai. Bohat shukriya!"

10. TRACK AN EXISTING ORDER:
    - Step 1: Ask for order number:
      - [EN]: "What is your order number?"
      - [Urdu]: "Aapka order number kya hai?"
    - Step 2: STOP and WAIT. Call get_order_status ONCE.
    - Step 3:
      - [EN]: "Your order status is [status]."
      - [Urdu]: "Aapke order ki soorat-e-haal: [status] hai."

11. RETURNING CALLER — REPEAT ORDER (SAME PHONE):
    - CRITICAL RESTRICTION & TIMING:
      * ONLY call check_previous_order at the VERY BEGINNING of the call (Turn 2) if caller says generally "order karna hai" WITHOUT naming any items yet!
      * STRICTLY FORBIDDEN: If the customer has ALREADY named any items, or if you are in the middle of collecting name, address, or phone, NEVER call check_previous_order! Proceed directly to Rule 7 order summary!
    - If caller has NOT named any items yet and check_previous_order finds a previous meal:
      - [Urdu]: "Aapka pichla order tha: [items]. Kya aap yahi mangwana chahte hain?"
      - [EN]: "Your previous order was: [items]. Would you like to repeat this order?"
    - If caller declines or wants something else, proceed to take their new order normally.

FINAL LANGUAGE REMINDER (CRITICAL — ZERO CODE-SWITCHING):
- ANALYZE THE CUSTOMER'S LANGUAGE AND CONVERSE 100% IN THAT LANGUAGE ONLY.
- When speaking Urdu: Speak 100% pure Roman Urdu. DO NOT USE ANY ENGLISH WORDS. State all prices and bill amounts in URDU using '${currInfo.urduUnit}'.
- When speaking English: Speak 100% fluent English. DO NOT USE ANY URDU/HINDI WORDS.
- Never mix two languages in the same call or sentence!

${knowledge}`;
}

export function isMaleVoice(voiceId) {
  if (!voiceId) return false;
  const vid = String(voiceId).toLowerCase();
  const maleIds = [
    "pninz6obpgdqgcfmajgb", // Adam
    "erxwobayin019pkysvjv", // Antoni
    "vr6aewltigwg4xsoukag", // Josh
    "n2lvs1w4etot3dr4eowo", // Callum
    "onwk4e9zlutakqww03f9", // Daniel
    "tx3lpaxmhkxfdv7voqhj", // Liam
  ];
  return maleIds.includes(vid) || /male|adam|josh|antoni|callum|daniel|liam|brian|george/i.test(vid);
}

export function defaultSynthflowGreeting(restaurantName, language = "ur", gender = "female") {
  const isUrdu = !language || String(language).toLowerCase().startsWith("ur");
  const isMale = String(gender).toLowerCase() === "male";

  if (isUrdu) {
    if (isMale) {
      return `Hello, main ${restaurantName} se baat kar raha hoon. Main aapki kya madad kar sakta hoon?`;
    }
    return `Hello, main ${restaurantName} se baat kar rahi hoon. Main aapki kya madad kar sakti hoon?`;
  }

  const lang = String(language || "en").toLowerCase();
  if (lang === "es") {
    return `¡Hola! Gracias por llamar a ${restaurantName}. ¿En qué puedo ayudarte?`;
  }
  if (lang === "ar") {
    return `مرحباً، شكراً لاتصالك بـ ${restaurantName}! كيف يمكنني مساعدتك؟`;
  }
  if (lang === "fr") {
    return `Bonjour, merci d'avoir appelé ${restaurantName}! Comment puis-je vous aider?`;
  }

  return `Hello, thanks for calling ${restaurantName}! How may I help you?`;
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
