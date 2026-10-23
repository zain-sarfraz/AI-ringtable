function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function samePlace(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

/** Area the caller should hear. Falls back to the branch name. */
export function branchArea(branch) {
  const explicit = clean(branch?.area);
  if (explicit) return explicit;
  let name = clean(branch?.name);
  name = name
    .replace(/\bbranch\b/gi, "")
    .replace(/^royal restaurant\s*/i, "")
    .replace(/^royal\s*[-–]\s*/i, "")
    .trim();
  return name || clean(branch?.address) || clean(branch?.name);
}

/** City when one was saved, or the last part of an address such as "DHA, Lahore". */
export function branchCity(branch) {
  const explicit = clean(branch?.city);
  if (explicit) return explicit;
  const parts = clean(branch?.address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  const last = parts[parts.length - 1].replace(/\d+/g, "").trim();
  if (!last || last.length < 3) return "";
  if (/phase|town|sector|street|road|colony|blvd|block/i.test(last)) return "";
  return last;
}

/**
 * How the phone agent should ask for a pickup order or a table reservation.
 * Several cities: ask city, then area. One city: ask area only.
 */
export function branchQuestionPlan(branches) {
  const list = (branches || []).filter((branch) => clean(branch?.name) || branchArea(branch));
  const located = list.map((branch) => ({
    branch,
    city: branchCity(branch),
    area: branchArea(branch),
    name: clean(branch.name),
  }));
  const cities = [...new Set(located.map((row) => row.city).filter(Boolean).map((city) => city.toLowerCase()))];
  const byCity = new Map();
  for (const row of located) {
    const key = row.city || "";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(row);
  }
  return {
    rows: located,
    multiCity: cities.length > 1,
    cities: [...byCity.entries()].map(([cityKey, rows]) => ({
      city: rows.find((row) => row.city)?.city || cityKey,
      rows,
    })),
  };
}

export function branchOrderingSection(branches) {
  const plan = branchQuestionPlan(branches);
  if (!plan.rows.length) {
    return [
      "## Branch ordering",
      "This restaurant has NO branches and NO areas list.",
      "ABSOLUTE: Never ask which city, which area, which branch, or which location.",
      "Never invent an area name, \"branch 2\", \"Main Branch\", or any city. Never say \"just tell me the area\".",
      "After delivery vs pickup: if delivery, ask only for the street address; if pickup, skip address and continue to email/phone.",
      "Always pass branch_name as exactly none to place_order and reserve_table.",
    ].join("\n");
  }

  if (plan.rows.length === 1) {
    const only = plan.rows[0];
    return [
      "## Branch ordering",
      "This section overrides any older line about when to ask for a branch or area.",
      "Use this for DELIVERY orders, PICKUP orders, and TABLE RESERVATIONS.",
      "Do not ask this when the caller only wants to track an order.",
      `There is one active location: ${only.area}${only.city ? `, ${only.city}` : ""}.`,
      "Do not ask for a city, an area, or which branch.",
      `Pass branch_name as "${only.name}".`,
      "DELIVERY: still collect the street address (server keeps this single branch).",
      "PICKUP: do not ask for a street address.",
    ].join("\n");
  }

  const areaExamples = plan.rows.map((row) => row.area).filter(Boolean).slice(0, 3);
  const lines = [
    "## Branch ordering",
    "This section overrides any older line about when to ask for a branch or area.",
    "Use this for DELIVERY orders, PICKUP orders, and TABLE RESERVATIONS.",
    "Do not ask this when the caller only wants to track an order.",
    "DELIVERY: Do NOT ask which city, area, or branch. Ask only for the complete delivery address and accept it on the first try. Pass branch_name as exactly none. The server assigns the nearest active branch from the address.",
    "PICKUP and TABLE RESERVATIONS: Ask which location using ONLY the configured list below. Never invent areas that are not listed below.",
  ];

  if (plan.multiCity) {
    const cityNames = plan.cities.map((group) => group.city).filter(Boolean);
    lines.push("For pickup/table only — branches are in more than one city. Ask for the city first, then the area. Ask one question, then stop and wait.");
    lines.push(`Ask: "Which city would you like: ${cityNames.join(" or ")}?"`);
    for (const group of plan.cities) {
      const areas = group.rows.map((row) => row.area).filter(Boolean);
      lines.push(`After they choose ${group.city || "that city"}, ask: "Which area: ${areas.join(" or ")}?" Then stop and wait.`);
      for (const row of group.rows) {
        lines.push(`- ${group.city ? `${group.city}, ` : ""}${row.area} → branch_name "${row.name}"`);
      }
    }
  } else {
    const city = plan.cities.find((group) => group.city)?.city || "";
    const areas = plan.rows.map((row) => row.area).filter(Boolean);
    lines.push(
      city
        ? `For pickup/table only — all branches are in ${city}. Ask for the area only. Do not ask which city.`
        : "For pickup/table only — these branches are in the same city. Ask for the area only. Do not ask which city.",
    );
    lines.push(`Ask: "Which area would you like: ${areas.join(" or ")}?" Then stop and wait.`);
    for (const row of plan.rows) {
      lines.push(`- ${row.area} → branch_name "${row.name}"`);
    }
  }

  lines.push("For a pickup order, do not ask for a street address.");
  lines.push("Ask the pickup/table area in the caller's locked language.");
  lines.push(
    areaExamples.length
      ? `On place_order / reserve_table for pickup or table: set branch_name to the exact quoted branch name OR the area label from this list (e.g. ${areaExamples.join(", ")}). The server matches both.`
      : "On place_order / reserve_table for pickup or table: set branch_name to the exact quoted branch name from this list.",
  );
  lines.push("Use only a city and area from this list. Never invent a city, area, or branch.");
  lines.push("Never pass none after they choose a pickup/table area. Never skip branch_name on pickup.");
  return lines.join("\n");
}

/** Parent restaurant id, or the chosen branch when the caller named a city or area. */
export async function resolveSpokenBranchId(knex, restaurantId, spoken) {
  if (!restaurantId) return restaurantId;
  const restaurant = await knex("restaurants").where({ id: restaurantId }).select("id", "parent_restaurant_id").first();
  const parentId = restaurant?.parent_restaurant_id || restaurantId;
  const branches = await knex("restaurants").where({ parent_restaurant_id: parentId, is_active: true });
  const chosen = matchBranchChoice(branches, spoken);
  return chosen?.id || restaurantId;
}

/** Normalize area/branch labels for fuzzy spoken matching. */
function normalizeBranchLabel(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/\b(branch|restaurant|royal|the|its|it's|is)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Common STT mishears for Lahore areas (e.g. "Johar Town" → "party town").
 * Keys are normalized fragments; values are the canonical area tokens to inject.
 */
const AREA_STT_ALIASES = [
  { match: /\b(party|johar|johur|johar'?s|jawar|joher)\s*(town)?\b/i, inject: "johar town" },
  { match: /\b(iqbal|ikbal|eqbal)\s*(town)?\b/i, inject: "iqbal town" },
  { match: /\b(kashmir|kashmer|cashmere)\s*(road|rd)?\b/i, inject: "kashmir road" },
];

function applyAreaAliases(spoken) {
  const original = String(spoken || "");
  const text = normalizeBranchLabel(original);
  for (const alias of AREA_STT_ALIASES) {
    if (alias.match.test(text) || alias.match.test(original)) {
      return normalizeBranchLabel(alias.inject);
    }
  }
  return text;
}

/** Match a spoken branch, area, or "city area" to one open branch. */
export function matchBranchChoice(branches, spoken) {
  const raw = applyAreaAliases(spoken);
  if (!raw || ["none", "null", "n/a", "na", "any", "no", "no preference"].includes(raw)) return null;
  const open = (branches || []).filter((branch) => branch && branch.is_accepting_orders !== false && branch.is_active !== false);
  // Unique tokens only — duplicate "town" must not make every *Town branch look like a match.
  const spokenTokens = [...new Set(raw.split(" ").filter((t) => t.length > 1))];

  const scored = open
    .map((branch) => {
      const city = normalizeBranchLabel(branchCity(branch));
      const area = normalizeBranchLabel(branchArea(branch));
      const name = normalizeBranchLabel(branch.name);
      const labels = [name, area, city, clean(branch.name).toLowerCase(), branchArea(branch).toLowerCase()]
        .filter(Boolean);
      if (city && area) labels.push(`${city} ${area}`, `${area} ${city}`);

      let score = 0;
      for (const label of labels) {
        const norm = normalizeBranchLabel(label);
        if (!norm) continue;
        if (norm === raw || raw === area || raw === name) score = Math.max(score, 5);
        else if (area && (raw === area || raw.includes(area) || area.includes(raw))) score = Math.max(score, 4);
        else if (raw.includes(norm) || norm.includes(raw)) score = Math.max(score, norm.length > 3 ? 3 : 0);
        else if (spokenTokens.length) {
          const labelTokens = new Set(norm.split(" ").filter((t) => t.length > 1));
          // Ignore ultra-common tokens that every *Town / *Road branch shares.
          const meaningful = spokenTokens.filter((t) => !["town", "road", "phase", "area"].includes(t));
          const overlap = meaningful.filter((t) => labelTokens.has(t)).length;
          if (overlap >= 1 && meaningful.some((t) => t.length >= 4 && labelTokens.has(t))) {
            score = Math.max(score, overlap >= 2 ? 3 : 2);
          }
        }
      }
      return { branch, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || clean(b.branch.name).length - clean(a.branch.name).length);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score && !samePlace(scored[0].branch.name, scored[1].branch.name)) {
    return null;
  }
  return scored[0].branch;
}
