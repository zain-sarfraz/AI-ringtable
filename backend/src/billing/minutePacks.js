/** AI minute top-up packs + plan included minutes. Keep in sync with src/lib/minutePacks.ts */

export const MINUTE_PACKS = {
  "300": { id: "300", minutes: 300, amountCents: 6000, label: "300 minutes", priceLabel: "$60" },
  "500": { id: "500", minutes: 500, amountCents: 10000, label: "500 minutes", priceLabel: "$100" },
  "1000": { id: "1000", minutes: 1000, amountCents: 17000, label: "1,000 minutes", priceLabel: "$170" },
  "2000": { id: "2000", minutes: 2000, amountCents: 30000, label: "2,000 minutes", priceLabel: "$300" },
};

export const PLAN_INCLUDED_MINUTES = {
  starter: 1000,
  growth: 2500,
  pilot: 2500,
};

export function getMinutePack(packId) {
  return MINUTE_PACKS[String(packId || "")] || null;
}

export function listMinutePacks() {
  return Object.values(MINUTE_PACKS);
}

export function includedMinutesForPlan(planId) {
  const key = String(planId || "").toLowerCase();
  if (!key) return PLAN_INCLUDED_MINUTES.growth;
  return PLAN_INCLUDED_MINUTES[key] ?? PLAN_INCLUDED_MINUTES.growth;
}

/** Current billing window: prefer active subscription period, else calendar month. */
export function resolveMinutesPeriod(subscription) {
  const now = new Date();
  if (subscription?.current_period_end) {
    const end = new Date(subscription.current_period_end);
    if (!Number.isNaN(end.getTime()) && end > now) {
      const start = new Date(end);
      const interval = String(subscription.billing_interval || "month").toLowerCase();
      if (interval === "year") start.setFullYear(start.getFullYear() - 1);
      else start.setMonth(start.getMonth() - 1);
      return { start, end, source: "subscription" };
    }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, source: "calendar_month" };
}

export async function sumUsedCallMinutes(knex, restaurantId, periodStart, periodEnd) {
  if (!restaurantId) return 0;
  const family = await knex("restaurants")
    .where(function matchFamily() {
      this.where({ id: restaurantId }).orWhere({ parent_restaurant_id: restaurantId });
    })
    .select("id");
  const ids = family.length ? family.map((r) => r.id) : [restaurantId];

  const hasRestaurantCol = await knex.schema.hasColumn("calls", "restaurant_id");
  if (!hasRestaurantCol) return 0;

  const row = await knex("calls")
    .whereIn("restaurant_id", ids)
    .where("created_at", ">=", periodStart)
    .where("created_at", "<", periodEnd)
    .sum({ total: "duration_seconds" })
    .first();

  const seconds = Number(row?.total || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

export async function sumPurchasedMinutes(knex, restaurantId) {
  const row = await knex("ai_minute_purchases")
    .where({ restaurant_id: restaurantId, status: "paid" })
    .sum({ total: "minutes" })
    .first();
  return Number(row?.total || 0) || 0;
}

export async function getMinutesBalance(knex, restaurantId, planId, subscription) {
  const period = resolveMinutesPeriod(subscription);
  const included = includedMinutesForPlan(planId);
  const [used, purchased] = await Promise.all([
    sumUsedCallMinutes(knex, restaurantId, period.start, period.end),
    sumPurchasedMinutes(knex, restaurantId),
  ]);
  const allowance = included + purchased;
  const remaining = Math.max(0, allowance - used);
  return {
    plan: planId || null,
    included_minutes: included,
    purchased_minutes: purchased,
    used_minutes: used,
    remaining_minutes: remaining,
    allowance_minutes: allowance,
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
    period_source: period.source,
    packs: listMinutePacks(),
  };
}
