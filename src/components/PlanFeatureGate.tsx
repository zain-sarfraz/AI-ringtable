import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePlanFeatures } from "@/hooks/usePlanFeatures";

type Feature = "branches" | "staff_management";

export function PlanFeatureGate({
  feature,
  children,
}: {
  feature: Feature;
  children: ReactNode;
}) {
  const plan = usePlanFeatures();
  if (!plan[feature]) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
