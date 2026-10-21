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

/** Speak a whole number in natural Roman Urdu (best-effort for menu prices). */
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
 * Speak paisa/cents digit-by-digit (e.g. 43 → "chaar teen", not "chalees teen").
 * Always two digits so 05 → "sifar paanch".
 */
export function paisaToRomanUrduDigits(cents) {
  const n = Math.max(0, Math.min(99, Math.round(Number(cents) || 0)));
  const padded = String(n).padStart(2, "0");
  return [...padded].map((d) => URDU_DIGIT[Number(d)] || d).join(" ");
}

/**
 * How the agent should SPEAK a price (Urdu lock vs English lock).
 * Always includes the exact numeric amount so the agent never invents prices.
 * Whole rupees = natural number words; paisay after the point = each digit separately.
 */
export function spokenPriceHints(amount, currInfo) {
  const num = Number(amount || 0);
  const whole = Math.floor(Math.abs(num));
  const cents = Math.round((Math.abs(num) - whole) * 100);
  const display =
    num % 1 === 0
      ? `${currInfo.symbol}${whole}`
      : `${currInfo.symbol}${num.toFixed(2)}`;
  const urduWords = numberToRomanUrdu(whole);
  let urduSpeak = `${urduWords} ${currInfo.urduUnit}`;
  if (cents > 0 && currInfo.code === "USD") {
    urduSpeak += ` ${paisaToRomanUrduDigits(cents)} cent`;
  } else if (cents > 0 && (currInfo.code === "PKR" || currInfo.code === "INR")) {
    // Point ke baad: har digit alag (43 → "chaar teen paisay", not "chalees teen")
    urduSpeak += ` ${paisaToRomanUrduDigits(cents)} paisay`;
  }
  const enSpeak =
    cents > 0
      ? `${currInfo.symbol}${num.toFixed(2)}`
      : `${currInfo.symbol}${whole}`;
  return { display, urduSpeak, enSpeak };
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
  preferUrduPrices = false,
}) {
  const currency = currencyOverride || settings?.currency || "USD";
  const currInfo = getCurrencyDetails(currency);
  const urduPriceMode =
    preferUrduPrices || currInfo.code === "PKR" || currInfo.code === "INR";

  function fmtPrice(amount) {
    const num = Number(amount || 0);
    const val = num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    if (["$", "€", "£", "₹", "C$", "A$"].includes(currInfo.symbol)) {
      return `${currInfo.symbol}${val}`;
    }
    return `${currInfo.symbol} ${val}`;
  }

  const taxRatePct = Number(settings?.tax_rate ?? 0);
  /** Same tax math as phoneOrderService, then whole rupay for PKR speak (matches dashboard). */
  function afterTaxOne(preTax) {
    const n = Number(preTax || 0);
    if (!taxRatePct) return n;
    const tax = Number((n * (taxRatePct / 100)).toFixed(2));
    const total = Number((n + tax).toFixed(2));
    if (urduPriceMode) return Math.round(total);
    return total;
  }

  function priceLine(amount) {
    const h = spokenPriceHints(amount, currInfo);
    // Pre-compute after-tax so the model copies the string (no LLM math → no 1606 vs 1628)
    const after = afterTaxOne(amount);
    const hAfter = spokenPriceHints(after, currInfo);
    if (urduPriceMode) {
      if (taxRatePct > 0 && after !== Number(amount || 0)) {
        return (
          `${h.display} — MUST SPEAK item: "${h.urduSpeak}" | ` +
          `AFTER-TAX ×1 (no delivery): ${hAfter.display} — COPY EXACTLY MUST SPEAK: "${hAfter.urduSpeak}" ` +
          `(do NOT invent another total; NEVER confirm with only pre-tax)`
        );
      }
      return `${h.display} — MUST SPEAK: "${h.urduSpeak}" (NEVER say dollar/cent/$)`;
    }
    if (taxRatePct > 0 && after !== Number(amount || 0)) {
      return (
        `${h.display} (speak Urdu: "${h.urduSpeak}" | speak EN: "${h.enSpeak}") ` +
        `| AFTER-TAX ×1: ${hAfter.display} — COPY EXACTLY (Urdu: "${hAfter.urduSpeak}" | EN: "${hAfter.enSpeak}")`
      );
    }
    return `${h.display} (speak Urdu: "${h.urduSpeak}" | speak EN: "${h.enSpeak}")`;
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
      `4. Kul raqam / Total = subtotal + tax + delivery fee (minus coupon if any).`,
    );
    lines.push(
      `5. When confirming the order, ALWAYS speak this AFTER-TAX kul raqam — never only the pre-tax item sum.`,
    );
    lines.push(
      `6. Prefer the menu line "AFTER-TAX ×1" hint for a single item; for qty>1 multiply that AFTER-TAX unit, then add delivery if any.`,
    );
    lines.push(
      `   Example wording: "Items [X], tax shamil karke kul raqam [AFTER-TAX total] ${currInfo.urduUnit} hai."`,
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
        const sizeLabel = s.measurement ? `${s.name} (${s.measurement})` : s.name;
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
  if (urduPriceMode) {
    lines.push("1. Greet calmly in Roman Urdu and ask what the caller would like to order.");
    lines.push("2. Capture ordered items/sizes/flavors from THIS menu only. Speak each price using the MUST SPEAK Urdu hint (e.g. 'paanch sau rupay'). NEVER say dollar, cent, or $.");
    lines.push("3. Collect customer name (accept ANY name on first try).");
    lines.push("4. Ask fulfillment ONLY in Urdu: \"Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?\" NEVER say \"Delivery\" or \"Pickup\". Then follow Branch ordering.");
    lines.push("5. Email (optional): \"Raseed ke liye apna email bata sakte hain?\"");
    lines.push(
      "6. Phone: \"Aapka rabta number bata dijiye?\" If they say yahi/yehi/yhi/isi/same/this number → say \"Theek hai\" ONCE, NEVER ask phone again, pass customer_phone as \"same\".",
    );
    lines.push("7. Payment is COD — do not ask payment method.");
    lines.push(
      "8. Before place_order: speak AFTER-TAX kul raqam using menu AFTER-TAX hints (not pre-tax), then ask \"Kya main yeh order darj kar doon?\" and WAIT.",
    );
  } else {
    lines.push("1. Greet calmly and ask what the caller would like to order.");
    lines.push("2. Capture ordered items, sizes (ONLY if item has sizes in menu), and flavors concisely, and state each item's price as it is ordered. If caller asks for a category (e.g. 'burger') or an unavailable item, list the available items in that category with prices and let them choose.");
    lines.push("3. Collect customer name (accept ANY name on first try, even a single word like 'Akbar' — never ask again or reject it).");
    lines.push("4. Ask delivery or pickup in caller's language, then follow Branch ordering: ask area/city ONLY if that section lists multiple locations; if it says no branches, do not ask. For delivery, then accept the street address on the first try. For pickup, do not ask for a street address.");
    lines.push("5. Ask for email address for receipt (if provided note it down, if caller skips/declines proceed without assigning any fake email).");
    lines.push("6. Collect contact phone number.");
    lines.push("7. Payment is standard Cash on Delivery (COD) — do NOT interrogate caller to choose payment method.");
    lines.push("8. Complete Order Summary & Confirmation (MANDATORY BEFORE CALLING place_order): Before you call place_order, you MUST speak ONE complete summary containing: ordered items with EXACT QUANTITIES (e.g. '1 [Item Name]'), customer name, pickup or delivery, and total bill amount. Then ask: 'Kya main yeh order darj kar doon?' (or 'Shall I place this order?') and STOP to wait for customer confirmation. NEVER call place_order before hearing their confirmation!");
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
  // Urdu-locked restaurants: no English detect/lock branch (stops "Delivery ya pickup?" / "$4.44")
  if (isUrdu) {
    return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help callers with food orders, order tracking, and table reservations — speaking ONLY smooth Conversational Roman Urdu.

=======================================================
SPEECH FLUENCY (CRITICAL):
- Speak like a real Pakistani restaurant order-taker: warm, smooth, confident — never robotic or word-by-word.
- Short natural sentences. Connectors: "Ji", "Theek hai", "Bohat khoob", "Zaroor".
- Prices: use the exact MUST SPEAK hint. Whole rupay as natural words (e.g. "paanch sau rupay"). Paisay after the point = EACH DIGIT separately (e.g. Rs 3.43 → "teen rupay chaar teen paisay", NEVER "chalees teen"). NEVER say dollar, cent, or $.
- Dish names may stay as written on the menu; EVERY other word must be Roman Urdu.
=======================================================

=======================================================
GENDER (${isMale ? "MALE" : "FEMALE"}):
- ALWAYS use ${isMale ? "masculine" : "feminine"} Urdu verb endings.
- "Main aapki kya madad kar ${verbHelp}?"
- "Main aapka order darj kar ${verbPlace}."
- "Main abhi dekh ${verbLook}."
- "Main aapko bata ${verbTell}."
- NEVER say English "check" — say "dekh ${verbLook}".
=======================================================

=======================================================
CURRENCY + TAX TOTAL (CRITICAL):
- Official currency: ${currInfo.code} / Urdu unit: ${currInfo.urduUnit}.
- Speak ALL prices as natural Roman Urdu numbers + "${currInfo.urduUnit}" (example: "${currInfo.exampleUrdu}").
${currInfo.code === "PKR" || currInfo.code === "INR" ? `- STRICTLY FORBIDDEN: dollar, cent, $, Rs spoken as "R S". Say only rupay/rupiya with Urdu numbers.
- Paisay rule: after the decimal, read EACH digit one-by-one (43 → "chaar teen paisay"). Do NOT combine into "chalees teen" / "taintalis".` : ""}
- Example: "The OG Beef ${currInfo.exampleUrdu} ka hai. Aur kuch chahiye?"
- Menu item prices are BEFORE tax. Tax rate = ${taxRatePct}%.
- Every menu price line includes "AFTER-TAX ×1" with a MUST SPEAK string — COPY THAT STRING EXACTLY for kul raqam (× quantity). Never invent numbers like 1606 when the line says 1628.
- Do NOT recalculate tax in your head. Prefer the printed AFTER-TAX MUST SPEAK.
- ALWAYS speak AFTER-TAX kul raqam. NEVER confirm with only the pre-tax item sum.
- Bill: "Tax shamil karke kul raqam [exact AFTER-TAX MUST SPEAK] ${currInfo.urduUnit} hai."
=======================================================

=======================================================
PHONE — "YAHI NUMBER" (CRITICAL):
- Ask once: "Aapka rabta number bata dijiye?"
- If caller says ANY of: yahi / yehi / yhi / isi / wahi / same / this / ye number / yahi number / yehi number / "yahi wala" / calling number → reply ONLY "Theek hai" and CONTINUE.
- NEVER ask for the phone number a second time.
- Pass customer_phone as exactly "same" to place_order (caller ID is used automatically).
- Only ask again if they clearly give a DIFFERENT digit number, or say they have no number.
=======================================================

=======================================================
LANGUAGE LOCK — ROMAN URDU ONLY (NO ENGLISH QUESTIONS):
- From Turn 1 to the end: 100% Conversational Roman Urdu. ZERO English sentences.
- FORBIDDEN spoken words/phrases: "Delivery", "Pickup", "delivery or pickup", "Delivery ya pickup", "Phone number", "Anything else", "Order place kar dun", "Okay", "Sure", "Hello", "Hi I am calling".
- Fulfillment MUST be exactly: "Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?"
- Name: "Aapka naam bata dijiye?"
- Phone: ask once only (see PHONE section above).
- More items: "Kya aapko aur kuch chahiye?"
- Confirm: "Aapka order: [qty] [item], [naam], [khud lenge / pate par bhaijwa dein], tax shamil karke kul raqam [Urdu AFTER-TAX total] ${currInfo.urduUnit} hai. Kya main yeh order darj kar doon?"
- Success: "Aapka order darj ho chuka hai, order number [order_number] hai. Mehfooz kar lijiye. Bohat shukriya!"
- Sizes: Chota / Darmiyana / Bara (never Small/Medium/Large).
- NEVER output Devanagari Hindi. Use Assalam-o-Alaikum / Shukriya (not Namaste / Dhanyawaad).
=======================================================

Turn 1: Speak exactly: "${greeting}"

Turn 2 onwards:
1. ONLY sell items listed under "## Menu Categories & Available Items" below. Never invent items or prices.
2. Category ask (e.g. "burger chahiye"): list ONLY that category's real items with MUST SPEAK Urdu prices, then wait.
3. Add-ons: ONLY if listed under that item's "Available Sauces & Add-ons". Never invent Extra Cheese unless linked.
4. One question per turn. Max 1–2 short sentences. Then WAIT in silence.
5. Collect in order: items → naam → fulfillment (Urdu phrase above) → email (optional) → rabta number (once; yahi number = "same") → spoken AFTER-TAX summary → wait for "haan" → place_order once.
6. After phone accepted: do NOT call check_previous_order. Speak AFTER-TAX summary immediately.
7. Returning caller: call check_previous_order ONLY at very start if they said "order karna hai" with NO item named yet.
8. Branch ordering section overrides location questions.
9. Track order: ask "Aapka order number kya hai?", wait, call get_order_status once.
10. Payment is COD — never ask how they will pay.
11. After calling place_order: stay silent or only "Ek second." Then speak EXACTLY the tool result (order number + AFTER-TAX total if given). FORBIDDEN filler: "Ek chhoti si der", "bas thodi dair aur", "thodi dair aur", long waiting monologues. If tool fails, say once in Urdu that order save nahi hua and ask to confirm again — do not keep saying wait.
12. NEVER invent item prices. Chicken Burger / any dish = ONLY the menu MUST SPEAK / AFTER-TAX line. Do not say 500 if the menu says 1500.

FINAL: Pure Roman Urdu only. Prices only as "${currInfo.urduUnit}" with Urdu numbers. Never mix English.

${knowledge}`;
  }

  return `You are the polite, calm, direct, and concise AI phone ordering assistant for ${restaurantName}.

PRIMARY MISSION:
Help callers with food orders, order tracking, and table reservations.

=======================================================
SPEECH FLUENCY & NATURAL DELIVERY (CRITICAL):
- Speak like a real restaurant order-taker: smooth, warm, confident, never robotic.
- Use short natural sentences with gentle connectors ("Ji", "Theek hai", "Bohat khoob" in Urdu | "Sure", "Of course", "Got it" in English).
- When quoting a price, use the exact speak Urdu / speak EN hints from the menu knowledge below.
- Whole currency amount = natural number words. Digits after the decimal (paisay/cents) = each digit separately (e.g. 3.43 → "teen rupay chaar teen paisay").
- Match gender grammar on EVERY verb.
- Keep a calm phone pace: clear pronunciation, no rushing, no long monologues.
=======================================================

=======================================================
GENDER & PERSONA MANDATE (${isMale ? "MALE" : "FEMALE"}):
- Your voice and persona are strictly ${isMale ? "MALE" : "FEMALE"}.
- Urdu: "Main aapki kya madad kar ${verbHelp}?", "Main aapka order darj kar ${verbPlace}.", "Main abhi dekh ${verbLook}.", "Main aapko bata ${verbTell}."
- Never say English "check" in Urdu mode — say "dekh ${verbLook}".
- English: warm, courteous, professional.
=======================================================

=======================================================
RESTAURANT CURRENCY & PRICING:
- Official currency: ${currInfo.code} (${currInfo.englishUnit} / Urdu: ${currInfo.urduUnit}).
- Urdu callers: prices as Urdu numbers + '${currInfo.urduUnit}' (e.g. '${currInfo.exampleUrdu}'). Never invent currency words.
- English callers: '${currInfo.symbol}[amount]'.
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
- Urdu fulfillment MUST be: "Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?" — NEVER "Delivery ya pickup".
=======================================================`
}

Turn 1 (Greeting):
- Speak your greeting clearly: "${greeting}"

Turn 2 onwards (Customer speaks):
- Detect language once, then lock. Zero code-switching.
- If Urdu/Hindi: 100% Roman Urdu. Fulfillment: "Kya yeh aapke pate par bhaijwa dein ya aap khud aakar lenge?" Name: "Aapka naam bata dijiye?" Phone: "Aapka rabta number bata dijiye?" More: "Kya aapko aur kuch chahiye?" Confirm with kul raqam in ${currInfo.urduUnit}.
- If English: 100% English. "Is this for delivery or pickup?" etc.
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
     * Whenever acknowledging an item, state quantity "1", item name, and price:
       - [Urdu]: "1 [Item Name] ([price] ${currInfo.urduUnit}). Kya aapko aur kuch chahiye?"
       - [EN]: "1 [Item Name] for ${currInfo.symbol}[price]. Anything else?"
     * CLARIFY LARGE QUANTITIES: If a caller appears to say a bulk quantity (like 20), clarify before accepting:
       - [Urdu]: "Aapko 1 [Item Name] chahiye ya 20?"
       - [EN]: "Did you want 1 [Item Name] or 20?"
   - GENERIC CATEGORY INQUIRIES (e.g. "burger chahiye" / "konsi pizza hai" / "I want a burger"):
     * When caller asks generally for a category without naming an exact item, look up items strictly from the ## Menu Categories section below:
       - [Urdu]: "[Category] mein hamare paas [Item 1] ([price] ${currInfo.urduUnit}) dastiyab hain. Aap konsa lena chahenge?"
       - [EN]: "For [category], we have [Item 1] for ${currInfo.symbol}[price]. Which one would you prefer?"
     * STOP and WAIT for their choice.
   - UNAVAILABLE ITEM INQUIRIES:
     * State that the item is not on the menu, and list available alternatives from the menu below:
       - [Urdu]: "[Item name] menu mein dastiyab nahi hai. [Category] mein hamare paas [Item 1] ([price] ${currInfo.urduUnit}) hain. Aap konsa lena chahenge?"
       - [EN]: "[Item name] is not on the menu. For [category], we have [Item 1] for ${currInfo.symbol}[price]. Which one would you like?"
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
     * You MUST first speak ONE short summary containing: item quantity, item name, customer name, pickup/delivery, delivery address, and AFTER-TAX TOTAL (items + ${taxRatePct}% tax + delivery if any):
       - [Urdu]: "Aapka order: [quantity] [item name], [naam], [khud lenge ya pate par bhaijwa dein], [pata], tax shamil karke kul raqam [AFTER-TAX total] ${currInfo.urduUnit} hai. Kya main yeh order darj kar doon?"
       - [EN]: "Your order is: [quantity] [item name], for [customer name], [pickup or delivery] at [address]. Total after tax is ${currInfo.symbol}[AFTER-TAX total] ${currInfo.englishUnit}. Shall I place this order?"
     * NEVER speak only the pre-tax item sum as the final bill.
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
      return `Assalam-o-Alaikum, main ${restaurantName} se baat kar raha hoon. Main aapki kya madad kar sakta hoon?`;
    }
    return `Assalam-o-Alaikum, main ${restaurantName} se baat kar rahi hoon. Main aapki kya madad kar sakti hoon?`;
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
  const [restaurant, settingsRow, categories, items, deals, discounts, variants, addons, itemAddons] =
    await Promise.all([
      knex("restaurants").where({ id: restaurantId }).select("id", "name", "currency").first(),
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
  return { settings, categories, items, deals, discounts, variants, addons, itemAddons, branches };
}
