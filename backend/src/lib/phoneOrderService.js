import { branchArea, matchBranchChoice } from "./branchLocation.js";
import { normalizeE164 } from "./voiceWebhookUtils.js";
import { geocodeAddress, haversineDistanceKm } from "./geocoding.js";
import { nextOrderNumber } from "./orderNumbers.js";
import { notifyNewOrderLater } from "./orderAlerts.js";
import {
  createReservation,
  findAvailableTable,
  parseReservationDate,
  parseReservationTime,
} from "./tableReservationService.js";

/** Menu lines and spoken item names that are a table booking, not food. */
export function isTableReservationLine(name) {
  return /table\s*reserv|reserv\w*\s+(a\s+)?table|book\w*\s+(a\s+)?table/i.test(String(name || ""));
}

function reservationDetailsFromText(text) {
  const raw = String(text || "");
  const guests = raw.match(/(\d+)\s*guests?/i);
  const dateMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
  const timeMatch = raw.match(/\bat\s+([0-2]?\d[:.][0-5]\d(?:\s*[ap]\.?m\.?)?)/i);
  const clock = timeMatch ? timeMatch[1] : raw.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/)?.[0];
  return {
    partySize: guests ? Math.max(1, parseInt(guests[1], 10) || 1) : 2,
    reservationDate: parseReservationDate(dateMatch ? dateMatch[1] : "today"),
    startTime: parseReservationTime(clock || ""),
  };
}

/**
 * Turn a "Table Reservation for N guests on DATE at TIME" line into a real reservation.
 * Does not create a priced order.
 */
async function bookReservationInsteadOfOrder(knex, {
  restaurantId,
  customer_name,
  customer_phone,
  customer_email,
  call_id,
  source,
  lines,
}) {
  const combined = lines.map((l) => l.name).join(" ");
  const details = reservationDetailsFromText(combined);
  if (!details.startTime) {
    return { reservation: null, reservationError: "missing_time" };
  }

  if (call_id) {
    const existing = await knex("table_reservations").where({ call_id }).orderBy("created_at", "desc").first();
    if (existing) {
      const table = existing.table_id
        ? await knex("restaurant_tables").where({ id: existing.table_id }).select("table_number").first()
        : null;
      return {
        reservation: { ...existing, table_number: table?.table_number || null },
        reservationError: null,
      };
    }
  }

  const phone = normalizeE164(customer_phone) || (customer_phone ? String(customer_phone) : null);
  if (phone) {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const recent = await knex("table_reservations")
      .where({
        restaurant_id: restaurantId,
        reservation_date: details.reservationDate,
        customer_phone: phone,
      })
      .whereIn("status", ["pending", "confirmed", "seated"])
      .andWhere("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .first();
    if (recent) {
      const table = recent.table_id
        ? await knex("restaurant_tables").where({ id: recent.table_id }).select("table_number").first()
        : null;
      return {
        reservation: { ...recent, table_number: table?.table_number || null },
        reservationError: null,
      };
    }
  }

  const availableTable = await findAvailableTable(knex, {
    restaurantId,
    partySize: details.partySize,
    reservationDate: details.reservationDate,
    startTime: details.startTime,
    slotDurationHours: 1,
  });
  if (!availableTable) {
    return { reservation: null, reservationError: "unavailable" };
  }

  const row = await createReservation(knex, {
    restaurantId,
    tableId: availableTable.id,
    customerName: customer_name,
    customerPhone: phone,
    customerEmail: customer_email || null,
    partySize: details.partySize,
    reservationDate: details.reservationDate,
    startTime: details.startTime,
    slotDurationHours: 1,
    status: "confirmed",
    notes: combined,
    source: source || "phone",
    callId: call_id || null,
    aiExtractedData: { from: "place_order_reservation_line", text: combined },
  });

  return {
    reservation: { ...row, table_number: availableTable.table_number },
    reservationError: null,
  };
}

/**
 * Find the nearest active branch for a parent restaurant within service radius.
 * @param {import("knex").Knex} knex
 * @param {string} parentRestaurantId
 * @param {number} deliveryLat
 * @param {number} deliveryLng
 * @returns {Promise<{ branch: any; distance: number } | null>}
 */
export async function findNearestBranch(knex, parentRestaurantId, deliveryLat, deliveryLng) {
  if (!parentRestaurantId || !Number.isFinite(deliveryLat) || !Number.isFinite(deliveryLng)) {
    return null;
  }

  const branches = await knex("restaurants")
    .where({ parent_restaurant_id: parentRestaurantId, is_accepting_orders: true, is_active: true })
    .whereNotNull("latitude")
    .whereNotNull("longitude");

  let nearest = null;
  let minDistance = Infinity;

  for (const branch of branches) {
    const distance = haversineDistanceKm(deliveryLat, deliveryLng, branch.latitude, branch.longitude);
    const radius = Number(branch.service_radius_km || 5.0);
    if (distance <= radius && distance < minDistance) {
      minDistance = distance;
      nearest = branch;
    }
  }

  return nearest ? { branch: nearest, distance: minDistance } : null;
}

/**
 * Normalize common speech-to-text phonetic mistakes in item names.
 * In Hindi/Urdu, "Beef" sounds like "20", "बीस", "bees".
 */
export function normalizeSpokenItemName(rawName) {
  let s = String(rawName || "").trim();
  s = s.replace(/\b(the\s+)?og\s*(20|twenty|बीस|bees)\b/gi, "The OG Beef");
  s = s.replace(/\boklahoma\s*(20|twenty|बीस|bees)\b/gi, "Oklahoma Beef");
  s = s.replace(/\b(20|twenty|बीस|bees)\s+burger\b/gi, "The OG Beef");
  return s;
}

/**
 * Parse free-text item lists from AI extractors into { name, quantity, notes? }[].
 * Examples: "2 Burgers, 1 Coke" | "Burger x2 and Fries"
 * @param {unknown} raw
 * @returns {{ name: string; quantity: number; notes?: string | null }[]}
 */
export function parseOrderItemsText(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((it) => {
        if (!it) return null;
        if (typeof it === "string") return parseOrderItemsText(it)[0] || null;
        let name = String(it.name || it.item_name || it.item || "").trim();
        if (!name) return null;
        let quantity = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);

        // Safeguard: if quantity is 20 and item is a beef burger, "20" was the word "Beef" from "OG 20"
        if (quantity === 20 && (/\b(og|beef|oklahoma|burger)\b/i.test(name) || /\b(20|बीस)\b/.test(name))) {
          quantity = 1;
        }
        name = normalizeSpokenItemName(name);

        return {
          name,
          quantity,
          notes: it.notes != null ? String(it.notes) : null,
        };
      })
      .filter(Boolean);
  }

  if (raw == null) return [];
  let itemStr = String(raw).trim();
  if (!itemStr) return [];

  // STT Hindi/Urdu phonetic confusion: caller said "Beef burger" or "OG Beef", transcribed as "20 burger" or "20 The OG Beef"
  if (/^20\s+(the\s+)?og\b/i.test(itemStr) || /^20\s+burger\b/i.test(itemStr) || /^20\s+oklahoma\b/i.test(itemStr) || /^(बीस|20)\s+बर्गर/i.test(itemStr)) {
    itemStr = itemStr.replace(/^20\s+/i, "1 ");
    itemStr = itemStr.replace(/^(बीस|20)\s+/i, "1 ");
  }
  itemStr = normalizeSpokenItemName(itemStr);

  // Prefer explicit separators over "and"
  const parts = itemStr
    .split(/,|;|\band\b/i)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const match =
        part.match(/^(\d+)\s*[xX×]?\s+(.+)$/) ||
        part.match(/^(.+?)\s+[xX×]\s*(\d+)$/) ||
        part.match(/^(.+?)\s*\((\d+)\)$/);
      if (match) {
        const a = match[1];
        const b = match[2];
        const qtyA = parseInt(a, 10);
        if (!Number.isNaN(qtyA) && String(qtyA) === a.trim()) {
          let name = b.trim();
          let qty = Math.max(1, qtyA);
          if (qty === 20 && (/\b(og|beef|oklahoma|burger)\b/i.test(name) || /\b(20|बीस)\b/.test(name))) {
            qty = 1;
          }
          return { name: normalizeSpokenItemName(name), quantity: qty, notes: null };
        }
        const qtyB = parseInt(b, 10);
        let name = a.trim();
        let qty = Math.max(1, qtyB || 1);
        if (qty === 20 && (/\b(og|beef|oklahoma|burger)\b/i.test(name) || /\b(20|बीस)\b/.test(name))) {
          qty = 1;
        }
        return { name: normalizeSpokenItemName(name), quantity: qty, notes: null };
      }
      return { name: normalizeSpokenItemName(part), quantity: 1, notes: null };
    })
    .filter((it) => it.name);
}

/**
 * Match items to menu and compute line totals, factoring in flavors, sizes, and add-ons.
 */
export function matchMenuLines(menu, items, variants = [], addons = [], itemAddons = [], deals = []) {
  const lines = [];
  const unmatched = [];
  const outOfStock = [];

  const variantByItem = new Map();
  for (const v of variants || []) {
    if (v.is_active === false) continue;
    if (!variantByItem.has(v.menu_item_id)) variantByItem.set(v.menu_item_id, []);
    variantByItem.get(v.menu_item_id).push(v);
  }

  const addonById = new Map((addons || []).map((a) => [a.id, a]));
  const addonsByItem = new Map();
  for (const link of itemAddons || []) {
    if (!addonsByItem.has(link.menu_item_id)) addonsByItem.set(link.menu_item_id, []);
    const ad = addonById.get(link.menu_addon_id);
    if (ad && ad.is_active !== false) addonsByItem.get(link.menu_item_id).push(ad);
  }

  for (const it of items) {
    const qty = Math.max(1, Number(it.quantity ?? 1) || 1);
    const rawName = String(it.name || "").trim();
    const needle = rawName.toLowerCase();
    const notesStr = String(it.notes || "").toLowerCase();
    const combined = `${needle} ${notesStr}`.trim();

    // 1. Direct or substring match in menu_items
    let m = menu.find((x) => x.name.toLowerCase() === needle);
    if (!m) {
      m = menu.find(
        (x) => x.name.toLowerCase().includes(needle) || needle.includes(x.name.toLowerCase()),
      );
    }
    if (!m) {
      const normalized = normalizeSpokenItemName(needle).toLowerCase();
      if (normalized !== needle) {
        m = menu.find((x) => x.name.toLowerCase() === normalized || x.name.toLowerCase().includes(normalized));
      }
    }

    // 2. If not matched in menu_items, check if needle matches a flavor or variant (e.g. "Chicken Fajita", "Malai Boti")
    if (!m) {
      for (const v of variants || []) {
        if (v.is_active === false) continue;
        const vName = (v.name || "").toLowerCase().trim();
        if (vName && vName.length >= 3 && (needle.includes(vName) || vName.includes(needle))) {
          m = menu.find((x) => x.id === v.menu_item_id);
          if (m) break;
        }
      }
    }

    // 3. If matched with a menu_item:
    if (m) {
      const isUnavailable =
        m.is_available === false ||
        (m.track_inventory && Number(m.stock_quantity || 0) <= 0);

      if (isUnavailable) {
        outOfStock.push(m.name);
      }

      let price = Number(m.price || 0);
      const itemVars = variantByItem.get(m.id) || [];
      const itemAds = addonsByItem.get(m.id) || [];

      // Check for size match in needle or notes
      const sizes = itemVars.filter((v) => v.variant_type === "size");
      let matchedSize = null;
      for (const s of sizes) {
        const sName = (s.name || "").toLowerCase().trim();
        const sMeas = (s.measurement || "").toLowerCase().replace(/["\s]/g, "");
        if (
          (sName && (combined.includes(sName) || sName.includes(needle))) ||
          (sMeas && combined.replace(/["\s]/g, "").includes(sMeas))
        ) {
          matchedSize = s;
          price = Number(s.price || 0);
          break;
        }
      }

      // If item has sizes but no specific size was matched and base price is 0, pick the first size price
      if (sizes.length > 0 && !matchedSize && price <= 0) {
        price = Number(sizes[0].price || 0);
      }

      // Check for add-ons in needle or notes
      for (const ad of itemAds) {
        const adName = (ad.name || "").toLowerCase().trim();
        if (adName && adName.length >= 3 && combined.includes(adName)) {
          if (needle !== adName) {
            price += Number(ad.price || 0);
          }
        }
      }

      lines.push({
        menu_item_id: m.id,
        item_name: rawName || m.name,
        quantity: qty,
        unit_price: Number(price.toFixed(2)),
        line_total: Number((price * qty).toFixed(2)),
        notes: it.notes ?? null,
        matched: true,
        is_available: !isUnavailable,
      });
      continue;
    }

    // 4. Check if this is a standalone add-on (e.g. "Extra Cheese", "Creamy Garlic Dip")
    const matchedAddon = (addons || []).find((a) => {
      if (a.is_active === false) return false;
      const aName = (a.name || "").toLowerCase().trim();
      return aName && (aName === needle || needle.includes(aName) || aName.includes(needle));
    });

    if (matchedAddon) {
      const addonPrice = Number(matchedAddon.price || 0);
      lines.push({
        menu_item_id: null,
        item_name: rawName || matchedAddon.name,
        quantity: qty,
        unit_price: Number(addonPrice.toFixed(2)),
        line_total: Number((addonPrice * qty).toFixed(2)),
        notes: it.notes ?? null,
        matched: true,
        is_available: true,
      });
      continue;
    }

    // 5. Check if this is an active Deal (e.g. "Zinger Crave Deal", "Family Pizza Feast")
    const matchedDeal = (deals || []).find((d) => {
      if (d.is_active === false) return false;
      const dName = (d.name || "").toLowerCase().trim();
      return dName && (dName === needle || needle.includes(dName) || dName.includes(needle));
    });

    if (matchedDeal) {
      const dealPrice = Number(matchedDeal.price || 0);
      lines.push({
        menu_item_id: null,
        deal_id: matchedDeal.id,
        item_name: rawName || matchedDeal.name,
        quantity: qty,
        unit_price: Number(dealPrice.toFixed(2)),
        line_total: Number((dealPrice * qty).toFixed(2)),
        notes: it.notes ?? null,
        matched: true,
        is_available: true,
      });
      continue;
    }

    // 6. Unmatched item
    const fallbackUnitPrice = Number(it.unit_price || it.price || 0);
    unmatched.push(rawName);
    lines.push({
      menu_item_id: null,
      item_name: rawName,
      quantity: qty,
      unit_price: fallbackUnitPrice,
      line_total: Number((fallbackUnitPrice * qty).toFixed(2)),
      notes: it.notes ?? null,
      matched: false,
      is_available: true,
    });
  }
  return { lines, unmatched, outOfStock };
}

/**
 * Validate and compute coupon discount for a restaurant.
 * @returns {Promise<{ code: string | null; amount: number; discount_id?: string; error?: string }>}
 */
export async function applyCoupon(knex, { restaurantId, code, subtotal }) {
  const raw = String(code || "").trim();
  if (!raw) return { code: null, amount: 0 };

  const discount = await knex("discounts")
    .where({ restaurant_id: restaurantId })
    .andWhere((qb) => {
      qb.whereRaw("lower(code) = ?", [raw.toLowerCase()]);
    })
    .first();

  if (!discount || discount.is_active === false) {
    return { code: raw, amount: 0, error: "coupon_not_found_or_inactive" };
  }
  const expiresAt = discount.valid_to || discount.ends_at || discount.expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return { code: raw, amount: 0, error: "coupon_expired" };
  }
  const startsAt = discount.valid_from || discount.starts_at;
  if (startsAt && new Date(startsAt) > new Date()) {
    return { code: raw, amount: 0, error: "coupon_not_started" };
  }
  if (discount.max_uses != null && Number(discount.used_count || 0) >= Number(discount.max_uses)) {
    return { code: raw, amount: 0, error: "coupon_max_uses" };
  }
  const minOrder = Number(discount.min_order_amount || 0);
  if (subtotal < minOrder) {
    return { code: raw, amount: 0, error: "below_min_order" };
  }

  const type = String(discount.discount_type || "percentage").toLowerCase();
  const value = Number(discount.value ?? discount.discount_value ?? 0);
  let amount = 0;
  if (type === "fixed") amount = value;
  else amount = (subtotal * value) / 100;

  amount = Math.max(0, Math.min(subtotal, Number(amount.toFixed(2))));
  return { code: discount.code, amount, discount_id: discount.id };
}

function pickNamedBranch(branches, branchName) {
  return matchBranchChoice(branches, branchName);
}

/**
 * Create a phone/AI order with menu matching + optional coupon.
 * @param {import("knex").Knex} knex
 * @param {object} input
 */
export async function createPhoneOrder(knex, input) {
  const {
    restaurantId,
    customer_name,
    customer_phone,
    customer_email,
    delivery_address,
    delivery_notes,
    items,
    coupon_code,
    payment_method,
    fulfillment_type,
    call_id,
    source = "phone",
    ai_extracted_data,
    delivery_latitude,
    delivery_longitude,
    branch_name,
  } = input;

  if (!restaurantId) throw new Error("restaurantId is required");
  if (!customer_name) throw new Error("customer_name is required");

  const parsedItems = parseOrderItemsText(items);
  if (!parsedItems.length) throw new Error("No order items to place");

  const reservationLines = parsedItems.filter((it) => isTableReservationLine(it.name));
  const foodItems = parsedItems.filter((it) => !isTableReservationLine(it.name));
  let bookedReservation = null;
  let reservationError = null;
  if (reservationLines.length) {
    const booked = await bookReservationInsteadOfOrder(knex, {
      restaurantId,
      customer_name,
      customer_phone,
      customer_email,
      call_id,
      source,
      lines: reservationLines,
    });
    bookedReservation = booked.reservation;
    reservationError = booked.reservationError;
  }

  const emptyTotals = { subtotal: 0, tax: 0, deliveryFee: 0, discount: 0, total: 0 };
  if (!foodItems.length) {
    return {
      order: null,
      reservation: bookedReservation,
      reservationError,
      unmatched: [],
      coupon: { code: null, amount: 0 },
      targetRestaurantId: restaurantId,
      assignmentStatus: "assigned",
      totals: emptyTotals,
    };
  }

  const isPickup = String(fulfillment_type || "delivery").toLowerCase() === "pickup";

  // Geocode address if needed
  let lat = Number.isFinite(Number(delivery_latitude)) ? Number(delivery_latitude) : null;
  let lng = Number.isFinite(Number(delivery_longitude)) ? Number(delivery_longitude) : null;
  if (!isPickup && (lat == null || lng == null) && delivery_address) {
    const geo = await geocodeAddress(delivery_address);
    if (geo) {
      lat = geo.latitude;
      lng = geo.longitude;
    }
  }

  // Always resolve branches under the PARENT so orders land on the correct child branch.
  const restaurantRow = await knex("restaurants")
    .where({ id: restaurantId })
    .select("id", "name", "parent_restaurant_id", "is_branch")
    .first();
  const parentRestaurantId = restaurantRow?.parent_restaurant_id || restaurantId;
  const branches = await knex("restaurants")
    .where({ parent_restaurant_id: parentRestaurantId, is_active: true });

  let targetRestaurantId = restaurantId;
  let autoAssigned = false;
  let assignedBranchDistanceKm = null;
  let branchAssignedAt = null;
  let assignmentStatus = "assigned";
  let assignedBranchName = null;
  const rawBranch = String(branch_name || "").trim();
  const branchRequested =
    !!rawBranch && !["none", "null", "n/a", "na", "any", "no", "no preference"].includes(rawBranch.toLowerCase());

  // Try branch_name, then free-text area labels the agent often sends instead of exact names.
  const spokenCandidates = [
    branch_name,
    input.area,
    input.branch,
    input.branch_area,
    delivery_notes,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  let chosenBranch = null;
  for (const spoken of spokenCandidates) {
    chosenBranch = pickNamedBranch(branches, spoken);
    if (chosenBranch) break;
  }

  // Single accepting branch → auto-assign when the caller did not name one clearly.
  const accepting = branches.filter((b) => b.is_accepting_orders !== false);
  if (!chosenBranch && accepting.length === 1 && (isPickup || !branchRequested)) {
    chosenBranch = accepting[0];
  }

  console.log(
    `🏪 Branch resolve: parent=${parentRestaurantId} spoken=${JSON.stringify(spokenCandidates)} ` +
      `matched=${chosenBranch?.name || "NONE"} branches=${branches.map((b) => b.name).join(" | ")}`,
  );

  if (chosenBranch) {
    targetRestaurantId = chosenBranch.id;
    assignedBranchName = chosenBranch.name;
    branchAssignedAt = new Date();
    autoAssigned = true;
    assignmentStatus = "assigned";
  } else if (branches.length > 0 && (isPickup || branchRequested)) {
    // Pickup / named area must map to a real branch — do not park on parent HQ.
    const areas = [...new Set(branches.map((b) => branchArea(b)).filter(Boolean))];
    const err = new Error(
      `Could not match branch "${rawBranch || spokenCandidates[0] || "(missing)"}". Ask the caller which area: ${areas.join(" or ")}.`,
    );
    err.isBranchError = true;
    err.availableAreas = areas;
    err.requestedBranch = rawBranch || spokenCandidates[0] || null;
    throw err;
  } else if (branches.length > 0 && !isPickup) {
    if (lat != null && lng != null) {
      const nearest = await findNearestBranch(knex, parentRestaurantId, lat, lng);
      if (nearest) {
        targetRestaurantId = nearest.branch.id;
        assignedBranchName = nearest.branch.name;
        assignedBranchDistanceKm = nearest.distance;
        branchAssignedAt = new Date();
        autoAssigned = true;
        assignmentStatus = "assigned";
      } else {
        targetRestaurantId = parentRestaurantId;
        assignmentStatus = "unassigned_out_of_range";
        autoAssigned = false;
      }
    } else {
      targetRestaurantId = parentRestaurantId;
      assignmentStatus = "needs_review";
      autoAssigned = false;
    }
  } else if (restaurantRow?.is_branch) {
    // Tool resolved to a branch with no siblings listed — keep order on that branch.
    targetRestaurantId = restaurantId;
    assignedBranchName = restaurantRow.name;
    assignmentStatus = "assigned";
  }

  let menu = await knex("menu_items")
    .where({ restaurant_id: targetRestaurantId })
    .select("id", "name", "price", "is_available", "track_inventory", "stock_quantity");

  let effectiveMenuRestId = targetRestaurantId;
  if (!menu.length) {
    const targetRest = await knex("restaurants").where({ id: targetRestaurantId }).first();
    if (targetRest?.is_branch && targetRest.parent_restaurant_id) {
      effectiveMenuRestId = targetRest.parent_restaurant_id;
      menu = await knex("menu_items")
        .where({ restaurant_id: targetRest.parent_restaurant_id })
        .select("id", "name", "price", "is_available", "track_inventory", "stock_quantity");
    }
  }

  const menuItemIds = menu.map((m) => m.id);
  const [variants, addons, itemAddons, deals] = await Promise.all([
    menuItemIds.length
      ? knex("menu_item_variants").whereIn("menu_item_id", menuItemIds).andWhere({ is_active: true })
      : [],
    knex("menu_addons").where({ restaurant_id: effectiveMenuRestId, is_active: true }),
    menuItemIds.length
      ? knex("menu_item_addons").whereIn("menu_item_id", menuItemIds)
      : [],
    knex("deals").where({ restaurant_id: effectiveMenuRestId, is_active: true }),
  ]);

  const settings = await knex("restaurant_settings").where({ restaurant_id: targetRestaurantId }).first();

  const { lines, unmatched, outOfStock } = matchMenuLines(menu, foodItems, variants, addons, itemAddons, deals);

  if (outOfStock.length > 0) {
    const err = new Error(`Item "${outOfStock.join(", ")}" is currently out of order / out of stock.`);
    err.outOfStock = outOfStock;
    err.isOutOfStock = true;
    throw err;
  }

  // Menu/price mismatch validation
  if (unmatched.length > 0 && assignmentStatus === "assigned") {
    assignmentStatus = "needs_review";
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);

  const coupon = await applyCoupon(knex, {
    restaurantId: targetRestaurantId,
    code: coupon_code,
    subtotal,
  });

  const taxRate = Number(settings?.tax_rate ?? 0) / 100;
  const deliveryFee = isPickup ? 0 : Number(settings?.delivery_fee ?? 0);
  const taxableBase = Math.max(0, subtotal - coupon.amount);
  const tax = Number((taxableBase * taxRate).toFixed(2));
  const total = Number((taxableBase + tax + deliveryFee).toFixed(2));

  const trackingCode = Math.random().toString(36).substr(2, 10).toUpperCase();

  const phone = normalizeE164(customer_phone) || String(customer_phone || "0000000000");
  const address = isPickup
    ? delivery_address || "Pickup"
    : delivery_address || "Address not provided";

  const result = await knex.transaction(async (trx) => {
    const orderNumber = await nextOrderNumber(trx, targetRestaurantId);
    const [order] = await trx("orders")
      .insert({
        restaurant_id: targetRestaurantId,
        order_number: orderNumber,
        tracking_code: trackingCode,
        customer_name: String(customer_name).trim(),
        customer_phone: phone,
        customer_email: customer_email ? String(customer_email).trim() : null,
        delivery_address: address,
        delivery_notes: delivery_notes || null,
        fulfillment_type: isPickup ? "pickup" : "delivery",
        source,
        status: "pending",
        payment_method: payment_method || "cash",
        payment_status: "pending",
        subtotal,
        tax_amount: tax,
        delivery_fee: deliveryFee,
        discount_amount: coupon.amount,
        discount_code: coupon.code,
        total_amount: total,
        call_id: call_id || null,
        auto_assigned: autoAssigned,
        delivery_latitude: lat,
        delivery_longitude: lng,
        assigned_branch_distance_km: assignedBranchDistanceKm,
        branch_assigned_at: branchAssignedAt,
        assignment_status: assignmentStatus,
        ai_extracted_data: {
          unmatched,
          coupon_error: coupon.error || null,
          target_branch_id: targetRestaurantId !== restaurantId ? targetRestaurantId : null,
          parent_restaurant_id: targetRestaurantId !== restaurantId ? restaurantId : null,
          requested_branch: branch_name || null,
          assigned_branch_name: assignedBranchName,
          ...(ai_extracted_data && typeof ai_extracted_data === "object" ? ai_extracted_data : {}),
        },
      })
      .returning("*");

    if (lines.length) {
      await trx("order_items").insert(
        lines.map((l) => ({
          order_id: order.id,
          menu_item_id: l.menu_item_id,
          item_name: l.item_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: l.line_total,
          notes: l.notes,
        })),
      );
    }

    if (coupon.discount_id && coupon.amount > 0) {
      await trx("discounts")
        .where({ id: coupon.discount_id })
        .update({ used_count: trx.raw("coalesce(used_count, 0) + 1") });
    }

    return order;
  });

  notifyNewOrderLater(knex, result);

  return {
    order: result,
    reservation: bookedReservation,
    reservationError,
    unmatched,
    coupon,
    targetRestaurantId,
    assignedBranchName,
    assignmentStatus,
    totals: { subtotal, tax, deliveryFee, discount: coupon.amount, total },
  };
}
