/** Feature flags by plan. Starter is single-location with no staff management. */

export const PLAN_FEATURES = {
  starter: {
    branches: false,
    staff_management: false,
    max_locations: 1,
  },
  growth: {
    branches: true,
    staff_management: true,
    max_locations: 5,
  },
  pilot: {
    branches: true,
    staff_management: true,
    max_locations: 5,
  },
};

export function featuresForPlan(planId) {
  const key = String(planId || "").toLowerCase();
  return PLAN_FEATURES[key] || PLAN_FEATURES.starter;
}

export async function resolveRestaurantPlan(knex, restaurantId) {
  if (!restaurantId) return { plan: null, features: featuresForPlan("starter"), restaurant: null };
  const restaurant = await knex("restaurants").where({ id: restaurantId }).first();
  if (!restaurant) return { plan: null, features: featuresForPlan("starter"), restaurant: null };

  // Branch inherits parent plan
  let planOwner = restaurant;
  if (restaurant.is_branch && restaurant.parent_restaurant_id) {
    const parent = await knex("restaurants").where({ id: restaurant.parent_restaurant_id }).first();
    if (parent) planOwner = parent;
  }

  let plan = planOwner.subscription_plan || null;
  if (!plan) {
    const sub = await knex("billing_subscriptions")
      .where({ restaurant_id: planOwner.id })
      .whereIn("status", ["active", "trialing"])
      .orderBy("created_at", "desc")
      .first();
    plan = sub?.plan || null;
  }

  return {
    plan,
    features: featuresForPlan(plan || "starter"),
    restaurant: planOwner,
  };
}
