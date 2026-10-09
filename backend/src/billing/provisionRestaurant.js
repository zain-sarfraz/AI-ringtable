import { randomUUID } from "node:crypto";
import { featuresForPlan } from "./planFeatures.js";

export function slugifyName(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "restaurant";
}

async function uniqueSlug(trx, name) {
  const base = slugifyName(name);
  let slug = base;
  let n = 1;
  while (await trx("restaurants").where({ slug }).first()) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/**
 * Create restaurant owner account + restaurant after successful payment.
 * Idempotent when subscription already has restaurant_id / user_id.
 */
export async function provisionPaidSignup(knex, subscription, {
  passwordHash,
  fullName,
} = {}) {
  if (!subscription?.id) throw new Error("Missing subscription");
  if (subscription.restaurant_id && subscription.user_id) {
    return {
      userId: subscription.user_id,
      restaurantId: subscription.restaurant_id,
      created: false,
      features: featuresForPlan(subscription.plan),
    };
  }

  const email = String(subscription.customer_email || "").trim().toLowerCase();
  const restaurantName = String(subscription.restaurant_name || "").trim();
  const hash = passwordHash || subscription.pending_password_hash;
  const name = (fullName || subscription.pending_full_name || email.split("@")[0] || "Owner").trim();

  if (!email) throw new Error("Subscription is missing customer email");
  if (!restaurantName) throw new Error("Subscription is missing restaurant name");
  if (!hash) throw new Error("Missing password for restaurant signup");

  return knex.transaction(async (trx) => {
    const locked = await trx("billing_subscriptions").where({ id: subscription.id }).forUpdate().first();
    if (!locked) throw new Error("Subscription not found");
    if (locked.restaurant_id && locked.user_id) {
      return {
        userId: locked.user_id,
        restaurantId: locked.restaurant_id,
        created: false,
        features: featuresForPlan(locked.plan),
      };
    }

    const existing = await trx("profiles").whereRaw("lower(email) = lower(?)", [email]).first();
    if (existing && !locked.user_id) {
      throw new Error("Email already registered");
    }

    let userId = locked.user_id;
    if (!userId) {
      const [profile] = await trx("profiles")
        .insert({
          id: randomUUID(),
          email,
          full_name: name,
          password_hash: hash,
          status: "available",
        })
        .returning("*");
      userId = profile.id;
      const hasRole = await trx("user_roles").where({ user_id: userId, role: "admin" }).first();
      if (!hasRole) {
        await trx("user_roles").insert({ user_id: userId, role: "admin" });
      }
    }

    let restaurantId = locked.restaurant_id;
    if (!restaurantId) {
      const slug = await uniqueSlug(trx, restaurantName);
      const [restaurant] = await trx("restaurants")
        .insert({
          id: randomUUID(),
          name: restaurantName,
          slug,
          contact_email: email,
          is_active: true,
          is_branch: false,
          subscription_plan: locked.plan,
          subscription_status: "active",
        })
        .returning("*");
      restaurantId = restaurant.id;

      await trx("restaurant_settings").insert({
        restaurant_id: restaurantId,
        name: restaurantName,
        email,
      });

      await trx("restaurant_members").insert({
        user_id: userId,
        restaurant_id: restaurantId,
        member_role: "owner",
      });
    }

    await trx("billing_subscriptions")
      .where({ id: locked.id })
      .update({
        user_id: userId,
        restaurant_id: restaurantId,
        status: "active",
        pending_password_hash: null,
        pending_full_name: null,
        activated_at: new Date(),
        updated_at: new Date(),
      });

    await trx("restaurants").where({ id: restaurantId }).update({
      subscription_plan: locked.plan,
      subscription_status: "active",
      updated_at: new Date(),
    });

    return {
      userId,
      restaurantId,
      created: true,
      features: featuresForPlan(locked.plan),
    };
  });
}
