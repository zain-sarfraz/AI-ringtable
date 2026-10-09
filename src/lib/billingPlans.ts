/** Keep amounts in sync with backend/src/billing/plans.js */

export type BillingPlanId = "starter" | "growth" | "pilot";
export type BillingInterval = "month" | "year";

export type PlanFeatures = {
  branches: boolean;
  staff_management: boolean;
  max_locations: number;
};

export const PLAN_FEATURES: Record<BillingPlanId, PlanFeatures> = {
  starter: { branches: false, staff_management: false, max_locations: 1 },
  growth: { branches: true, staff_management: true, max_locations: 5 },
  pilot: { branches: true, staff_management: true, max_locations: 5 },
};

export const BILLING_PLANS: Record<
  BillingPlanId,
  { name: string; monthly: number; yearly: number; yearlyNote: string }
> = {
  starter: { name: "Starter", monthly: 299, yearly: 2990, yearlyNote: "2 months free" },
  growth: { name: "Growth", monthly: 599, yearly: 5990, yearlyNote: "2 months free" },
  pilot: { name: "Pilot", monthly: 400, yearly: 4800, yearlyNote: "Same $400/mo rate, billed yearly" },
};

export function planAmount(plan: BillingPlanId, interval: BillingInterval) {
  const row = BILLING_PLANS[plan];
  return interval === "year" ? row.yearly : row.monthly;
}

export function formatPlanPrice(dollars: number) {
  return `$${dollars.toLocaleString("en-US")}`;
}

export function featuresForPlan(plan: string | null | undefined): PlanFeatures {
  const key = String(plan || "").toLowerCase() as BillingPlanId;
  return PLAN_FEATURES[key] || PLAN_FEATURES.starter;
}
