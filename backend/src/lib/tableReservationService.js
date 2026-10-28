import { randomUUID } from "node:crypto";
import { resolveRestaurantFamilyIds, normalizeTableNumber } from "./tableSessions.js";
import { notifyNewReservationLater } from "./orderAlerts.js";

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const URDU_MONTH_MAP = {
  january: 1, jan: 1, janwary: 1, janwari: 1, janver: 1, "जनवरी": 1,
  february: 2, feb: 2, farwary: 2, farwari: 2, "फ़रवरी": 2, "फरवरी": 2,
  march: 3, mar: 3, "मार्च": 3,
  april: 4, apr: 4, aprel: 4, "अप्रैल": 4, "अप्रेल": 4,
  may: 5, mai: 5, "मई": 5,
  june: 6, jun: 6, joon: 6, "जून": 6,
  july: 7, jul: 7, julai: 7, "जुलाई": 7,
  august: 8, aug: 8, agast: 8, "अगस्त": 8,
  september: 9, sep: 9, sept: 9, sitambar: 9, sitamber: 9, "सितंबर": 9, "सितम्बर": 9,
  october: 10, oct: 10, aktoobar: 10, aktoober: 10, aktubar: 10, oktobar: 10, "अक्टूबर": 10, "अक्तूबर": 10,
  november: 11, nov: 11, nawambar: 11, nawamber: 11, navambar: 11, navamber: 11, "नवंबर": 11, "नवम्बर": 11,
  december: 12, dec: 12, disambar: 12, disamber: 12, "दिसंबर": 12, "दिसम्बर": 12,
};

/** Parse "today" / "tomorrow" / Urdu / Roman Urdu / ISO dates without UTC day-shift. */
export function parseReservationDate(raw) {
  if (raw == null) return localDateStr();
  const rawStr = String(raw).trim();
  if (!rawStr) return localDateStr();
  const s = rawStr.toLowerCase();
  const today = new Date();

  // Relative dates
  if (/^(today|tonight|now|aaj|aaj\s*ki|aaj\s*ka)$/i.test(s) || s === "aaj") {
    return localDateStr(today);
  }
  if (/^(tomorrow|kal|agle\s*din|agli\s*subah)$/i.test(s) || (/\bkal\b/i.test(s) && !/\baaj\b/i.test(s))) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }
  if (/^(parson|parso|day\s*after\s*tomorrow|tarson|tarso)$/i.test(s) || /\b(parson|parso)\b/i.test(s)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return localDateStr(d);
  }

  // ISO: YYYY-MM-DD
  const iso = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }

  // Month names in English / Roman Urdu / Devanagari
  // E.g. "28 Aktoobar 2026", "28 October", "Uh, 28 Aktoobar 2026", "October 28 2026", "28th Oct"
  const monthNamesPattern = Object.keys(URDU_MONTH_MAP).join("|");
  const m1 = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNamesPattern})(?:\\s+(\\d{4}))?\\b`, "i"));
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthNum = URDU_MONTH_MAP[m1[2].toLowerCase()];
    const year = m1[3] ? parseInt(m1[3], 10) : today.getFullYear();
    if (day >= 1 && day <= 31 && monthNum) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const m2 = s.match(new RegExp(`\\b(${monthNamesPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`, "i"));
  if (m2) {
    const monthNum = URDU_MONTH_MAP[m2[1].toLowerCase()];
    const day = parseInt(m2[2], 10);
    const year = m2[3] ? parseInt(m2[3], 10) : today.getFullYear();
    if (day >= 1 && day <= 31 && monthNum) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Fallback to standard JS Date
  const parsed = new Date(rawStr);
  if (!Number.isNaN(parsed.getTime())) return localDateStr(parsed);

  return localDateStr(today);
}

const HOUR_WORDS = {
  ek: 1, one: 1,
  do: 2, two: 2,
  teen: 3, three: 3,
  chaar: 4, char: 4, four: 4,
  paanch: 5, panch: 5, five: 5,
  chhe: 6, che: 6, six: 6,
  saat: 7, seven: 7,
  aath: 8, ath: 8, eight: 8,
  nau: 9, no: 9, nine: 9,
  das: 10, ten: 10,
  gyarah: 11, eleven: 11,
  barah: 12, twelve: 12,
  noon: 12,
  midnight: 0,
};

function ampmFrom(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(a\.?m\.?|subah|fajar|morning)\b/i.test(s)) return "am";
  if (/\b(p\.?m\.?|dopahar|afternoon|shaam|evening|raat|night|isha)\b/i.test(s)) return "pm";
  return null;
}

function toHHMM(h, min, ampm) {
  if (!Number.isFinite(h) || h > 23 || h < 0) return null;
  let minutes = Number.isFinite(min) ? min : 0;
  if (minutes > 59 || minutes < 0) minutes = 0;
  if (ampm === "pm" && h < 12) h += 12;
  else if (ampm === "am" && h === 12) h = 0;
  else if (!ampm && h >= 1 && h <= 11) h += 12;
  return `${String(h).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Parse spoken/agent times to HH:MM 24-hour.
 * "4 Baje", "4", "four", "chaar baje", "7 PM" → 16:00, 19:00.
 */
export function parseReservationTime(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 6 && !/\d{1,2}[:.]\d{2}/.test(text) && !/\b(a\.?m\.?|p\.?m\.?)\b/i.test(text)) {
    return null;
  }

  const ampm = ampmFrom(text);

  let m = text.match(/\b([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (m) {
    return toHHMM(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3].replace(/\./g, "").toLowerCase());
  }

  m = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (m) return toHHMM(parseInt(m[1], 10), parseInt(m[2], 10), ampm);

  m = text.match(/\bat\s+([01]?\d|2[0-3])(?:\s*o'?clock)?\b/i) || text.match(/\b([01]?\d|2[0-3])\s*(?:o'?clock|baje?)\b/i);
  if (m) return toHHMM(parseInt(m[1], 10), 0, ampm);

  const wordNames = Object.keys(HOUR_WORDS).join("|");
  m =
    text.match(new RegExp(`\\b(${wordNames})\\s*(?:o'?clock|baje?|a\\.?m\\.?|p\\.?m\\.?)\\b`, "i")) ||
    text.match(new RegExp(`\\bat\\s+(${wordNames})\\b`, "i")) ||
    text.match(/\b(noon|midnight)\b/i);
  if (m) {
    const hour = HOUR_WORDS[String(m[1]).toLowerCase()];
    return toHHMM(hour, 0, ampm);
  }

  if (/^\d{1,2}$/.test(text)) return toHHMM(parseInt(text, 10), 0, ampm);

  if (text.length <= 40) {
    const wm = text.match(new RegExp(`\\b(${wordNames})\\b`, "i"));
    if (wm) return toHHMM(HOUR_WORDS[wm[1].toLowerCase()], 0, ampm);
    const bare = text.match(/\b([01]?\d|2[0-3])\b/);
    if (bare) return toHHMM(parseInt(bare[1], 10), 0, ampm);
  }

  return null;
}

/** Parse party size (afraad / persons) from digits or words. */
export function parsePartySize(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && !Number.isNaN(raw) && raw > 0) {
    return Math.max(1, Math.min(50, Math.floor(raw)));
  }
  const s = String(raw).trim().toLowerCase();
  if (!s || /^(none|null|n\/a|unknown)$/i.test(s)) return null;

  // Extract leading or isolated number: e.g. "5", "5 afraad", "5 persons", "5 log"
  const digitMatch = s.match(/\b\d+\b/);
  if (digitMatch) {
    const n = parseInt(digitMatch[0], 10);
    if (n > 0) return Math.max(1, Math.min(50, n));
  }

  // Urdu and English word numbers
  const words = {
    ek: 1, one: 1, single: 1,
    do: 2, two: 2, couple: 2,
    teen: 3, three: 3,
    chaar: 4, char: 4, four: 4,
    paanch: 5, panch: 5, five: 5,
    chhe: 6, che: 6, six: 6,
    saat: 7, seven: 7,
    aath: 8, ath: 8, eight: 8,
    nau: 9, no: 9, nine: 9,
    das: 10, ten: 10,
    gyarah: 11, eleven: 11,
    barah: 12, twelve: 12,
  };
  for (const [w, val] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`, "i").test(s)) {
      return val;
    }
  }
  return null;
}

/** Last clock time spoken in a transcript (later answers overwrite earlier ones). */
export function lastSpokenReservationTime(text) {
  if (!text) return null;
  const s = String(text);
  const wordNames = Object.keys(HOUR_WORDS).join("|");
  const pattern = new RegExp(
    [
      String.raw`\b\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\b`,
      String.raw`\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b`,
      String.raw`\b\d{1,2}\s*o'?clock\b`,
      String.raw`\bat\s+\d{1,2}\b`,
      String.raw`\b(?:${wordNames})\s*(?:o'?clock|a\.?m\.?|p\.?m\.?)\b`,
      String.raw`\bat\s+(?:${wordNames})\b`,
      String.raw`\b(?:noon|midnight)\b`,
    ].join("|"),
    "gi"
  );
  const found = [];
  let m;
  while ((m = pattern.exec(s)) !== null) {
    const parsed = parseReservationTime(m[0]);
    if (parsed) found.push({ i: m.index, t: parsed });
  }
  const lines = s.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const cleaned = line.replace(/^(customer|user|human|caller|ai|agent|bot)\s*:\s*/i, "").trim();
    const parsed = parseReservationTime(cleaned);
    if (parsed) found.push({ i: offset, t: parsed });
    offset += line.length + 1;
  }
  if (!found.length) return null;
  found.sort((a, b) => a.i - b.i);
  return found[found.length - 1].t;
}

/** Current dine-in sitting only blocks a short window around now, not the whole day. */
export function currentDiningBlockWindow(now = new Date()) {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return {
    s: Math.max(0, nowMins - 30),
    e: Math.min(24 * 60, nowMins + 120),
  };
}

export function diningOccupancyBlocksSlot(startTime, slotDurationHours = 1, now = new Date()) {
  const win = currentDiningBlockWindow(now);
  const reqStart = timeToMins(startTime);
  const reqEnd = reqStart + (Number(slotDurationHours) || 1) * 60;
  return reqStart < win.e && reqEnd > win.s;
}

/** Tables currently occupied by unpaid dine-in guests (stay booked until the bill is paid). */
export async function getOccupiedDiningTableIds(knex, restaurantId) {
  const familyIds = await resolveRestaurantFamilyIds(knex, restaurantId);
  const ids = familyIds.length ? familyIds : restaurantId ? [restaurantId] : [];
  if (!ids.length) return new Set();

  const catalog = await knex("restaurant_tables").whereIn("restaurant_id", ids).select("id", "table_number");
  const occupied = new Set();
  const mark = (tableId, tableNumber) => {
    if (tableId) occupied.add(tableId);
    const norm = normalizeTableNumber(tableNumber);
    if (!norm) return;
    const match = catalog.find((t) => t.id === tableId || normalizeTableNumber(t.table_number) === norm);
    if (match) occupied.add(match.id);
  };

  const openSessions = await knex("table_sessions")
    .whereIn("restaurant_id", ids)
    .andWhere({ status: "open" })
    .select("table_id", "table_number");
  for (const s of openSessions) mark(s.table_id, s.table_number);

  const unpaid = await knex("orders")
    .whereIn("restaurant_id", ids)
    .where({ fulfillment_type: "dine_in" })
    .whereNotIn("status", ["cancelled", "delivered"])
    .where((qb) => {
      qb.whereNull("payment_status").orWhereNot("payment_status", "paid");
    })
    .select("table_id", "table_number");
  for (const o of unpaid) mark(o.table_id, o.table_number);

  return occupied;
}

/**
 * Convert time string "HH:MM" (or "H:MM") to minutes from midnight.
 */
export function timeToMins(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Auto-provision standard tables for a restaurant if none exist.
 */
export async function ensureDefaultTables(knex, restaurantId) {
  if (!restaurantId) return [];
  const existing = await knex("restaurant_tables")
    .where({ restaurant_id: restaurantId, is_active: true });
  if (existing.length > 0) return existing;

  const defaults = [
    { id: randomUUID(), restaurant_id: restaurantId, table_number: "Table 1", capacity: 2, is_active: true },
    { id: randomUUID(), restaurant_id: restaurantId, table_number: "Table 2", capacity: 4, is_active: true },
    { id: randomUUID(), restaurant_id: restaurantId, table_number: "Table 3", capacity: 6, is_active: true },
    { id: randomUUID(), restaurant_id: restaurantId, table_number: "Table 4", capacity: 8, is_active: true },
    { id: randomUUID(), restaurant_id: restaurantId, table_number: "Table 5", capacity: 10, is_active: true },
  ];

  try {
    await knex("restaurant_tables").insert(defaults);
  } catch (err) {
    // If another request seeded concurrently, ignore
  }
  return knex("restaurant_tables").where({ restaurant_id: restaurantId, is_active: true });
}

/**
 * Find an available table for the given date/time/party size.
 */
export async function findAvailableTable(knex, { restaurantId, partySize, reservationDate, startTime, slotDurationHours }) {
  const pSize = Math.max(1, parseInt(partySize, 10) || 1);
  const duration = Number(slotDurationHours) || 1;

  // Auto-provision standard tables if restaurant has none
  await ensureDefaultTables(knex, restaurantId);

  // Get all active tables that can seat the party
  const familyIds = await resolveRestaurantFamilyIds(knex, restaurantId);
  const ids = familyIds.length ? familyIds : [restaurantId];

  let tables = await knex("restaurant_tables")
    .whereIn("restaurant_id", ids)
    .andWhere({ is_active: true })
    .where("capacity", ">=", pSize)
    .orderBy("capacity", "asc");

  // If no single table has capacity >= pSize, auto-provision a larger table for this party
  if (!tables.length) {
    const anyActive = await knex("restaurant_tables")
      .whereIn("restaurant_id", ids)
      .andWhere({ is_active: true })
      .first();
    if (anyActive) {
      const newTable = {
        id: randomUUID(),
        restaurant_id: restaurantId,
        table_number: `Table (Party of ${pSize})`,
        capacity: Math.max(pSize, 6),
        is_active: true,
      };
      try {
        await knex("restaurant_tables").insert(newTable);
        tables = [newTable];
      } catch (e) {
        const largest = await knex("restaurant_tables")
          .whereIn("restaurant_id", ids)
          .andWhere({ is_active: true })
          .orderBy("capacity", "desc")
          .first();
        if (largest) tables = [largest];
      }
    }
  }

  if (!tables.length) return null;

  const diningOccupied = reservationDate === localDateStr()
    ? await getOccupiedDiningTableIds(knex, restaurantId)
    : new Set();
  const diningBlocksThisSlot =
    diningOccupied.size > 0 && diningOccupancyBlocksSlot(startTime, duration);

  const reqStart = timeToMins(startTime);
  const reqEnd = reqStart + duration * 60;

  // Load all confirmed/pending/seated reservations for that date
  const existing = await knex("table_reservations")
    .whereIn("restaurant_id", ids)
    .andWhere({ reservation_date: reservationDate })
    .whereIn("status", ["pending", "confirmed", "seated"])
    .whereIn("table_id", tables.map((t) => t.id))
    .select("table_id", "start_time", "slot_duration_hours");

  // Group by table_id
  const busyMap = {};
  for (const r of existing) {
    if (!busyMap[r.table_id]) busyMap[r.table_id] = [];
    const s = timeToMins(r.start_time);
    const e = s + Number(r.slot_duration_hours) * 60;
    busyMap[r.table_id].push({ s, e });
  }

  for (const table of tables) {
    if (diningBlocksThisSlot && diningOccupied.has(table.id)) continue;
    const conflicts = busyMap[table.id] || [];
    const blocked = conflicts.some(({ s, e }) => reqStart < e && reqEnd > s);
    if (!blocked) return table;
  }

  return null;
}

/**
 * Create a reservation in the database.
 */
export async function createReservation(knex, {
  restaurantId,
  tableId = null,
  customerName,
  customerPhone = null,
  customerEmail = null,
  partySize = 1,
  reservationDate,
  startTime,
  slotDurationHours = 1,
  status = "confirmed",
  notes = null,
  source = "phone",
  callId = null,
  aiExtractedData = null,
}) {
  const [row] = await knex("table_reservations")
    .insert({
      id: randomUUID(),
      restaurant_id: restaurantId,
      table_id: tableId,
      customer_name: String(customerName).trim(),
      customer_phone: customerPhone ? String(customerPhone).trim() : null,
      customer_email: customerEmail || null,
      party_size: Math.max(1, parseInt(partySize, 10) || 1),
      reservation_date: reservationDate,
      start_time: startTime,
      slot_duration_hours: Number(slotDurationHours) || 1,
      status: status || "confirmed",
      notes: notes || null,
      source: source || "phone",
      call_id: callId || null,
      ai_extracted_data: aiExtractedData || null,
    })
    .returning("*");

  let tableNumber = null;
  if (row?.table_id) {
    const table = await knex("restaurant_tables").where({ id: row.table_id }).select("table_number").first();
    tableNumber = table?.table_number || null;
  }
  notifyNewReservationLater(knex, row, { table_number: tableNumber });

  return row;
}
