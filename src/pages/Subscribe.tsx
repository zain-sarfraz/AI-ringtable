import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/** Legacy /subscribe URLs redirect into the payment-gated signup flow. */
export default function Subscribe() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const next = new URLSearchParams();
    const plan = params.get("plan");
    const interval = params.get("interval");
    if (plan) next.set("plan", plan);
    if (interval) next.set("interval", interval);
    navigate(`/signup?${next.toString()}`, { replace: true });
  }, [navigate, params]);

  return null;
}
