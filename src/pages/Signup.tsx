import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "@/lib/apiBase";
import { setToken } from "@/lib/authStorage";
import { BILLING_PLANS, BillingInterval, BillingPlanId, formatPlanPrice, planAmount, PLAN_FEATURES } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_NAME, productTitle } from "@/lib/brand";
import { useAuth } from "@/hooks/useAuth";
import "./landing.css";

const PLANS = new Set<BillingPlanId>(["starter", "growth", "pilot"]);

function isPlan(value: string | null): value is BillingPlanId {
  return Boolean(value && PLANS.has(value as BillingPlanId));
}

export default function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const planParam = params.get("plan");
  const intervalParam = params.get("interval");
  const plan: BillingPlanId = isPlan(planParam) ? planParam : "growth";
  const interval: BillingInterval = intervalParam === "year" ? "year" : "month";
  const details = BILLING_PLANS[plan];
  const amount = planAmount(plan, interval);
  const features = PLAN_FEATURES[plan];

  const [mode, setMode] = useState<"dummy" | "stripe" | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expMonth, setExpMonth] = useState("12");
  const [expYear, setExpYear] = useState("30");
  const [cvc, setCvc] = useState("123");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = productTitle(`Sign up · ${details.name}`);
    return () => {
      document.title = previous;
    };
  }, [details.name]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/billing/config`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setMode(data.mode === "stripe" ? "stripe" : "dummy");
      })
      .catch(() => {
        if (!cancelled) setMode("dummy");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/billing/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval,
          email,
          password,
          full_name: fullName,
          restaurant_name: restaurantName,
          card: mode === "stripe" ? undefined : {
            number: cardNumber,
            exp_month: expMonth,
            exp_year: expYear,
            cvc,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Signup could not be completed.");
        return;
      }
      if (data.checkout_url && data.mode === "stripe") {
        window.location.href = data.checkout_url;
        return;
      }
      if (data.token) {
        setToken(data.token);
        if (data.restaurant_id) {
          localStorage.setItem("active_restaurant_id", data.restaurant_id);
        }
        window.location.href = "/dashboard";
        return;
      }
      navigate(data.subscription?.id ? `/signup/success?session=${data.subscription.id}` : "/signup/success");
    } catch {
      setError("Could not reach the billing server.");
    } finally {
      setSubmitting(false);
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
            <Link className="btn btn-login" to="/login">Log in</Link>
            <Link className="btn btn-ghost" to="/#pricing" style={{ padding: "9px 14px" }}>Change plan</Link>
          </div>
        </div>
      </nav>
      <section className="sec">
        <div className="container" style={{ maxWidth: 780 }}>
          <div className="cardx" style={{ padding: 32 }}>
            <span className="eyebrow">Create restaurant account</span>
            <h1 style={{ fontSize: 34, margin: "14px 0 8px" }}>{details.name} plan</h1>
            <p className="text-mut" style={{ marginTop: 0 }}>
              {formatPlanPrice(amount)}/{interval === "year" ? "year" : "month"}
              {interval === "year" ? ` · ${details.yearlyNote}` : ""}
            </p>
            <ul style={{ margin: "0 0 20px", paddingLeft: 18, color: "var(--mut)", fontSize: 14 }}>
              <li>{features.branches ? "Multi branches included" : "Single location — no branches"}</li>
              <li>{features.staff_management ? "Staff & team management included" : "No staff management on Starter"}</li>
              <li>Account is created only after successful Stripe payment</li>
            </ul>
            <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
              <label>
                <div className="lbl">Restaurant name</div>
                <input className="form-control" value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} required minLength={2} />
              </label>
              <label>
                <div className="lbl">Your name</div>
                <input className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
              <label>
                <div className="lbl">Work email</div>
                <input className="form-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              <label>
                <div className="lbl">Password</div>
                <input className="form-control" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              {mode !== "stripe" && (
                <>
                  <label>
                    <div className="lbl">Card number</div>
                    <input className="form-control" inputMode="numeric" autoComplete="cc-number" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} required />
                  </label>
                  <div className="row g-3">
                    <div className="col-4">
                      <label>
                        <div className="lbl">Month</div>
                        <input className="form-control" inputMode="numeric" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} required />
                      </label>
                    </div>
                    <div className="col-4">
                      <label>
                        <div className="lbl">Year</div>
                        <input className="form-control" inputMode="numeric" value={expYear} onChange={(e) => setExpYear(e.target.value)} required />
                      </label>
                    </div>
                    <div className="col-4">
                      <label>
                        <div className="lbl">CVC</div>
                        <input className="form-control" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} required />
                      </label>
                    </div>
                  </div>
                  <p className="text-mut" style={{ fontSize: 13, margin: 0 }}>
                    Test mode: pay with 4242 4242 4242 4242. Card 4000 0000 0000 0002 is declined.
                  </p>
                </>
              )}
              {error && <p style={{ color: "var(--red)", margin: 0 }}>{error}</p>}
              <button className="btn btn-or" type="submit" disabled={submitting || authLoading}>
                {submitting
                  ? "Processing…"
                  : mode === "stripe"
                    ? `Continue to Stripe · ${formatPlanPrice(amount)}`
                    : `Pay & create restaurant · ${formatPlanPrice(amount)}`}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
