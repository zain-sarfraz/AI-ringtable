import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "@/lib/apiBase";
import { setToken } from "@/lib/authStorage";
import { BILLING_PLANS, BillingPlanId, formatPlanPrice } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_NAME, productTitle } from "@/lib/brand";
import "./landing.css";

export default function SignupSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = params.get("session") || params.get("session_id") || "";
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Confirming payment and creating your restaurant…");

  useEffect(() => {
    document.title = productTitle("Welcome");
  }, []);

  useEffect(() => {
    if (!session) {
      setError("Missing checkout session.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/billing/signup/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not complete signup");
        if (cancelled) return;
        if (data.token) {
          setToken(data.token);
          if (data.restaurant_id) {
            localStorage.setItem("active_restaurant_id", data.restaurant_id);
          }
          const planName = data.subscription?.plan && BILLING_PLANS[data.subscription.plan as BillingPlanId]
            ? BILLING_PLANS[data.subscription.plan as BillingPlanId].name
            : data.subscription?.plan;
          const amount = data.subscription?.amount_cents
            ? formatPlanPrice(data.subscription.amount_cents / 100)
            : "";
          setMessage(`Welcome! ${data.subscription?.restaurant_name || "Your restaurant"} is on ${planName}${amount ? ` (${amount})` : ""}. Taking you to the dashboard…`);
          setTimeout(() => {
            navigate("/dashboard", { replace: true });
          }, 900);
          return;
        }
        navigate("/login", { replace: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Signup failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, navigate]);

  return (
    <div className="lp">
      <nav className="navwrap">
        <div className="container navrow">
          <Link className="brand" to="/" aria-label={PRODUCT_NAME}>
            <img className="brand-wordmark" src={BRAND_ASSETS.logoHorizontalWhite} alt={PRODUCT_NAME} width={168} height={42} />
          </Link>
        </div>
      </nav>
      <section className="sec">
        <div className="container" style={{ maxWidth: 640 }}>
          <div className="cardx" style={{ padding: 32 }}>
            <span className="eyebrow">Signup</span>
            <h1 style={{ fontSize: 34, margin: "14px 0 8px" }}>
              {error ? "Almost there" : "Payment received"}
            </h1>
            {error ? (
              <>
                <p style={{ color: "var(--red)" }}>{error}</p>
                <Link className="btn btn-or" to="/#pricing">Back to pricing</Link>
              </>
            ) : (
              <p className="text-mut">{message}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
