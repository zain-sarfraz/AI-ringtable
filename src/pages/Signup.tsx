import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "@/lib/apiBase";
import { setToken } from "@/lib/authStorage";
import { BILLING_PLANS, BillingInterval, BillingPlanId, formatPlanPrice, planAmount } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_NAME, productTitle } from "@/lib/brand";
import { useAuth } from "@/hooks/useAuth";
import "./landing.css";

const PLANS = new Set<BillingPlanId>(["starter", "growth", "pilot"]);

function isPlan(value: string | null): value is BillingPlanId {
  return Boolean(value && PLANS.has(value as BillingPlanId));
}

/** Relative app path → SPA navigate; absolute Stripe URL → full redirect. */
function goToCheckout(url: string, navigate: ReturnType<typeof useNavigate>) {
  const target = String(url || "").trim();
  if (!target) return;
  if (/^https?:\/\//i.test(target)) {
    window.location.assign(target);
    return;
  }
  navigate(target.startsWith("/") ? target : `/${target}`);
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

  const [mode, setMode] = useState<"dummy" | "stripe" | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  // Keep plan/interval in the URL so refresh + back navigation stay correct
  useEffect(() => {
    if (planParam === plan && intervalParam === interval) return;
    navigate(`/signup?plan=${plan}&interval=${interval}`, { replace: true });
  }, [plan, interval, planParam, intervalParam, navigate]);

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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Signup could not be completed.");
        return;
      }
      if (data.checkout_url && data.mode === "stripe") {
        goToCheckout(data.checkout_url, navigate);
        return;
      }
      if (data.token) {
        setToken(data.token);
        if (data.restaurant_id) {
          localStorage.setItem("active_restaurant_id", data.restaurant_id);
        }
        navigate("/dashboard", { replace: true });
        return;
      }
      navigate(
        data.subscription?.id
          ? `/signup/success?session=${encodeURIComponent(data.subscription.id)}`
          : "/signup/success",
        { replace: true },
      );
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
            <Link className="btn btn-login" to="/login">
              Log in
            </Link>
            <Link className="btn btn-ghost" to="/#pricing" style={{ padding: "9px 14px" }}>
              Change plan
            </Link>
          </div>
        </div>
      </nav>
      <section className="sec">
        <div className="container" style={{ maxWidth: 520 }}>
          <div className="cardx" style={{ padding: 32 }}>
            <span className="eyebrow">Create restaurant account</span>
            <h1 style={{ fontSize: 34, margin: "14px 0 8px" }}>{details.name} plan</h1>
            <p className="text-mut" style={{ marginTop: 0, marginBottom: 24 }}>
              {formatPlanPrice(amount)}/{interval === "year" ? "year" : "month"}
              {interval === "year" ? ` · ${details.yearlyNote}` : ""}
            </p>
            <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
              <label>
                <div className="lbl">Restaurant name</div>
                <input
                  className="form-control"
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  required
                  minLength={2}
                  autoComplete="organization"
                />
              </label>
              <label>
                <div className="lbl">Name</div>
                <input
                  className="form-control"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </label>
              <label>
                <div className="lbl">Work email</div>
                <input
                  className="form-control"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label>
                <div className="lbl">Password</div>
                <input
                  className="form-control"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              {error && <p style={{ color: "var(--red)", margin: 0 }}>{error}</p>}
              <button className="btn btn-or" type="submit" disabled={submitting || authLoading || mode == null}>
                {submitting ? "Processing…" : "Proceed"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
