import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getApiBase } from "@/lib/apiBase";
import { BILLING_PLANS, BillingPlanId, formatPlanPrice } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_NAME, productTitle } from "@/lib/brand";
import "./landing.css";

type Subscription = {
  id: string;
  plan: BillingPlanId;
  interval: "month" | "year";
  amount_cents: number;
  status: string;
  restaurant_name: string | null;
  customer_email: string;
  card_last4: string | null;
  current_period_end: string | null;
  price_locked_until: string | null;
  cancel_at_period_end: boolean;
  mode: string;
};

export default function SubscribeSuccess() {
  const [params] = useSearchParams();
  const session = params.get("session") || params.get("session_id") || "";
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    document.title = productTitle("Subscription confirmed");
  }, []);

  useEffect(() => {
    if (!session) {
      setError("Missing checkout session.");
      return;
    }
    let cancelled = false;
    fetch(`${getApiBase()}/api/billing/checkout/${encodeURIComponent(session)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load subscription");
        if (!cancelled) setSubscription(data.subscription);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function cancel() {
    if (!session) return;
    setCanceling(true);
    setError("");
    try {
      const res = await fetch(`${getApiBase()}/api/billing/checkout/${encodeURIComponent(session)}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not cancel");
      setSubscription(data.subscription);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setCanceling(false);
    }
  }

  const planName = subscription && BILLING_PLANS[subscription.plan]
    ? BILLING_PLANS[subscription.plan].name
    : subscription?.plan;
  const renews = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="lp">
      <nav className="navwrap">
        <div className="container navrow">
          <Link className="brand" to="/">
            <img className="brand-wordmark" src={BRAND_ASSETS.logoHorizontalWhite} alt={PRODUCT_NAME} width={168} height={42} />
          </Link>
        </div>
      </nav>
      <section className="sec">
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="cardx" style={{ padding: 32 }}>
            <span className="eyebrow">Subscription</span>
            <h1 style={{ fontSize: 36, margin: "14px 0 8px" }}>
              {subscription?.status === "canceled" ? "Subscription canceled" : "You're subscribed"}
            </h1>
            {!subscription && !error && <p className="text-mut">Confirming payment…</p>}
            {error && <p style={{ color: "var(--red)" }}>{error}</p>}
            {subscription && (
              <>
                <p>
                  <b>{subscription.restaurant_name}</b> is on the {planName} plan, billed{" "}
                  {formatPlanPrice(subscription.amount_cents / 100)}/{subscription.interval === "year" ? "year" : "month"}.
                </p>
                <ul>
                  <li>Status: {subscription.status}</li>
                  <li>Email: {subscription.customer_email}</li>
                  {subscription.card_last4 && <li>Card: •••• {subscription.card_last4}</li>}
                  {renews && subscription.status !== "canceled" && <li>Renews {renews}</li>}
                  {subscription.price_locked_until && (
                    <li>Price locked until {new Date(subscription.price_locked_until).toLocaleDateString()}</li>
                  )}
                </ul>
                {subscription.status !== "canceled" && (
                  <button className="btn btn-ghost" type="button" onClick={cancel} disabled={canceling}>
                    {canceling ? "Canceling…" : "Cancel subscription"}
                  </button>
                )}
              </>
            )}
            <div className="mt-3">
              <Link className="btn btn-or" to="/#pricing">Back to pricing</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
