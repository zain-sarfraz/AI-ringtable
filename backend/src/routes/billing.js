import { Router } from "express";
import bcrypt from "bcryptjs";
import { getKnex } from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { signToken } from "../auth/tokens.js";
import { evaluateDummyCard } from "../billing/dummyCard.js";
import { featuresForPlan, resolveRestaurantPlan } from "../billing/planFeatures.js";
import { provisionPaidSignup } from "../billing/provisionRestaurant.js";
import {
  addBillingPeriod,
  amountFor,
  appBaseUrl,
  billingMode,
  getPlan,
  isDummyStripeSecret,
  listPlans,
  priceLockedUntil,
} from "../billing/plans.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    plan: row.plan,
    interval: row.billing_interval,
    amount_cents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    restaurant_name: row.restaurant_name,
    restaurant_id: row.restaurant_id || null,
    user_id: row.user_id || null,
    customer_email: row.customer_email,
    card_last4: row.card_last4,
    current_period_end: row.current_period_end,
    price_locked_until: row.price_locked_until,
    cancel_at_period_end: row.cancel_at_period_end,
    mode: row.mode,
    features: featuresForPlan(row.plan),
  };
}

async function findSubscription(knex, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  return knex("billing_subscriptions")
    .where(function match() {
      this.where({ id }).orWhere({ stripe_checkout_session_id: id });
    })
    .first();
}

function stripeClient() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (isDummyStripeSecret(key)) return null;
  return import("stripe").then(({ default: Stripe }) => new Stripe(key));
}

async function activateSubscriptionRow(knex, row) {
  if (!row) return row;
  if (row.status !== "active") {
    const periodEnd = addBillingPeriod(new Date(), row.billing_interval);
    const [updated] = await knex("billing_subscriptions")
      .where({ id: row.id })
      .update({
        status: "active",
        current_period_end: row.current_period_end || periodEnd,
        price_locked_until: row.price_locked_until || priceLockedUntil(row.plan, new Date()),
        updated_at: new Date(),
      })
      .returning("*");
    row = updated || row;
  }
  if (row.pending_password_hash && !row.restaurant_id) {
    await provisionPaidSignup(knex, row);
    row = await knex("billing_subscriptions").where({ id: row.id }).first();
  }
  return row;
}

async function syncStripeSession(knex, row) {
  if (!row || row.mode !== "stripe") return activateSubscriptionRow(knex, row);
  if (row.status === "active" && row.restaurant_id) return row;
  const stripe = await stripeClient();
  if (!stripe || !row.stripe_checkout_session_id) return row;
  const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
  if (session.payment_status !== "paid" && session.status !== "complete") return row;

  const periodEnd = addBillingPeriod(new Date(), row.billing_interval);
  const [updated] = await knex("billing_subscriptions")
    .where({ id: row.id })
    .update({
      status: "active",
      stripe_customer_id: session.customer || row.stripe_customer_id,
      stripe_subscription_id: session.subscription || row.stripe_subscription_id,
      current_period_end: periodEnd,
      price_locked_until: priceLockedUntil(row.plan, new Date()),
      updated_at: new Date(),
    })
    .returning("*");
  return activateSubscriptionRow(knex, updated || row);
}

function authPayloadForUser(userId, email) {
  return {
    token: signToken({ sub: userId, email }),
    user: { id: userId, email },
  };
}

export async function billingWebhookHandler(req, res) {
  if (billingMode() === "dummy") {
    return res.json({ received: true, mode: "dummy" });
  }
  const stripe = await stripeClient();
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !secret) {
    return res.status(503).json({ error: "Stripe webhook is not configured" });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid Stripe signature" });
  }

  try {
    const knex = getKnex();
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const row = await knex("billing_subscriptions").where({ stripe_checkout_session_id: session.id }).first();
      if (row) await syncStripeSession(knex, row);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const status = sub.status === "active" || sub.status === "trialing"
        ? "active"
        : sub.status === "canceled"
          ? "canceled"
          : sub.status === "past_due" || sub.status === "unpaid"
            ? "past_due"
            : sub.status;
      const updated = await knex("billing_subscriptions")
        .where({ stripe_subscription_id: sub.id })
        .update({
          status,
          cancel_at_period_end: Boolean(sub.cancel_at_period_end),
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          updated_at: new Date(),
        })
        .returning("*");
      const row = updated?.[0];
      if (row?.restaurant_id) {
        await knex("restaurants").where({ id: row.restaurant_id }).update({
          subscription_status: status,
          updated_at: new Date(),
        });
      }
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await knex("billing_subscriptions")
          .where({ stripe_subscription_id: invoice.subscription })
          .update({ status: "past_due", updated_at: new Date() });
      }
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook failed:", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}

const router = Router();

router.get("/plans", (_req, res) => {
  res.json({ mode: billingMode(), plans: listPlans() });
});

router.get("/config", (_req, res) => {
  res.json({
    mode: billingMode(),
    publishable_key: billingMode() === "stripe" ? process.env.STRIPE_PUBLISHABLE_KEY || null : null,
  });
});

router.get("/features/:restaurantId", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const rid = req.params.restaurantId;
    const isSuper = req.user?.roles?.includes("super_admin");
    const allowed = isSuper || req.user?.restaurantIds?.includes(rid);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    const resolved = await resolveRestaurantPlan(knex, rid);
    return res.json({
      plan: resolved.plan,
      features: resolved.features,
      subscription_status: resolved.restaurant?.subscription_status || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not load plan features" });
  }
});

/**
 * Restaurant self-signup: account is created only after payment succeeds.
 * Dummy Stripe: pay + create + return JWT.
 * Real Stripe: store pending password hash, redirect to Checkout, then claim on success page.
 */
router.post("/signup", async (req, res) => {
  try {
    const planId = String(req.body?.plan || "").toLowerCase();
    const interval = String(req.body?.interval || "").toLowerCase();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.full_name || "").trim();
    const restaurantName = String(req.body?.restaurant_name || "").trim();
    const plan = getPlan(planId);
    const amount = amountFor(planId, interval);

    if (!plan || !amount) {
      return res.status(400).json({ error: "Choose a monthly or yearly plan." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (restaurantName.length < 2) {
      return res.status(400).json({ error: "Enter the restaurant name." });
    }

    const knex = getKnex();
    const existing = await knex("profiles").whereRaw("lower(email) = lower(?)", [email]).first();
    if (existing) {
      return res.status(400).json({ error: "Email already registered. Log in instead." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const mode = billingMode();

    if (mode === "dummy") {
      const card = evaluateDummyCard(req.body?.card || {});
      if (!card.ok) return res.status(402).json({ error: card.message, code: card.code });

      const [row] = await knex("billing_subscriptions")
        .insert({
          plan: plan.id,
          billing_interval: interval,
          amount_cents: amount,
          currency: "usd",
          status: "active",
          restaurant_name: restaurantName,
          customer_email: email,
          card_last4: card.last4,
          current_period_end: addBillingPeriod(now, interval),
          price_locked_until: priceLockedUntil(plan.id, now),
          pending_password_hash: passwordHash,
          pending_full_name: fullName || null,
          mode: "dummy",
          created_at: now,
          updated_at: now,
        })
        .returning("*");

      const sessionId = `cs_dummy_${row.id}`;
      await knex("billing_subscriptions").where({ id: row.id }).update({ stripe_checkout_session_id: sessionId });

      const provisioned = await provisionPaidSignup(knex, { ...row, stripe_checkout_session_id: sessionId }, {
        passwordHash,
        fullName,
      });
      const auth = authPayloadForUser(provisioned.userId, email);
      const fresh = await knex("billing_subscriptions").where({ id: row.id }).first();

      return res.json({
        mode: "dummy",
        subscription: publicSubscription(fresh),
        ...auth,
        restaurant_id: provisioned.restaurantId,
        features: provisioned.features,
        success_url: `${appBaseUrl()}/signup/success?session=${row.id}`,
      });
    }

    const stripe = await stripeClient();
    const [pending] = await knex("billing_subscriptions")
      .insert({
        plan: plan.id,
        billing_interval: interval,
        amount_cents: amount,
        currency: "usd",
        status: "incomplete",
        restaurant_name: restaurantName,
        customer_email: email,
        pending_password_hash: passwordHash,
        pending_full_name: fullName || null,
        mode: "stripe",
        created_at: now,
        updated_at: now,
      })
      .returning("*");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      client_reference_id: pending.id,
      success_url: `${appBaseUrl()}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl()}/signup?plan=${plan.id}&interval=${interval}`,
      metadata: {
        subscription_id: pending.id,
        plan: plan.id,
        billing_interval: interval,
        restaurant_name: restaurantName,
        signup: "1",
      },
      subscription_data: {
        metadata: { plan: plan.id, billing_interval: interval, subscription_id: pending.id, signup: "1" },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            recurring: { interval: interval === "year" ? "year" : "month" },
            product_data: { name: `Ringtable ${plan.name}`, description: plan.blurb },
          },
        },
      ],
    });

    await knex("billing_subscriptions")
      .where({ id: pending.id })
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date() });

    return res.json({ mode: "stripe", checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Signup checkout failed:", err);
    return res.status(500).json({ error: err.message || "Could not start signup" });
  }
});

/** After Stripe redirect: sync payment, provision restaurant, return JWT. */
router.post("/signup/claim", async (req, res) => {
  try {
    const sessionId = String(req.body?.session || req.body?.session_id || "").trim();
    if (!sessionId) return res.status(400).json({ error: "Missing checkout session" });

    const knex = getKnex();
    let row = await findSubscription(knex, sessionId);
    if (!row) return res.status(404).json({ error: "Subscription not found" });

    row = await syncStripeSession(knex, row);
    if (row.status !== "active") {
      return res.status(402).json({ error: "Payment is not complete yet." });
    }

    if (!row.restaurant_id || !row.user_id) {
      if (!row.pending_password_hash) {
        return res.status(409).json({ error: "This checkout is not a restaurant signup, or it was already claimed." });
      }
      await provisionPaidSignup(knex, row);
      row = await knex("billing_subscriptions").where({ id: row.id }).first();
    }

    const profile = await knex("profiles").where({ id: row.user_id }).first();
    const auth = authPayloadForUser(row.user_id, profile?.email || row.customer_email);
    return res.json({
      subscription: publicSubscription(row),
      ...auth,
      restaurant_id: row.restaurant_id,
      features: featuresForPlan(row.plan),
    });
  } catch (err) {
    console.error("Signup claim failed:", err);
    return res.status(500).json({ error: err.message || "Could not complete signup" });
  }
});

router.post("/checkout", optionalAuth, async (req, res) => {
  try {
    const planId = String(req.body?.plan || "").toLowerCase();
    const interval = String(req.body?.interval || "").toLowerCase();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const restaurantName = String(req.body?.restaurant_name || "").trim();
    const plan = getPlan(planId);
    const amount = amountFor(planId, interval);

    if (!plan || !amount) {
      return res.status(400).json({ error: "Choose a monthly or yearly plan." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email." });
    }
    if (restaurantName.length < 2) {
      return res.status(400).json({ error: "Enter the restaurant name." });
    }

    const knex = getKnex();
    const now = new Date();
    const mode = billingMode();

    if (mode === "dummy") {
      const card = evaluateDummyCard(req.body?.card || {});
      if (!card.ok) return res.status(402).json({ error: card.message, code: card.code });

      const [row] = await knex("billing_subscriptions")
        .insert({
          user_id: req.user?.id || null,
          plan: plan.id,
          billing_interval: interval,
          amount_cents: amount,
          currency: "usd",
          status: "active",
          restaurant_name: restaurantName,
          customer_email: email,
          card_last4: card.last4,
          current_period_end: addBillingPeriod(now, interval),
          price_locked_until: priceLockedUntil(plan.id, now),
          mode: "dummy",
          created_at: now,
          updated_at: now,
        })
        .returning("*");

      const sessionId = `cs_dummy_${row.id}`;
      await knex("billing_subscriptions").where({ id: row.id }).update({ stripe_checkout_session_id: sessionId });
      return res.json({
        mode: "dummy",
        subscription: publicSubscription({ ...row, stripe_checkout_session_id: sessionId }),
        success_url: `${appBaseUrl()}/subscribe/success?session=${row.id}`,
      });
    }

    const stripe = await stripeClient();
    const [pending] = await knex("billing_subscriptions")
      .insert({
        user_id: req.user?.id || null,
        plan: plan.id,
        billing_interval: interval,
        amount_cents: amount,
        currency: "usd",
        status: "incomplete",
        restaurant_name: restaurantName,
        customer_email: email,
        mode: "stripe",
        created_at: now,
        updated_at: now,
      })
      .returning("*");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      client_reference_id: pending.id,
      success_url: `${appBaseUrl()}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl()}/#pricing`,
      metadata: {
        subscription_id: pending.id,
        plan: plan.id,
        billing_interval: interval,
        restaurant_name: restaurantName,
      },
      subscription_data: {
        metadata: { plan: plan.id, billing_interval: interval, subscription_id: pending.id },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            recurring: { interval: interval === "year" ? "year" : "month" },
            product_data: { name: `Ringtable ${plan.name}`, description: plan.blurb },
          },
        },
      ],
    });

    await knex("billing_subscriptions")
      .where({ id: pending.id })
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date() });

    return res.json({ mode: "stripe", checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Checkout failed:", err);
    return res.status(500).json({ error: err.message || "Could not start checkout" });
  }
});

router.get("/checkout/:sessionId", async (req, res) => {
  try {
    const knex = getKnex();
    let row = await findSubscription(knex, req.params.sessionId);
    if (!row) return res.status(404).json({ error: "Subscription not found" });
    row = await syncStripeSession(knex, row);
    return res.json({ subscription: publicSubscription(row) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not load subscription" });
  }
});

router.post("/checkout/:sessionId/cancel", async (req, res) => {
  try {
    const knex = getKnex();
    const row = await findSubscription(knex, req.params.sessionId);
    if (!row) return res.status(404).json({ error: "Subscription not found" });
    if (row.status === "canceled") return res.json({ subscription: publicSubscription(row) });

    if (row.mode === "stripe" && row.stripe_subscription_id) {
      const stripe = await stripeClient();
      if (stripe) {
        await stripe.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true });
      }
    }

    const [updated] = await knex("billing_subscriptions")
      .where({ id: row.id })
      .update({
        cancel_at_period_end: true,
        status: row.mode === "dummy" ? "canceled" : row.status,
        updated_at: new Date(),
      })
      .returning("*");

    if (updated?.restaurant_id && updated.status === "canceled") {
      await knex("restaurants").where({ id: updated.restaurant_id }).update({
        subscription_status: "canceled",
        updated_at: new Date(),
      });
    }

    return res.json({ subscription: publicSubscription(updated) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not cancel subscription" });
  }
});

export default router;
