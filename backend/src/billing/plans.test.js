import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { amountFor, billingMode, isDummyStripeSecret, listPlans, usesDummyStripeCredentials } from "./plans.js";
import { evaluateDummyCard } from "./dummyCard.js";

describe("billing plans", () => {
  it("charges monthly list prices and yearly totals", () => {
    assert.equal(amountFor("starter", "month"), 29900);
    assert.equal(amountFor("growth", "month"), 59900);
    assert.equal(amountFor("pilot", "month"), 40000);
    assert.equal(amountFor("starter", "year"), 299000);
    assert.equal(amountFor("growth", "year"), 599000);
    assert.equal(amountFor("pilot", "year"), 480000);
    assert.equal(amountFor("growth", "week"), null);
    assert.equal(listPlans().length, 3);
  });

  it("treats placeholder keys as dummy Stripe credentials", () => {
    assert.equal(isDummyStripeSecret(""), true);
    assert.equal(isDummyStripeSecret("sk_test_51DUMMYAIRestaurant000"), true);
    assert.equal(isDummyStripeSecret("sk_test_51RealAccountKeyAbcdef1234567890"), false);
    assert.equal(isDummyStripeSecret("not-a-stripe-key"), true);
    assert.equal(usesDummyStripeCredentials("sk_test_51DUMMYAIRestaurant000"), true);
  });

  it("respects BILLING_MODE override", () => {
    const prev = process.env.BILLING_MODE;
    process.env.BILLING_MODE = "stripe";
    assert.equal(billingMode(), "stripe");
    process.env.BILLING_MODE = "dummy";
    assert.equal(billingMode(), "dummy");
    if (prev == null) delete process.env.BILLING_MODE;
    else process.env.BILLING_MODE = prev;
  });
});

describe("dummy card", () => {
  it("accepts the Stripe test card and declines the test decline card", () => {
    const ok = evaluateDummyCard({
      number: "4242 4242 4242 4242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.last4, "4242");

    const declined = evaluateDummyCard({
      number: "4000000000000002",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
    });
    assert.equal(declined.ok, false);
    assert.equal(declined.code, "card_declined");
  });
});
