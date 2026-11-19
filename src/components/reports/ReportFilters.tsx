import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  restaurants: { restaurant_id: string; restaurant_name: string }[];
  restaurantId: string;
  onRestaurantChange: (value: string) => void;
  showRestaurantFilter?: boolean;
  periodDays?: string;
  onPeriodChange?: (value: string) => void;
  showPeriod?: boolean;
  extra?: ReactNode;
};

export function ReportFilters({
  restaurants,
  restaurantId,
  onRestaurantChange,
  showRestaurantFilter = true,
  periodDays,
  onPeriodChange,
  showPeriod = false,
  extra,
}: Props) {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { t } = useTranslation(["reports", "orders", "common"]);

  const periodOptions = [
    { value: "0", label: t("orders:allTime", "All time") },
    { value: "7", label: t("orders:last7Days", "Last 7 days") },
    { value: "30", label: t("orders:last30Days", "Last 30 days") },
    { value: "90", label: t("orders:last90Days", "Last 90 days") },
  ];

  return (
    <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto">
      {showRestaurantFilter && isSuperAdmin && restaurants.length > 1 && (
        <Select value={restaurantId} onValueChange={onRestaurantChange}>
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder={t("reports:selectRestaurant", "Restaurant")} />
          </SelectTrigger>
          <SelectContent>
            {restaurants.map((r) => (
              <SelectItem key={r.restaurant_id} value={r.restaurant_id}>
                {r.restaurant_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {showPeriod && onPeriodChange && (
        <Select value={periodDays ?? "0"} onValueChange={onPeriodChange}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t("reports:datePreset", "Period")} />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {extra}
    </div>
  );
}

