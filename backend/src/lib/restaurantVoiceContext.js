import { branchOrderingSection } from "./branchLocation.js";

export { branchOrderingSection };

/** Active child branches the phone agent may offer. */
export async function loadActiveChildBranches(knex, restaurantId) {
  const restaurant = await knex("restaurants")
    .where({ id: restaurantId })
    .select("id", "parent_restaurant_id", "is_branch")
    .first();
  // Standalone HQ: only its own children. Branch line: siblings under parent.
  const parentId =
    restaurant?.is_branch && restaurant?.parent_restaurant_id
      ? restaurant.parent_restaurant_id
      : restaurantId;
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

/**
 * Mandatory place_order contract appended to EVERY agent prompt (custom or default).
 * Sir / operators may rewrite conversation style — this block keeps order creation reliable.
 */
export function appendPlaceOrderToolContract(prompt, lang = "ur") {
  const text = String(prompt || "").trim();
  if (!text) return text;
  if (/## PLACE_ORDER TOOL CONTRACT/i.test(text)) return text;

  const ur = String(lang || "").toLowerCase().startsWith("ur");
  const block = ur
    ? `
=======================================================
## PLACE_ORDER TOOL CONTRACT (NEVER REMOVE — ORDERS FAIL WITHOUT THIS)
- Call place_order ONLY after the caller confirms (haan / theek hai / yes) — then call IMMEDIATELY (do not drag).
- Required fields every time: customer_name, customer_phone, items, fulfillment_type, branch_name, delivery_address.
- MANDATORY: ask fulfillment every order in ENGLISH words: "Kya yeh order delivery ke liye hai ya pickup?" Never skip. NEVER say pate/bhejwa/khud aakar.
- NEVER say "daraj" or "darj" — always say "confirm" (e.g. "Kya main yeh order confirm kar doon?").
- Pickup: delivery_address = "Pickup", customer_email = "none", NEVER ask email.
- Delivery: full street address; email optional only.
- If caller says yahi/yehi/same/this number → customer_phone exactly "same". NEVER ask raabta number again after they answered once (yahi OR digits).
- branch_name: follow ## Branch ordering. If NO branches → exactly "none". NEVER invent "branch 2" or a city. NEVER ask Johar Town / Iqbal Town / any area unless ## Branch ordering lists that exact area.
- items: real food lines with quantity (default 1). Never empty. Never "<order_items>".
- Amounts: ENGLISH number words + "rupees" only (e.g. five hundred forty rupees). NO decimals. NEVER say "rupay".
- After tool returns: if success or "speak" is present, READ "speak" EXACTLY (Roman Urdu). Order IS saved. NEVER paraphrase into English. NEVER say fail. NEVER invent ORD digits. NEVER mention SMS.
- If phone_required: READ response "speak" ONCE (digits only). NEVER say "Order save nahi ho saka". NEVER ask phone again after digits — retry place_order with those digits.
- If branch_required but ## Branch ordering says NO branches: do NOT ask area — immediately retry place_order with branch_name "none".
- If success:false for other reasons: fix that field and call place_order again once. Do not invent an order number.
- Collect FAST: items → naam → fulfillment (MUST ask) → (pickup: no email) → raabta → short summary → haan → place_order immediately. NEVER ask phone before fulfillment.
=======================================================
`
    : `
=======================================================
## PLACE_ORDER TOOL CONTRACT (NEVER REMOVE — ORDERS FAIL WITHOUT THIS)
- Call place_order ONLY after the caller confirms (yes / okay / confirm) — then call IMMEDIATELY (do not drag).
- Required every time: customer_name, customer_phone, items, fulfillment_type, branch_name, delivery_address.
- MANDATORY: ask "Is this for delivery or pickup?" every new order. Never skip.
- NEVER say "daraj" or "darj" — always say "confirm".
- Pickup: delivery_address = "Pickup", customer_email = "none", NEVER ask email.
- Delivery: full street address; email optional only.
- Same/this/calling number → customer_phone exactly "same".
- branch_name: follow ## Branch ordering. If NO branches → "none". Never invent branch/area names (no Johar Town / Iqbal Town unless listed).
- items: real menu lines with quantity (default 1). Never empty placeholders.
- Amounts: ENGLISH number words + unit (e.g. five hundred forty rupees). NO decimals. NEVER say "rupay".
- On success/speak: read "speak" EXACTLY. Order is saved. Never invent ORD numbers. Never mention SMS.
- On phone_required: read "speak", ask digits only — never say the order failed. Retry place_order with digits.
- On branch_required but ## Branch ordering says NO branches: retry place_order with branch_name "none" — do not ask area.
- On other success:false: fix the missing field and retry place_order once. Never invent an order number.
- Collect FAST: items → name → fulfillment (MUST ask) → (pickup: skip email) → phone → short summary → confirm → place_order immediately.
=======================================================
`;

  return `${text}\n${block}`.trim();
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
    PKR: { code: "PKR", symbol: "Rs", urduUnit: "rupees", urduUnitSingular: "rupee", englishUnit: "rupees", exampleUrdu: "five hundred rupees" },
    USD: { code: "USD", symbol: "$", urduUnit: "dollars", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "four dollars" },
    EUR: { code: "EUR", symbol: "€", urduUnit: "euros", urduUnitSingular: "euro", englishUnit: "euros", exampleUrdu: "ten euros" },
    GBP: { code: "GBP", symbol: "£", urduUnit: "pounds", urduUnitSingular: "pound", englishUnit: "pounds", exampleUrdu: "ten pounds" },
    AED: { code: "AED", symbol: "AED", urduUnit: "dirhams", urduUnitSingular: "dirham", englishUnit: "dirhams", exampleUrdu: "twenty five dirhams" },
    SAR: { code: "SAR", symbol: "SAR", urduUnit: "riyals", urduUnitSingular: "riyal", englishUnit: "riyals", exampleUrdu: "thirty riyals" },
    CAD: { code: "CAD", symbol: "C$", urduUnit: "dollars", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "fifteen dollars" },
    AUD: { code: "AUD", symbol: "A$", urduUnit: "dollars", urduUnitSingular: "dollar", englishUnit: "dollars", exampleUrdu: "fifteen dollars" },
    INR: { code: "INR", symbol: "₹", urduUnit: "rupees", urduUnitSingular: "rupee", englishUnit: "rupees", exampleUrdu: "two hundred fifty rupees" },
    KWD: { code: "KWD", symbol: "KWD", urduUnit: "dinars", urduUnitSingular: "dinar", englishUnit: "dinars", exampleUrdu: "five dinars" },
    QAR: { code: "QAR", symbol: "QAR", urduUnit: "riyals", urduUnitSingular: "riyal", englishUnit: "riyals", exampleUrdu: "twenty riyals" },
    OMR: { code: "OMR", symbol: "OMR", urduUnit: "rials", urduUnitSingular: "rial", englishUnit: "rials", exampleUrdu: "five rials" },
    BHD: { code: "BHD", symbol: "BHD", urduUnit: "dinars", urduUnitSingular: "dinar", englishUnit: "dinars", exampleUrdu: "five dinars" },
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

const URDU_ONES = [
  "",
  "ek",
  "do",
  "teen",
  "chaar",
  "paanch",
  "chhe",
  "saat",
  "aath",
  "nau",
  "das",
  "gyarah",
  "barah",
  "terah",
  "chaudah",
  "pandrah",
  "solah",
  "satrah",
  "atharah",
  "unnees",
];
const URDU_TENS = ["", "", "bees", "tees", "chalees", "pachaas", "saath", "sattar", "assi", "nawwe"];
const URDU_TEENS_EXTRA = {
  20: "bees",
  30: "tees",
  40: "chalees",
  50: "pachaas",
  60: "saath",
  70: "sattar",
  80: "assi",
  90: "nawwe",
};

/** Speak a whole number in natural Roman Urdu (kept for order-number digits only). */
export function numberToRomanUrdu(n) {
  const num = Math.round(Number(n) || 0);
  if (num < 0) return String(num);
  if (num < 20) return URDU_ONES[num] || String(num);
  if (num < 100) {
    if (URDU_TEENS_EXTRA[num]) return URDU_TEENS_EXTRA[num];
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o ? `${URDU_TENS[t]} ${URDU_ONES[o]}` : URDU_TENS[t];
  }
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    const head = h === 1 ? "ek sau" : `${URDU_ONES[h] || h} sau`;
    return rest ? `${head} ${numberToRomanUrdu(rest)}` : head;
  }
  if (num < 100000) {
    const th = Math.floor(num / 1000);
    const rest = num % 1000;
    const head = th === 1 ? "ek hazaar" : `${numberToRomanUrdu(th)} hazaar`;
    return rest ? `${head} ${numberToRomanUrdu(rest)}` : head;
  }
  return String(num);
}

const EN_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Speak a whole number in English words for TTS (Urdu number words mispronounce).
 * Example: 540 → "five hundred forty"
 */
export function numberToEnglishWords(n) {
  const num = Math.round(Math.abs(Number(n) || 0));
  if (num === 0) return "zero";
  if (num < 20) return EN_ONES[num];
  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o ? `${EN_TENS[t]} ${EN_ONES[o]}` : EN_TENS[t];
  }
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    const head = `${EN_ONES[h]} hundred`;
    return rest ? `${head} ${numberToEnglishWords(rest)}` : head;
  }
  if (num < 100000) {
    const th = Math.floor(num / 1000);
    const rest = num % 1000;
    const head = `${numberToEnglishWords(th)} thousand`;
    return rest ? `${head} ${numberToEnglishWords(rest)}` : head;
  }
  if (num < 10000000) {
    const l = Math.floor(num / 100000);
    const rest = num % 100000;
    const head = `${numberToEnglishWords(l)} lakh`;
    return rest ? `${head} ${numberToEnglishWords(rest)}` : head;
  }
  return String(num);
}

const URDU_DIGIT = [
  "sifar",
  "ek",
  "do",
  "teen",
  "chaar",
  "paanch",
  "chhe",
  "saat",
  "aath",
  "nau",
];

/**
 * Speak paisa/cents digit-by-digit (legacy; spoken prices no longer use decimals).
 * Always two digits so 05 → "sifar paanch".
 */
export function paisaToRomanUrduDigits(cents) {
  const n = Math.max(0, Math.min(99, Math.round(Number(cents) || 0)));
  const padded = String(n).padStart(2, "0");
  return [...padded].map((d) => URDU_DIGIT[Number(d)] || d).join(" ");
}

/**
 * Phone-safe order number speech. TTS / LLM often mangle "ORD-261021-15" into a wrong suffix
 * (e.g. saying 04). Force every digit aloud so the agent cannot invent another number.
 * Example: ORD-261021-15 → "O R D, do chhe ek sifar do ek, ek paanch"
 */
export function speakOrderNumberForPhone(orderNumber) {
  const raw = String(orderNumber || "").trim().toUpperCase();
  if (!raw) return "";
  const chunks = [];
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      chunks.push(URDU_DIGIT[Number(ch)] || ch);
    } else if (ch >= "A" && ch <= "Z") {
      chunks.push(ch);
    } else if (ch === "-") {
      chunks.push("dash");
    }
  }
  return chunks.join(" ");
}

/**
 * How the agent should SPEAK a price.
 * ALWAYS whole numbers only (no decimals / paisay).
 * Amount words ALWAYS in English + English unit — e.g. "five hundred forty rupees" (NEVER "rupay").
 */
export function spokenPriceHints(amount, currInfo) {
  const whole = Math.round(Math.abs(Number(amount || 0)));
  const display = `${currInfo.symbol}${whole}`;
  const words = numberToEnglishWords(whole);
  const unit = currInfo.englishUnit || currInfo.urduUnit || "rupees";
  const speak = `${words} ${unit}`;
  return { display, urduSpeak: speak, enSpeak: speak, words };
}

/**
 * Build menu, sizes, flavors, addons, and coupons knowledge text embedded into Synthflow & ElevenLabs agent prompts.
 * @param {object} opts
 * @param {string} [opts.currency] - Explicit currency (restaurants.currency). Wins over settings.currency.
 */
export function buildRestaurantVoiceKnowledge({
  restaurantName,
  settings,
  currency: currencyOverride,
  categories,
  items,
  deals,
  discounts,
  variants = [],
  addons = [],
  itemAddons = [],
  branches = [],
  subCategories = [],
  preferUrduPrices = false,
}) {
  const currency = currencyOverride || settings?.currency || "USD";
  const currInfo = getCurrencyDetails(currency);
  const urduPriceMode =
    preferUrduPrices || currInfo.code === "PKR" || currInfo.code === "INR";

  function fmtPrice(amount) {
    const whole = Math.round(Number(amount || 0));
    if (["$", "€", "£", "₹", "C$", "A$"].includes(currInfo.symbol)) {
      return `${currInfo.symbol}${whole}`;
    }
    return `${currInfo.symbol} ${whole}`;
  }

  /** Always speak pizza/item sizes in English (TTS-safe). */
  function englishSizeName(name) {
    const raw = String(name || "").trim();
    const key = raw.toLowerCase();
    const map = {
      chota: "Small",
      chhoti: "Small",
      chhot: "Small",
      small: "Small",
      s: "Small",
      darmiyana: "Medium",
      darmiyani: "Medium",
      medium: "Medium",
      med: "Medium",
      m: "Medium",
      bara: "Large",
      bari: "Large",
      bada: "Large",
      large: "Large",
      l: "Large",
    };
    return map[key] || raw;
  }

  const taxRatePct = Number(settings?.tax_rate ?? 0);
  /** Same tax math as phoneOrderService, then ALWAYS whole number for speak (no decimals). */
  function afterTaxOne(preTax) {
    const n = Number(preTax || 0);
    if (!taxRatePct) return Math.round(n);
    const tax = Number((n * (taxRatePct / 100)).toFixed(2));
    const total = Number((n + tax).toFixed(2));
    return Math.round(total);
  }

  function priceLine(amount) {
    const h = spokenPriceHints(amount, currInfo);
    // Pre-compute after-tax so the model copies the string (no LLM math → no 1606 vs 1628)
    const after = afterTaxOne(amount);
    const hAfter = spokenPriceHints(after, currInfo);
    // Amount words ALWAYS English + english unit (e.g. "five hundred forty rupees")
    if (taxRatePct > 0 && after !== Math.round(Number(amount || 0))) {
      return (
        `${h.display} — MUST SPEAK item: "${h.urduSpeak}" | ` +
        `AFTER-TAX ×1 (no delivery): ${hAfter.display} — COPY EXACTLY MUST SPEAK: "${hAfter.urduSpeak}" ` +
        `(English number words only, NO decimals; NEVER invent another total; NEVER confirm with only pre-tax)`
      );
    }
    return `${h.display} — MUST SPEAK: "${h.urduSpeak}" (English number words, whole amount only, NEVER decimals/paisay/dollar/cent/$)`;
  }

  const lines = [];
  lines.push(`# ${restaurantName} — Menu, Flavors, Sizes, Add-ons, and Ordering Guide`);
  lines.push("");
  if (settings) {
    lines.push(`Currency: ${currInfo.code} (speak as ${currInfo.englishUnit} — NEVER rupay)`);
    if (settings.address) lines.push(`Restaurant address: ${settings.address}`);
    if (settings.phone) lines.push(`Restaurant phone: ${settings.phone}`);
    lines.push(`Tax rate: ${settings.tax_rate ?? 0}%`);
    lines.push(`Delivery fee: ${fmtPrice(settings.delivery_fee ?? 0)}`);
    lines.push(`Minimum order: ${fmtPrice(settings.min_order_amount ?? 0)}`);
    lines.push(`Currently accepting orders: ${settings.is_open === false ? "no" : "yes"}`);
    lines.push("");
    lines.push("## Bill total (MANDATORY — always speak AFTER-TAX total)");
    lines.push(
      `1. Subtotal = sum of ordered item + add-on prices (menu prices are BEFORE tax).`,
    );
    lines.push(
      `2. Tax = subtotal × (${settings.tax_rate ?? 0} / 100). Always apply this tax rate.`,
    );
    lines.push(
      `3. Delivery fee = ${fmtPrice(settings.delivery_fee ?? 0)} only if delivery; pickup = 0.`,
    );
    lines.push(
      `4. Kul raqam / Total = ROUND to whole number (NO decimals): subtotal + tax + delivery fee (minus coupon if any).`,
    );
    lines.push(
      `5. When confirming the order, ALWAYS speak this AFTER-TAX kul raqam — never only the pre-tax item sum.`,
    );
    lines.push(
      `6. Prefer the menu line "AFTER-TAX ×1" hint for a single item; for qty>1 multiply that AFTER-TAX unit, then add delivery if any.`,
    );
    lines.push(
      `7. AMOUNTS: speak ONLY English number words + "${currInfo.englishUnit}" (e.g. "five hundred forty ${currInfo.englishUnit}"). NEVER say "rupay". NEVER Urdu numbers. NEVER decimals.`,
    );
    lines.push(
      `   Example wording: "Items [X], teks shamil karke kul raqam five hundred forty ${currInfo.englishUnit} hai."`,
    );
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
  lines.push("When the caller names a type (burger, pizza, drink) and NOT one exact dish, match that word to a subcategory name first, then a category name. If the name matches, read THAT script in full — every item and every price. Do not read the parent category when a subcategory name matches. If no category or subcategory is named that word, read the ITEM PHONE SCRIPT for that word (only items whose name contains it). Never dump a different category.");

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
      itemLines.push(`  * EXACT PRICES BY SIZE (speak the EXACT amount for the chosen size — never invent or round differently):`);
      for (const s of sizes) {
        const enSize = englishSizeName(s.name);
        const sizeLabel = s.measurement ? `${enSize} (${s.measurement})` : enSize;
        itemLines.push(`    - ${sizeLabel}: ${priceLine(s.price)}`);
      }
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS EXCLUSIVE TO ${it.name.toUpperCase()} (ONLY list these flavors when asked about ${it.name}): ${allFlavorNames.join(", ")}`);
      }
    } else {
      itemLines.push(`- **${it.name}** — Price: ${priceLine(it.price)}${desc}${tags ? ` [${tags}]` : ""}`);
      if (allFlavorNames.length > 0) {
        itemLines.push(`  * FLAVORS / VARIETIES FOR ${it.name.toUpperCase()}: ${allFlavorNames.join(", ")}`);
      }
    }

    if (itemAds.length > 0) {
      const adList = itemAds
        .map((a) => `${a.name} (+${priceLine(a.price)})`)
        .join(", ");
      itemLines.push(`  * Available Sauces & Add-ons: ${adList}`);
    }

    return itemLines.join("\n");
  }

  function nameStems(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3)
      .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w));
  }

  function namesMatch(spoken, label) {
    const a = nameStems(spoken);
    const b = new Set(nameStems(label));
    return a.some((w) => b.has(w));
  }

  function spokenBitsFor(list) {
    const spokenBits = [];
    for (const it of list) {
      const itemVars = variantMap.get(it.id) || [];
      const rawSizes = itemVars.filter((v) => v.variant_type === "size");
      const seenSizes = new Set();
      const sizes = [];
      for (const s of rawSizes) {
        const key = `${(s.name || "").trim().toLowerCase()}_${Number(s.price).toFixed(2)}`;
        if (!seenSizes.has(key)) {
          seenSizes.add(key);
          sizes.push(s);
        }
      }
      if (sizes.length) {
        for (const s of sizes) {
          const enSize = englishSizeName(s.name);
          const sizeLabel = s.measurement ? `${enSize} ${s.measurement}` : enSize;
          spokenBits.push(`${it.name} ${sizeLabel} ${spokenPriceHints(s.price, currInfo).urduSpeak}`);
        }
      } else {
        spokenBits.push(`${it.name} ${spokenPriceHints(it.price, currInfo).urduSpeak}`);
      }
    }
    return spokenBits;
  }

  function phoneScript(kind, label, bits) {
    return `${kind} PHONE SCRIPT for "${label}" (${bits.length} items — say all ${bits.length}, skip none): Ji, ${label} mein hamare paas ${bits.join(", ")} hain. Aap konsa lena chahenge?`;
  }

  const activeSubs = (subCategories || []).filter((s) => s.is_active !== false);
  const subById = new Map(activeSubs.map((s) => [s.id, s]));
  const namedLabels = [
    ...(categories || []).map((c) => c.name),
    ...activeSubs.map((s) => s.name),
  ];

  for (const cat of categories || []) {
    const list = byCategory.get(cat.id) || [];
    if (!list.length) continue;
    lines.push("");
    lines.push(`### Category: ${cat.name}`);
    if (cat.description) lines.push(cat.description);

    const subsForCat = activeSubs.filter((s) => s.category_id === cat.id);
    const direct = [];
    const bySub = new Map();
    for (const it of list) {
      const sub = it.sub_category_id ? subById.get(it.sub_category_id) : null;
      if (sub && sub.category_id === cat.id) {
        if (!bySub.has(sub.id)) bySub.set(sub.id, []);
        bySub.get(sub.id).push(it);
      } else {
        direct.push(it);
      }
    }

    if (direct.length) {
      if (subsForCat.length) lines.push(`#### Items in ${cat.name} with no subcategory`);
      for (const it of direct) lines.push(renderItem(it));
    }

    for (const sub of subsForCat) {
      const subItems = bySub.get(sub.id) || [];
      if (!subItems.length) continue;
      lines.push("");
      lines.push(`#### Subcategory: ${sub.name} (inside ${cat.name})`);
      if (sub.description) lines.push(sub.description);
      for (const it of subItems) lines.push(renderItem(it));
      lines.push(phoneScript("SUBCATEGORY", sub.name, spokenBitsFor(subItems)));
      lines.push(
        `Read the subcategory script above ONLY when the caller’s word matches the subcategory name "${sub.name}" (example: burger matches Burgers). Do not add other items from ${cat.name}.`,
      );
    }

    lines.push(phoneScript("CATEGORY", cat.name, spokenBitsFor(list)));
    lines.push(
      `Read this CATEGORY script ONLY when the caller’s word matches the category name "${cat.name}". If a subcategory name matches, read the subcategory script instead and skip this one.`,
    );
  }

  const itemWordMap = new Map();
  for (const it of (items || []).filter((i) => i.is_available !== false && !/table\s*reserv|book\w*\s+(a\s+)?table/i.test(String(i.name || "")))) {
    const seen = new Set();
    for (const stem of nameStems(it.name)) {
      if (stem.length < 4 || seen.has(stem)) continue;
      seen.add(stem);
      if (namedLabels.some((label) => namesMatch(stem, label))) continue;
      if (!itemWordMap.has(stem)) itemWordMap.set(stem, []);
      itemWordMap.get(stem).push(it);
    }
  }
  if (itemWordMap.size) {
    lines.push("");
    lines.push("### Item-name scripts (no category or subcategory uses this name)");
    lines.push("Use one of these ONLY when the caller’s word does not match any category or subcategory name. Say only the items in that script. Do not read the parent category.");
    for (const [stem, list] of itemWordMap) {
      lines.push(phoneScript("ITEM", stem, spokenBitsFor(list)));
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
    lines.push("## Sauces & Extra Add-ons (REFERENCE ONLY)");
    lines.push(
      "CRITICAL: Only offer an add-on if it appears under that specific item's \"Available Sauces & Add-ons\" line above. NEVER offer a random add-on from this list for an item that does not list it.",
    );
    for (const ad of addons) {
      lines.push(`- ${ad.name}: +${priceLine(ad.price)}${ad.description ? ` (${ad.description})` : ""}`);
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
  lines.push("DO NOT DRAG the order. One short question per turn, accept answers on first try, then confirm quickly.");
  if (urduPriceMode) {
    lines.push("1. Greet warmly in Pakistani Roman Urdu (Lahore style) and ask what they would like — one short question, then wait.");
    lines.push("2. Capture ordered items/sizes/flavors from THIS menu only. Sizes ALWAYS English: Small / Medium / Large (NEVER Chota / Darmiyana / Bara). Speak each price using the MUST SPEAK hint with ENGLISH number words + rupees (e.g. 'five hundred forty rupees'). NEVER say rupay. NEVER Urdu numbers. NEVER decimals. NEVER say dollar, cent, or $.");
    lines.push("2b. CATEGORY (mandatory): if they name a type but not one exact dish, match subcategory name first, then category name. Read that matching PHONE SCRIPT in full, every item and price. If no category or subcategory has that name, read the ITEM PHONE SCRIPT only. Never read a parent category just because one item sits inside it. If they already named the exact dish, do not read a script.");
    lines.push("3. Collect customer name (accept ANY name on first try). Acknowledge with a natural \"Ji\" / \"Acha ji\" — do not repeat the same filler every turn.");
    lines.push("4. MANDATORY fulfillment ask (every new order) — ENGLISH words only: \"Kya yeh order delivery ke liye hai ya pickup?\" NEVER skip. NEVER say pate/bhejwa/khud aakar. Then follow Branch ordering (if NO branches → never ask area; pass branch_name none).");
    lines.push(
      "5. Email: Pickup = NEVER ask email / raseed — jump to raabta number, customer_email=none. Delivery only: optional once \"Raseed ke liye apna email bata sakte hain?\"",
    );
    lines.push(
      "6. Phone: \"Aapka raabta number bata dijiye?\" If they say yahi/yehi/yhi/isi/same/this number → say \"Theek hai ji\" ONCE, NEVER ask phone again, pass customer_phone as \"same\".",
    );
    lines.push("7. Payment is COD — do not ask payment method.");
    lines.push(
      "8. CONFIRM FAST — do not delay: ONE short AFTER-TAX summary (English number words, whole amount only), then ask \"Kya main yeh order confirm kar doon?\" NEVER say daraj/darj. WAIT for haan, then call place_order immediately. No extra questions after summary.",
    );
  } else {
    lines.push("1. Greet calmly and ask what the caller would like to order.");
    lines.push("2. Capture ordered items, sizes (ONLY if item has sizes in menu), and flavors concisely, and state each item's price as it is ordered using ENGLISH number words (whole amounts only, no decimals). If caller asks for a category (e.g. 'burger') or an unavailable item, list the available items in that category with prices and let them choose.");
    lines.push("3. Collect customer name (accept ANY name on first try, even a single word like 'Akbar' — never ask again or reject it).");
    lines.push("4. MANDATORY: Ask delivery or pickup every new order in ENGLISH (\"Is this for delivery or pickup?\" / \"Kya yeh order delivery ke liye hai ya pickup?\"), then follow Branch ordering: ask area/city ONLY if that section lists multiple locations; if it says no branches, do not ask. For delivery, then accept the street address on the first try. For pickup, do not ask for a street address.");
    lines.push("5. Email: ONLY for delivery (optional receipt). Pickup: NEVER ask email — pass customer_email as none and go to phone. If caller skips email on delivery, proceed without a fake email.");
    lines.push("6. Collect contact phone number.");
    lines.push("7. Payment is standard Cash on Delivery (COD) — do NOT interrogate caller to choose payment method.");
    lines.push("8. CONFIRM FAST — do not drag: ONE short summary (items, name, pickup/delivery, AFTER-TAX total in English number words, no decimals), ask 'Shall I place this order?' / 'Kya main yeh order confirm kar doon?' (NEVER daraj/darj), WAIT for yes/haan, then call place_order immediately. NEVER call place_order before confirmation.");
  }

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
  const langKey = String(language || "ur").toLowerCase();
  const isUrdu = !language || langKey.startsWith("ur");
  const isEnglish = langKey === "en";
  const greeting = defaultSynthflowGreeting(restaurantName, language, gender);
  const verbHelp = isMale ? "sakta hoon" : "sakti hoon";
  const verbPlace = isMale ? "deta hoon" : "deti hoon";
  const verbLook = isMale ? "leta hoon" : "leti hoon";
  const verbTell = isMale ? "deta hoon" : "deti hoon";
  const taxMatch = String(knowledge || "").match(/Tax rate:\s*([\d.]+)\s*%/i);
  const taxRatePct = taxMatch ? taxMatch[1] : "0";
  // Urdu-locked restaurants: Roman Urdu conversation; delivery/pickup/confirm/amounts stay English words
  if (isUrdu) {
    return `You are the friendly phone ordering assistant for ${restaurantName} — a calm, confident Pakistani voice from Lahore on a restaurant landline.

PRIMARY MISSION:
Help with food orders, order tracking, and table reservations. Speak ONLY everyday Conversational Roman Urdu (Lahore / Pakistani style) — like a real person on the phone, not a scripted chatbot.

=======================================================
IDENTITY (CRITICAL):
- You are an AI voice assistant. If asked "kya aap insan hain?" / "are you human?" → politely say: "Ji, main AI assistant hoon, order lene mein madad kar ${verbHelp}." Then return to the order.
- NEVER claim to be a human, staff member in the kitchen, or a real person.
=======================================================

=======================================================
SPEECH — NATURAL LAHORI URDU (CRITICAL — SMOOTH, NO LAG):
- Speak in one continuous breath. No mid-sentence pause, no stutter, no drag on Assalamualaikum.
- NEVER write "...", "..", "…", or a double space. Those characters become silent gaps on the phone.
- Use a comma only when the grammar needs it. Do not stack commas to sound thoughtful.
- Max 1–2 short sentences per turn, then WAIT. Ask ONE question only. EXCEPTION: a category PHONE SCRIPT must be spoken in full, every item and price, even if it is longer.
- When the caller starts speaking, STOP immediately.
- Acknowledgments, one short word, then the next sentence with no gap: "Ji bilkul", "Acha ji", "Theek hai", "Zaroor". Do not repeat the same one every turn.
- Prefer TTS-friendly spellings: "raabta", "confirm", "shukriya", "mehfooz", "rupees", "teks", "Assalamualaikum", "delivery", "pickup".
- FORBIDDEN words: "daraj", "darj", "rupay", "rupiya", "pate par bhejwa", "khud aakar lenge" (use confirm / delivery / pickup / rupees instead).
- FORBIDDEN: Hindi, Devanagari, bookish Urdu, long paragraphs, repeating a phrase, English fillers (okay / sure / check / please hold).
- While a tool runs, say NOTHING yourself. The phone already plays one short filler. Do not add "Ji, ek second" or any waiting line. When the tool returns, read "speak" immediately.
- Dish names may stay as on the menu; EVERY other spoken word = smooth Pakistani Roman Urdu — EXCEPT amounts, sizes, and delivery/pickup (see below).
- Prices: copy exact MUST SPEAK hint. Amount = ENGLISH number words + "rupees" (540 → "five hundred forty rupees"). NEVER "rupay". NEVER Urdu numbers. NEVER decimals / paisay. Never dollar/cent/$.
- DO NOT DRAG: keep the order moving — one question, accept answer, next step, then confirm quickly.
=======================================================

=======================================================
GENDER (${isMale ? "MALE" : "FEMALE"}):
- ALWAYS use ${isMale ? "masculine" : "feminine"} Urdu verb endings on every turn.
- "Main aapki kya madad kar ${verbHelp}?"
- "Main aapka order confirm kar ${verbPlace}."
- "Main abhi dekh ${verbLook}."
- "Main aapko bata ${verbTell}."
- NEVER say "daraj" / "darj" — always "confirm".
- NEVER say English "check" — say "dekh ${verbLook}".
=======================================================

=======================================================
CURRENCY + TAX TOTAL (CRITICAL):
- Official currency: ${currInfo.code} / spoken unit: "${currInfo.englishUnit}".
- Speak ALL prices as ENGLISH number words + "${currInfo.englishUnit}" (example: "five hundred forty ${currInfo.englishUnit}").
- WHY English words: Urdu number TTS is unreliable — NEVER say paanch/sau/hazaar for money amounts.
- NO DECIMALS: round to whole amount. NEVER say paisay, cents, or ".50".
${currInfo.code === "PKR" || currInfo.code === "INR" ? `- STRICTLY FORBIDDEN: dollar, cent, $, Rs spoken as "R S", "rupay", "rupiya". Say only "${currInfo.englishUnit}" with English number words.` : ""}
- Example: "Chicken Burger five hundred ${currInfo.englishUnit} ka hai. Aur kuch chahiye?"
- Menu item prices are BEFORE tax. Tax rate = ${taxRatePct}%.
- Every menu price line includes "AFTER-TAX ×1" with a MUST SPEAK string — COPY THAT STRING EXACTLY for kul raqam (× quantity).
- HARD RULE: kul raqam MUST come from the SAME item(s) the caller ordered — never from a different menu line or a previous order.
  Example: Chicken Burger AFTER-TAX ×1 = "five hundred forty ${currInfo.englishUnit}" (Rs540). NEVER invent another dish's total.
- Do NOT recalculate tax in your head. Prefer the printed AFTER-TAX MUST SPEAK for that exact item.
- ALWAYS speak AFTER-TAX kul raqam. NEVER confirm with only the pre-tax item sum.
- Bill, say it exactly like this: "Teks shamil karke kul raqam [exact AFTER-TAX MUST SPEAK for THIS order] hai."
- SPOKEN WORD: NEVER say English "tax" / "taks" / "teks percent". Always say "teks" like "teeks" (ٹیکس). Bill line ONLY: "Teks shamil karke kul raqam [AFTER-TAX MUST SPEAK] hai." Never say "8.5 percent tax".
=======================================================

=======================================================
PHONE — "YAHI NUMBER" (CRITICAL):
- Ask once: "Aapka raabta number bata dijiye?"
- If caller says ANY of: yahi / yehi / yhi / isi / wahi / same / this / ye number / yahi number / yehi number / "yahi wala" / calling number → reply "Theek hai ji" ONCE and CONTINUE.
- NEVER ask for the phone number a second time.
- Pass customer_phone as exactly "same" to place_order (caller ID is used automatically).
- Only ask again if they clearly give a DIFFERENT digit number, or say they have no number.
=======================================================

=======================================================
LANGUAGE LOCK — PAKISTANI ROMAN URDU ONLY:
- From Turn 1 to the end: 100% Conversational Roman Urdu (Lahore everyday speech). ZERO English sentences.
- WHY Roman (not Nastaliq اردو): this phone pipeline's ASR/TTS is tuned for Roman Urdu + South-Asian speech — Nastaliq often mispronounces on the live voice path. Keep Roman spellings that sound correct when spoken aloud.
- FORBIDDEN spoken words/phrases: "Phone number", "Anything else", "Order place kar dun", "Okay", "Sure", "Hello", "Hi I am calling", "email", "daraj", "darj", "pate par bhejwa", "khud aakar lenge".
- Fulfillment MUST be asked on EVERY new order (never skip) using ENGLISH words: "Kya yeh order delivery ke liye hai ya pickup?"
- Name: "Aapka naam bata dijiye?" (accept ANY name on first try — even one word).
- Phone: ask once only — "Aapka raabta number bata dijiye?"
- More items: "Kya aapko aur kuch chahiye?" or "Aur kuch?"
- Confirm FAST (do not drag): "Aapka order: [qty] [item], [naam], [delivery / pickup], teks shamil karke kul raqam [English AFTER-TAX total e.g. five hundred forty ${currInfo.englishUnit}] hai. Kya main yeh order confirm kar doon?" Then WAIT — on haan call place_order immediately. NEVER say daraj/darj/rupay.
- Success: speak EXACTLY the place_order tool's "speak" text (digits already expanded). If success/speak is present, the order IS saved — NEVER say order fail / save nahi hua. NEVER invent ORD numbers. NEVER mention SMS.
- Sizes: ALWAYS English — Small / Medium / Large (NEVER Chota / Darmiyana / Bara).
- NEVER invent "branch 2" or a city/area. Follow ## Branch ordering only; if it says NO branches, pass branch_name as none.
=======================================================

=======================================================
EMAIL (CRITICAL — ZERO EXCEPTIONS):
- If fulfillment is pickup / self-collect:
  * NEVER ask for email. NEVER say the word "email". NEVER say "raseed".
  * Immediately ask raabta number next. Pass customer_email as exactly "none" to place_order.
  * FORBIDDEN after pickup: "Raseed ke liye email?", "Email bata dein?", "Koi email?"
- Delivery only: optional once — "Raseed ke liye apna email bata sakte hain?" If nahi/skip → "Theek hai ji" and continue.
=======================================================

Turn 1: Speak exactly (smooth, no lag): "${greeting}"

Turn 2 onwards:
1. ONLY sell items listed under "## Menu Categories & Available Items" below. Never invent items or prices.
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
4. Add-ons: ONLY if listed under that item's "Available Sauces & Add-ons". Never invent Extra Cheese unless linked.
5. One question per turn, then WAIT in silence. Keep other turns to 1–2 short sentences. The category list in rule 3 is the exception — name the items even if that takes more than two sentences. Respond to what they just said.
6. Collect FAST in order (do not drag): items → naam (EXACT name) → MANDATORY fulfillment ask → (DELIVERY only: email optional; PICKUP: skip email) → raabta number (once; yahi = "same") → ONE short AFTER-TAX summary (English number words, no decimals) → wait for "haan" → place_order immediately.
7. NEVER call check_previous_order unless caller clearly says they want the OLD/LAST order repeated ("pehle wala", "wahi order", "repeat last"). If any dish is named → fresh order only.
8. Branch ordering section overrides location questions. No branches → never ask area; branch_name = none.
9. Track order: ask "Aapka order number kya hai?", wait, call get_order_status once.
10. Payment is COD — never ask how they will pay.
11. After the caller says haan, call place_order once immediately. Do not speak a waiting line. If the tool returns "speak" or success, READ "speak" EXACTLY. The order is saved. NEVER say it failed. NEVER invent an order number. If phone_required: read "speak", get digits, retry place_order — do NOT say order failed. Only after TWO hard failures (no phone_required, no speak) say once: "Order save nahi ho saka, ek baar phir try karte hain."
12. NEVER invent item prices or mix another dish's AFTER-TAX. Chicken Burger kul raqam = that line's AFTER-TAX MUST SPEAK only (English number words).
13. Polite close only after order number (or if they decline): "Bohot shukriya, Allah hafiz." Never alvida while the order is still in progress.

FINAL: Pakistani Roman Urdu for conversation. Amounts ALWAYS English number words + "${currInfo.englishUnit}" (never "rupay", never Urdu numbers, never decimals). Sizes ALWAYS Small / Medium / Large. Fulfillment ALWAYS "delivery" / "pickup" in English. Order action ALWAYS "confirm" — NEVER "daraj" / "darj".

${knowledge}`;
  }

  return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help callers with food orders, order tracking, and table reservations.

=======================================================
SPEECH FLUENCY & NATURAL DELIVERY (CRITICAL — SMOOTH, NO LAG):
- Speak like a real restaurant order-taker: smooth, warm, continuous — never robotic or word-by-word.
- One short sentence per breath. No long pauses, no stuttering, no letter-by-letter spelling.
- Max 1–2 short sentences, then WAIT in silence.
- Gentle connectors ("Ji", "Theek hai", "Zaroor" in Urdu | "Sure", "Of course", "Got it" in English).
- When quoting a price, use the exact MUST SPEAK hint from the menu knowledge below.
- Amounts = ENGLISH number words + "${currInfo.englishUnit}" (e.g. "five hundred forty ${currInfo.englishUnit}"). NEVER "rupay". NEVER Urdu numbers. NEVER decimals.
- DO NOT DRAG the order — confirm quickly after collecting details.
- Match gender grammar on EVERY verb.
=======================================================

=======================================================
GENDER & PERSONA MANDATE (${isMale ? "MALE" : "FEMALE"}):
- Your voice and persona are strictly ${isMale ? "MALE" : "FEMALE"}.
- Urdu: "Main aapki kya madad kar ${verbHelp}?", "Main aapka order confirm kar ${verbPlace}.", "Main abhi dekh ${verbLook}.", "Main aapko bata ${verbTell}."
- NEVER say "daraj" / "darj" — always "confirm".
- Never say English "check" in Urdu mode — say "dekh ${verbLook}".
- English: warm, courteous, professional.
=======================================================

=======================================================
RESTAURANT CURRENCY & PRICING:
- Official currency: ${currInfo.code} (speak as ${currInfo.englishUnit}).
- ALL callers: prices as ENGLISH number words + '${currInfo.englishUnit}' (e.g. 'five hundred forty ${currInfo.englishUnit}'). NEVER "rupay". NEVER Urdu numbers. NEVER decimals.
- English callers may also hear '${currInfo.symbol}[whole amount]' but prefer spoken words from MUST SPEAK hints.
${currInfo.code === "PKR" ? "- NEVER say dollar or cent for this restaurant." : ""}
=======================================================

${
  isEnglish
    ? `=======================================================
CRITICAL RULE 1: MANDATORY ENGLISH
- Speak 100% fluent English from Turn 1. No Urdu/Hindi fillers.
=======================================================`
    : `=======================================================
CRITICAL RULE 1: MULTILINGUAL DYNAMIC LANGUAGE MATCHING
- Turn 1 Greeting: "${greeting}"
- Turn 2 onwards: lock into caller's language (Urdu → 100% Roman Urdu with zero English; English → 100% English with zero Urdu).
- Urdu fulfillment MUST use ENGLISH words: "Kya yeh order delivery ke liye hai ya pickup?" — NEVER pate/bhejwa/khud aakar.
- Order confirm MUST say "confirm" — NEVER "daraj" / "darj".
=======================================================`
}

Turn 1 (Greeting):
- Speak your greeting clearly: "${greeting}"

Turn 2 onwards (Customer speaks):
- Detect language once, then lock. Zero code-switching.
- If Urdu/Hindi: 100% Roman Urdu (amounts, sizes, delivery/pickup stay ENGLISH). MANDATORY fulfillment every order: "Kya yeh order delivery ke liye hai ya pickup?" Name: "Aapka naam bata dijiye?" Phone: "Aapka rabta number bata dijiye?" More: "Kya aapko aur kuch chahiye?" Confirm FAST: "Kya main yeh order confirm kar doon?" (never daraj) with kul raqam as English words + ${currInfo.englishUnit} (never rupay, no decimals).
- If English: 100% English. MANDATORY every order: "Is this for delivery or pickup?" Confirm quickly — do not drag.
- Dish names from menu only; never invent items or add-ons not linked to the item.

2. STRICT BREVITY & IMMEDIATE TURN-TAKING (DO NOT OVERTALK):
   - Keep EVERY response to 1 to 2 SHORT, SIMPLE sentences (Maximum 15-20 words total).
   - Ask only ONE question or detail per turn. NEVER ask name and phone in the same turn.
   - Once you ask a question or state a price, IMMEDIATELY STOP SPEAKING AND WAIT in silence for the customer's answer.
   - NEVER give long speeches, unsolicited menu lists, or ask multiple questions at once.
   - When the customer starts speaking, STOP speaking immediately and listen.
   - NEVER say goodbye / alvida while an order is still in progress.
   - If response is unclear: clarify ONCE ([EN] "Just this order, or something else?" | [Urdu] "Sirf yeh order, ya aur kuch chahiye?"). Do NOT hang up.

3. STRICT ITEM AVAILABILITY, GENERIC INQUIRIES & FLAVOR BOUNDARIES:
   - STRICT CATALOG ADHERENCE (NO FABRICATION):
     * You must ONLY quote, mention, and sell items, sizes, flavors, and deals that are EXPLICITLY listed in the "## Menu Categories & Available Items" section below!
     * NEVER mention dishes or prices from any other restaurant. If an item or category is not on the menu below, politely state that it is not available.
   - STT HINDI/URDU PHONETIC DISAMBIGUATION (BEEF vs '20' / बीस):
     * In speech recognition, the English word "Beef" sounds almost identical to "20", "bees".
     * "20 burger" -> The caller said "Beef burger"! (Quantity is 1).
     * If caller says "20 [item]" where the item is a beef item on the menu, they mean 1 item, NOT 20!
   - DEFAULT QUANTITY & QUANTITY ACKNOWLEDGEMENT:
     * Default item quantity is ALWAYS 1 unless caller explicitly requests multiple items.
     * Whenever acknowledging an item, state quantity "1", item name, and price (MUST SPEAK English words, whole amount):
       - [Urdu]: "1 [Item Name] ([English amount] ${currInfo.englishUnit}). Kya aapko aur kuch chahiye?"
       - [EN]: "1 [Item Name] for [English amount] ${currInfo.englishUnit}. Anything else?"
     * CLARIFY LARGE QUANTITIES: If a caller appears to say a bulk quantity (like 20), clarify before accepting:
       - [Urdu]: "Aapko 1 [Item Name] chahiye ya 20?"
       - [EN]: "Did you want 1 [Item Name] or 20?"
   - GENERIC CATEGORY INQUIRIES (e.g. "burger chahiye" / "konsi pizza hai" / "I want a burger"):
     * When caller asks generally for a category without naming an exact item, look up items strictly from the ## Menu Categories section below:
       - [Urdu]: "[Category] mein hamare paas [Item 1] ([price] ${currInfo.englishUnit}) dastiyab hain. Aap konsa lena chahenge?"
       - [EN]: "For [category], we have [Item 1] for [English amount] ${currInfo.englishUnit}. Which one would you prefer?"
     * STOP and WAIT for their choice.
   - UNAVAILABLE ITEM INQUIRIES:
     * State that the item is not on the menu, and list available alternatives from the menu below:
       - [Urdu]: "[Item name] menu mein dastiyab nahi hai. [Category] mein hamare paas [Item 1] ([price] ${currInfo.englishUnit}) hain. Aap konsa lena chahenge?"
       - [EN]: "[Item name] is not on the menu. For [category], we have [Item 1] for [English amount] ${currInfo.englishUnit}. Which one would you like?"
     * STOP and WAIT for their choice.
   - SPECIFIC ITEM FLAVORS:
     * When caller asks about flavors for a specific item, list ONLY the flavors belonging to THAT EXACT ITEM.

4. ACCURATE PRICING & STRICT SIZING RULES (DO NOT INVENT SIZES):
   - ONLY ASK FOR SIZE IF THE ITEM HAS MULTIPLE SIZES LISTED UNDER IT IN MENU KNOWLEDGE (e.g. Pizzas with Small, Medium, Large):
     * ALWAYS quote size in ENGLISH: "Small", "Medium", or "Large" — even when the call is in Urdu. NEVER say Chota / Darmiyana / Bara.
     * Speak price with ENGLISH number words + '${currInfo.englishUnit}' (NEVER rupay).
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
     3. Delivery or pickup ONLY (MANDATORY every new order — never skip; ENGLISH words) -> WAIT:
        - [EN]: "Is this for delivery or pickup?"
        - [Urdu]: "Kya yeh order delivery ke liye hai ya pickup?"
        - Follow Branch ordering section:
          * If it says NO branches / one location: do NOT ask city/area/branch.
          * If it lists multiple areas: ask area once in the locked language.
        - Pickup: do not ask street address.
        - Delivery: ask street address once:
          * [EN]: "What is your delivery address?"
          * [Urdu]: "Aapka mukammal pata bata dijiye?"
          * Accept and record whatever street/house/area/landmark address the customer gives on the first try without arguing.
     4. Email — DELIVERY ONLY (skip entirely on pickup):
        - Pickup: NEVER ask email. Pass customer_email as "none". Go to step 5.
        - Delivery only:
          * [EN]: "Could I have your email address for the receipt?"
          * [Urdu]: "Raseed ke liye apna email bata sakte hain?"
          * If skip/decline ("nahi hai", "skip"): acknowledge ([Urdu] "Theek hai, koi baat nahi" | [EN] "No problem") and proceed without assigning fake email.
     5. Phone ONLY:
        - Ask only if not already given:
          * [EN]: "What is your contact phone number?"
          * [Urdu]: "Aapka raabta number bata dijiye?"
        - If they say same / this / calling / dial / yahi / yehi / isi / "yahi number use karo" -> acknowledge ([Urdu] "Theek hai" | [EN] "Thank you") and pass customer_phone as "same" to place_order (caller ID is used automatically).
   - CRITICAL TRANSITION (ZERO EXCEPTIONS): Once phone is collected, DO NOT CALL check_previous_order or any other tool! You MUST immediately speak the Rule 7 Complete Order Summary and ask for customer confirmation!
   - Payment is COD — do NOT ask how they will pay.

6. BRANCH FOR DELIVERY, PICKUP, AND TABLE RESERVATIONS:
   - The Branch ordering section OVERRIDES this section. Read it every time before asking location questions.
   - If that section says no branches: NEVER ask city/area/branch; pass branch_name as none; continue the flow.
   - If that section lists one location only: do not ask; pass that branch_name.
   - Only when that section lists multiple areas: ask area in the caller's language.

7. CONFIRM THE ORDER FAST (DO NOT DRAG), THEN SAY THE ORDER NUMBER:
   - REQUIRED BEFORE CALLING place_order (NEVER CALL place_order SILENTLY OR EARLY):
     * Speak ONE short summary ASAP: item quantity, item name, customer name, pickup/delivery, address if delivery, and AFTER-TAX TOTAL as ENGLISH number words (whole amount only, no decimals):
       - [Urdu]: "Aapka order: [quantity] [item name], [naam], [delivery ya pickup], [pata], teks shamil karke kul raqam [e.g. five hundred forty] ${currInfo.englishUnit} hai. Kya main yeh order confirm kar doon?"
       - [EN]: "Your order is: [quantity] [item name], for [customer name], [pickup or delivery] at [address]. Total after tax is [e.g. five hundred forty] ${currInfo.englishUnit}. Shall I place this order?"
     * NEVER speak only the pre-tax item sum as the final bill. NEVER use Urdu numbers for money. NEVER speak decimals. NEVER say daraj/darj — always confirm.
     * STOP AND WAIT in silence for the customer to reply ("haan" / "yes" / "theek hai" / "confirm").
     * ONLY AFTER receiving confirmation, call place_order ONCE immediately (no extra questions). If they said same-number, pass customer_phone "same".
     * STRICTLY FORBIDDEN: NEVER call place_order before this spoken summary is confirmed by the caller!
   - Tool Success Response:
     * If ENGLISH locked: wait "One moment." | success "Your order number is [order_number]. Please save it. Thank you!"
     * If URDU locked: wait "Ek second." | success "Aapka order confirm ho chuka hai, order number [order_number] hai. Mehfooz kar lijiye. Bohat shukriya!"
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
- When speaking Urdu: Speak 100% pure Roman Urdu for conversation — EXCEPT money amounts (English number words + '${currInfo.englishUnit}', NEVER rupay), sizes (Small/Medium/Large), and fulfillment ("delivery" / "pickup"). Always say "confirm" — NEVER "daraj" / "darj". No decimals.
- When speaking English: Speak 100% fluent English. DO NOT USE ANY URDU/HINDI WORDS. Money = English number words, whole amounts only.
- Never mix two languages in the same call or sentence (money, sizes, delivery/pickup, and confirm are the only allowed English inside Urdu speech)!

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
    // Short first line = less TTS lag on turn 1. Warm Lahori phone tone, one breath.
    if (isMale) {
      return `Assalamualaikum, ${restaurantName} se baat ho rahi hai, main aapki kya madad kar sakta hoon?`;
    }
    return `Assalamualaikum, ${restaurantName} se baat ho rahi hai, main aapki kya madad kar sakti hoon?`;
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
  const [restaurant, settingsRow, categories, subCategories, items, deals, discounts, variants, addons, itemAddons] =
    await Promise.all([
      knex("restaurants").where({ id: restaurantId }).select("id", "name", "currency").first(),
      knex("restaurant_settings").where({ restaurant_id: restaurantId }).first(),
      knex("menu_categories").where({ restaurant_id: restaurantId }).orderBy("sort_order", "asc"),
      knex("menu_sub_categories").where({ restaurant_id: restaurantId }).orderBy("sort_order", "asc"),
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
      knex("menu_item_addons").whereIn(
        "menu_item_id",
        knex("menu_items").select("id").where({ restaurant_id: restaurantId }),
      ),
    ]);
  const branches = await loadActiveChildBranches(knex, restaurantId);
  // Prefer restaurant_settings.currency, then restaurants.currency — never silently USD when PKR is set
  const currency =
    settingsRow?.currency || restaurant?.currency || "USD";
  const settings = settingsRow
    ? { ...settingsRow, currency }
    : { currency, restaurant_id: restaurantId };
  return { settings, categories, subCategories, items, deals, discounts, variants, addons, itemAddons, branches };
}
