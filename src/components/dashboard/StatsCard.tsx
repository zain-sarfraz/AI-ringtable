import { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: "increase" | "decrease";
  };
  icon: LucideIcon;
  iconClassName?: string;
}

export function StatsCard({ title, value, change, icon: Icon, iconClassName }: StatsCardProps) {
  const { t } = useTranslation(["dashboard", "common"]);

  return (
    <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm">
      <CardContent className="relative p-4 sm:p-5">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-400/80 to-transparent" />
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-xs">{title}</p>
            <p className="text-xl font-extrabold tracking-tight text-foreground tabular-nums sm:text-2xl">{value}</p>
            {change && (
              <p
                className={cn(
                  "text-sm font-medium",
                  change.type === "increase" ? "text-status-available" : "text-destructive"
                )}
              >
                {change.type === "increase" ? "+" : "-"}
                {Math.abs(change.value)}%{" "}
                <span className="text-muted-foreground font-normal">{t("dashboard:vsLastWeek", "vs last week")}</span>
              </p>
            )}
          </div>
          <div
            className={cn(
              "p-2.5 rounded-lg shrink-0",
              iconClassName || "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

