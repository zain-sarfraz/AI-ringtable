/** Plan catalog. Amounts are USD cents. Keep in sync with src/lib/billingPlans.ts */

import { featuresForPlan } from "./planFeatures.js";

export const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    blurb: "1 location, AI Receptionist, 1,000 minutes",
    monthlyCents: 29900,
    yearlyCents: 299000,
  },
  growth: {
    id: "growth",
    name: "Growth",
    blurb: "Up to 5 locations, AI Receptionist, 2,500 minutes, multi branches",
    monthlyCents: 59900,
    yearlyCents: 599000,
  },
  pilot: {
    id: "pilot",
    name: "Pilot",
    blurb: "Growth for 1 year at $400/mo",
    monthlyCents: 40000,
    yearlyCents: 480000,
  },
};

const DUMMY_MARKERS = ["DUMMY", "sk_test_dummy", "pk_test_dummy", "placeholder", "changeme"];

export function isDummyStripeSecret(secret = process.env.STRIPE_SECRET_KEY) {
  const key = String(secret || "").trim();
  if (!key) return true;
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) return true;
  const upper = key.toUpperCase();
  return DUMMY_MARKERS.some((marker) => upper.includes(marker.toUpperCase()));
}

export function billingMode() {
  return isDummyStripeSecret() ? "dummy" : "stripe";
}

export function getPlan(planId) {
  const plan = PLANS[String(planId || "").toLowerCase()];
  return plan || null;
}

export function amountFor(planId, interval) {
  const plan = getPlan(planId);
  if (!plan) return null;
  if (interval === "year") return plan.yearlyCents;
  if (interval === "month") return plan.monthlyCents;
  return null;
}

export function listPlans() {
  return Object.values(PLANS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    blurb: plan.blurb,
    currency: "usd",
    monthly_cents: plan.monthlyCents,
    yearly_cents: plan.yearlyCents,
    features: featuresForPlan(plan.id),
  }));
}

export function appBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function addBillingPeriod(from, interval) {
  const next = new Date(from);
  if (interval === "year") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

export function priceLockedUntil(planId, from) {
  if (planId !== "pilot") return null;
  const locked = new Date(from);
  locked.setFullYear(locked.getFullYear() + 1);
  return locked;
}
