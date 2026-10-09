import { useMemo } from "react";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useAuth } from "@/hooks/useAuth";
import { featuresForPlan, PlanFeatures } from "@/lib/billingPlans";

export function usePlanFeatures(): PlanFeatures & { plan: string | null; isSuperAdmin: boolean } {
  const { role } = useAuth();
  const { activeRestaurant } = useActiveRestaurant();
  const isSuperAdmin = role === "super_admin";
  const plan = activeRestaurant?.subscription_plan ?? null;

  return useMemo(() => {
    if (isSuperAdmin) {
      return {
        plan: plan || "growth",
        isSuperAdmin: true,
        branches: true,
        staff_management: true,
        max_locations: 999,
      };
    }
    return {
      plan,
      isSuperAdmin: false,
      ...featuresForPlan(plan),
    };
  }, [isSuperAdmin, plan]);
}
