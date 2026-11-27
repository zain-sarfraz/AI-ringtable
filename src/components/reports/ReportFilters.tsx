import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Store } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Shared trigger look for every report filter control. */
export const reportFilterTriggerClass =
  "h-10 w-full justify-start bg-card border-border/80 rounded-xl px-3.5 text-xs font-medium gap-2 shadow-sm hover:border-border sm:w-[180px]";

export const REPORT_DATE_PRESETS = [
  { value: "all", labelKey: "orders:allTime", fallback: "All time" },
  { value: "today", labelKey: "orders:today", fallback: "Today" },
  { value: "yesterday", labelKey: "orders:yesterday", fallback: "Yesterday" },
  { value: "7", labelKey: "orders:last7Days", fallback: "Last 7 days" },
  { value: "30", labelKey: "orders:last30Days", fallback: "Last 30 days" },
  { value: "90", labelKey: "orders:last90Days", fallback: "Last 90 days" },
  { value: "this_month", labelKey: "orders:thisMonth", fallback: "This month" },
  { value: "last_month", labelKey: "orders:lastMonth", fallback: "Last month" },
] as const;

export const REPORT_PERIOD_DAYS = [
  { value: "0", labelKey: "orders:allTime", fallback: "All time" },
  { value: "7", labelKey: "orders:last7Days", fallback: "Last 7 days" },
  { value: "30", labelKey: "orders:last30Days", fallback: "Last 30 days" },
  { value: "90", labelKey: "orders:last90Days", fallback: "Last 90 days" },
] as const;

type Props = {
  restaurants: { restaurant_id: string; restaurant_name: string }[];
  restaurantId: string;
  onRestaurantChange: (value: string) => void;
  showRestaurantFilter?: boolean;
  periodDays?: string;
  onPeriodChange?: (value: string) => void;
  showPeriod?: boolean;
  /** Richer date presets (all/today/7/30/90/…) instead of simple day counts. */
  datePreset?: string;
  onDatePresetChange?: (value: string) => void;
  showDatePreset?: boolean;
  extra?: ReactNode;
  className?: string;
};

export function ReportFilters({
  restaurants,
  restaurantId,
  onRestaurantChange,
  showRestaurantFilter = true,
  periodDays,
  onPeriodChange,
  showPeriod = false,
  datePreset,
  onDatePresetChange,
  showDatePreset = false,
  extra,
  className,
}: Props) {
  const { t } = useTranslation(["reports", "orders", "common"]);
  const showRestaurant = showRestaurantFilter && restaurants.length > 1;

  return (
    <div
      className={cn(
        "flex w-full flex-col flex-wrap items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center",
        className,
      )}
    >
      {showRestaurant ? (
        <Select value={restaurantId} onValueChange={onRestaurantChange}>
          <SelectTrigger className={cn(reportFilterTriggerClass, "sm:w-[200px]")}>
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
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
      ) : null}

      {showDatePreset && onDatePresetChange ? (
        <Select value={datePreset ?? "all"} onValueChange={onDatePresetChange}>
          <SelectTrigger className={reportFilterTriggerClass}>
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder={t("reports:datePreset", "Period")} />
          </SelectTrigger>
          <SelectContent>
            {REPORT_DATE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {t(p.labelKey, p.fallback)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {showPeriod && onPeriodChange && !showDatePreset ? (
        <Select value={periodDays ?? "0"} onValueChange={onPeriodChange}>
          <SelectTrigger className={reportFilterTriggerClass}>
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder={t("reports:datePreset", "Period")} />
          </SelectTrigger>
          <SelectContent>
            {REPORT_PERIOD_DAYS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {t(p.labelKey, p.fallback)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {extra}
    </div>
  );
}
