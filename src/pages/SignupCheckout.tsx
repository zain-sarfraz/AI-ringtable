import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "@/lib/apiBase";
import { BillingInterval, BillingPlanId, formatPlanPrice } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_NAME, productTitle } from "@/lib/brand";
import "./landing.css";

type CheckoutSession = {
  session_id: string;
  plan: string;
  plan_name: string;
  interval: string;
  amount_cents: number;
  restaurant_name: string;
  customer_email: string;
  test_card?: string;
};

function signupReturnPath(plan?: string, interval?: string) {
  const p = (plan || "growth") as BillingPlanId;
  const i = (interval === "year" ? "year" : "month") as BillingInterval;
  return `/signup?plan=${p}&interval=${i}`;
}

export default function SignupCheckout() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = params.get("session") || params.get("session_id") || "";
  const [info, setInfo] = useState<CheckoutSession | null>(null);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expMonth, setExpMonth] = useState("12");
  const [expYear, setExpYear] = useState("30");
  const [cvc, setCvc] = useState("123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const backToSignup = useMemo(
    () => signupReturnPath(info?.plan, info?.interval),
    [info?.plan, info?.interval],
  );

  useEffect(() => {
    document.title = productTitle("Checkout");
  }, []);

  useEffect(() => {
    if (!session) {
      setError("Missing checkout session.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/billing/signup/checkout/${encodeURIComponent(session)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Checkout session not found");
        if (cancelled) return;
        if (data.already_paid && data.success_url) {
          navigate(data.success_url, { replace: true });
          return;
        }
        setInfo(data as CheckoutSession);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load checkout");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");
    setPaying(true);
    try {
      const res = await fetch(`${getApiBase()}/api/billing/signup/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          card: { number: cardNumber, exp_month: expMonth, exp_year: expYear, cvc },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Payment failed");
        return;
      }
      navigate(data.success_url || `/signup/success?session=${encodeURIComponent(session)}`, { replace: true });
    } catch {
      setError("Could not reach the billing server.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="lp">
      <nav className="navwrap">
        <div className="container navrow">
          <Link className="brand" to="/" aria-label={PRODUCT_NAME}>
            <img className="brand-wordmark" src={BRAND_ASSETS.logoHorizontalWhite} alt={PRODUCT_NAME} width={168} height={42} />
          </Link>
          <div className="nav-actions">
            <Link className="btn btn-ghost" to={backToSignup} style={{ padding: "9px 14px" }}>
              Cancel
            </Link>
          </div>
        </div>
      </nav>
      <section className="sec">
        <div className="container" style={{ maxWidth: 520 }}>
          <div className="cardx" style={{ padding: 32 }}>
            <span className="eyebrow">Stripe Checkout · Test mode</span>
            <h1 style={{ fontSize: 28, margin: "14px 0 8px" }}>Pay securely</h1>
            {loading ? (
              <p className="text-mut">Loading checkout…</p>
            ) : error && !info ? (
              <>
                <p style={{ color: "var(--red)" }}>{error}</p>
                <Link className="btn btn-or" to="/#pricing">
                  Back to pricing
                </Link>
              </>
            ) : info ? (
              <>
                <p className="text-mut" style={{ marginTop: 0 }}>
                  {info.restaurant_name} · {info.plan_name} ({info.interval}) ·{" "}
                  {formatPlanPrice(info.amount_cents / 100)}/{info.interval === "year" ? "yr" : "mo"}
                </p>
                <p className="text-mut" style={{ fontSize: 13 }}>
                  Billed to {info.customer_email}. Use Stripe test card{" "}
                  <strong>{info.test_card || "4242 4242 4242 4242"}</strong>.
                </p>
                <form onSubmit={onSubmit} style={{ display: "grid", gap: 16, marginTop: 20 }}>
                  <label>
                    <div className="lbl">Card number</div>
                    <input
                      className="form-control"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      required
                    />
                  </label>
                  <div className="row g-3">
                    <div className="col-4">
                      <label>
                        <div className="lbl">Month</div>
                        <input
                          className="form-control"
                          inputMode="numeric"
                          value={expMonth}
                          onChange={(e) => setExpMonth(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <div className="col-4">
                      <label>
                        <div className="lbl">Year</div>
                        <input
                          className="form-control"
                          inputMode="numeric"
                          value={expYear}
                          onChange={(e) => setExpYear(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <div className="col-4">
                      <label>
                        <div className="lbl">CVC</div>
                        <input
                          className="form-control"
                          inputMode="numeric"
                          autoComplete="cc-csc"
                          value={cvc}
                          onChange={(e) => setCvc(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                  </div>
                  {error && <p style={{ color: "var(--red)", margin: 0 }}>{error}</p>}
                  <button className="btn btn-or" type="submit" disabled={paying}>
                    {paying ? "Processing…" : `Pay ${formatPlanPrice(info.amount_cents / 100)}`}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
