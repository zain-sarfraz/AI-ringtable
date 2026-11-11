/** Weekday ints match restaurant_hours: 0=Sunday … 6=Saturday. */

const WEEKDAY_TO_DOW = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function normalizeDealDays(days) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const cleaned = [
    ...new Set(
      days
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    ),
  ].sort((a, b) => a - b);
  return cleaned.length ? cleaned : null;
}

function parseTimeToMinutes(t) {
  if (t == null || t === "") return null;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function resolveDealTimeZone(deal, opts = {}) {
  if (opts.timeZone) return opts.timeZone;
  if (deal?.time_zone || deal?.timezone) return String(deal.time_zone || deal.timezone);
  const currency = String(opts.currency || deal?.currency || "").toUpperCase();
  if (currency === "PKR") return "Asia/Karachi";
  return opts.fallbackTimeZone || process.env.DEAL_TIMEZONE || "Asia/Karachi";
}

export function getZonedDayAndMinutes(at = new Date(), timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(at);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const dow = WEEKDAY_TO_DOW[map.weekday] ?? at.getDay();
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const minute = Number(map.minute);
  return { dow, minutes: hour * 60 + minute };
}

/**
 * Campaign dates (starts_at/ends_at) + weekly days + daily time window.
 * Empty available_days + null times = available every day/all day (within campaign dates).
 */
export function isDealAvailableAt(deal, at = new Date(), opts = {}) {
  if (!deal) return false;
  if (deal.is_active === false) return false;

  if (deal.starts_at) {
    const start = new Date(deal.starts_at);
    if (Number.isFinite(start.getTime()) && at < start) return false;
  }
  if (deal.ends_at) {
    const end = new Date(deal.ends_at);
    if (Number.isFinite(end.getTime()) && at > end) return false;
  }

  const days = normalizeDealDays(deal.available_days);
  const startMins = parseTimeToMinutes(deal.available_start_time);
  const endMins = parseTimeToMinutes(deal.available_end_time);
  if (!days && startMins == null && endMins == null) return true;

  const tz = resolveDealTimeZone(deal, opts);
  const { dow, minutes } = getZonedDayAndMinutes(at, tz);

  if (days && !days.includes(dow)) return false;

  if (startMins != null || endMins != null) {
    const s = startMins ?? 0;
    const e = endMins ?? 23 * 60 + 59;
    if (e < s) {
      // Overnight window e.g. 22:00–02:00
      if (!(minutes >= s || minutes <= e)) return false;
    } else if (minutes < s || minutes > e) {
      return false;
    }
  }

  return true;
}

export function filterAvailableDeals(deals, at = new Date(), opts = {}) {
  return (deals || []).filter((d) => isDealAvailableAt(d, at, opts));
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-readable weekly schedule for voice prompts / admin. */
export function formatDealScheduleLabel(deal) {
  const days = normalizeDealDays(deal?.available_days);
  const start = deal?.available_start_time != null ? String(deal.available_start_time).slice(0, 5) : "";
  const end = deal?.available_end_time != null ? String(deal.available_end_time).slice(0, 5) : "";
  const dayPart = days ? days.map((d) => DOW_LABELS[d] || String(d)).join("/") : "every day";
  if (!start && !end) {
    return days ? `Available ${dayPart}, all day` : "Available every day";
  }
  return `Available ${dayPart} ${start || "00:00"}–${end || "23:59"}`;
}

/** Snapshot used in voice knowledge so the agent knows "now" without relying on sync-time filtering. */
export function restaurantLocalNowLabel(at = new Date(), opts = {}) {
  const tz = resolveDealTimeZone({}, opts);
  const { dow, minutes } = getZonedDayAndMinutes(at, tz);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${DOW_LABELS[dow] || "?"} ${hh}:${mm} (${tz})`;
}
