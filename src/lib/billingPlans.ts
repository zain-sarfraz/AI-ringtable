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
  { name: string; monthly: number; yearly: number; yearlyNote: string; highlights: string[] }
> = {
  starter: {
    name: "Starter",
    monthly: 299,
    yearly: 2990,
    yearlyNote: "2 months free",
    highlights: [
      "AI Receptionist",
      "1,000 minutes",
      "Phone + QR ordering",
      "Reservations",
      "One Order Inbox & KDS",
      "AI performance dashboard",
      "1 location — no branches or staff seats",
    ],
  },
  growth: {
    name: "Growth",
    monthly: 599,
    yearly: 5990,
    yearlyNote: "2 months free",
    highlights: [
      "2,500 AI call minutes",
      "Multiple branches included",
      "User management included",
      "Kitchen login — dedicated access for kitchen staff",
      "Receptionist login — dedicated access for reservation staff",
      "Salesperson login — dedicated access for sales staff",
      "Multilingual support included",
      "Direct support available",
    ],
  },
  pilot: {
    name: "Pilot",
    monthly: 400,
    yearly: 4800,
    yearlyNote: "Same $400/mo rate, billed yearly",
    highlights: [
      "Everything in Growth",
      "Same $400 price locked for 1 year",
      "Weekly check-in with our team",
      "Shape the product roadmap",
      "4 spots remaining",
    ],
  },
};

export function planAmount(plan: BillingPlanId, interval: BillingInterval) {
  const row = BILLING_PLANS[plan];
  return interval === "year" ? row.yearly : row.monthly;
}

export function formatPlanPrice(dollars: number) {
  return `$${dollars.toLocaleString("en-US")}`;
}

/** Null/unknown plan = legacy restaurant → full features. Only explicit `starter` is limited. */
export function featuresForPlan(plan: string | null | undefined): PlanFeatures {
  const key = String(plan || "").toLowerCase() as BillingPlanId;
  if (!key) return PLAN_FEATURES.growth;
  return PLAN_FEATURES[key] || PLAN_FEATURES.growth;
}
