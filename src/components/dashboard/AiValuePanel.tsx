import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Clock, Phone, PhoneCall, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/restaurant";
import { formatNumber } from "@/i18n/formatters";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Card, CardContent } from "@/components/ui/card";

type AiValue = {
  calls: number;
  answered: number;
  missed: number;
  orders: number;
  phone_orders: number;
  reservations: number;
  phone_reservations: number;
  order_value: number;
  staff_minutes_saved: number;
  staff_hours_saved: number;
  estimated_missed_revenue_avoided: number;
  estimated_revenue_recovered: number;
  estimated_revenue_still_missed: number;
  note: string;
};

function formatStaffTime(minutes: number) {
  if (!minutes) return "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded} hours`;
}

export function AiValuePanel({
  restaurantId,
  embedded = false,
}: {
  restaurantId: string | null;
  embedded?: boolean;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["ai-value", restaurantId],
    queryFn: async () => {
      const url = restaurantId
        ? `${getApiBase()}/api/stats/ai-value?restaurant_id=${encodeURIComponent(restaurantId)}`
        : `${getApiBase()}/api/stats/ai-value`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!resp.ok) throw new Error("Failed to load AI value");
      return (await resp.json()) as AiValue;
    },
    refetchInterval: 60000,
  });

  const calls = data?.calls ?? 0;
  const answered = data?.answered ?? 0;
  const orders = data?.orders ?? 0;
  const reservations = data?.reservations ?? 0;
  const phoneOrders = data?.phone_orders ?? 0;
  const phoneReservations = data?.phone_reservations ?? 0;
  const allZero =
    !isPending &&
    !isError &&
    calls === 0 &&
    answered === 0 &&
    orders === 0 &&
    reservations === 0;

  const monthTiles = [
    { icon: Phone, label: "Calls", value: formatNumber(calls) },
    { icon: PhoneCall, label: "Answered", value: formatNumber(answered) },
    { icon: ShoppingBag, label: "Orders", value: formatNumber(orders) },
    { icon: UtensilsCrossed, label: "Reservations", value: formatNumber(reservations) },
    { icon: ShoppingBag, label: "Order value", value: isPending ? "…" : formatCurrency(data?.order_value ?? 0) },
    { icon: Clock, label: "Staff time saved", value: formatStaffTime(data?.staff_minutes_saved ?? 0) },
  ];

  const aiLines = [
    { label: "AI answered", value: `${formatNumber(answered)} calls` },
    { label: "Orders captured", value: formatNumber(phoneOrders) },
    { label: "Reservations made", value: formatNumber(phoneReservations) },
    { label: "Revenue generated", value: isPending ? "…" : formatCurrency(data?.estimated_revenue_recovered ?? 0) },
    {
      label: "Estimated revenue recovered from missed calls",
      value: isPending ? "…" : formatCurrency(data?.estimated_missed_revenue_avoided ?? 0),
    },
  ];

  const monthCard = (
      <Card className={embedded ? "rounded-xl border-border/70 shadow-none" : "rounded-xl border-border/80 shadow-sm overflow-hidden"}>
        <CardContent className={embedded ? "p-0 space-y-5" : "p-5 sm:p-6 space-y-5"}>
          <div>
            {!embedded && (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Missed revenue</p>
            )}
            <h2 className={`${embedded ? "text-sm font-semibold text-muted-foreground" : "mt-1 text-xl font-extrabold tracking-tight"}`}>
              Last 30 days
            </h2>
            {!embedded && (
              <p className="mt-1 text-sm text-muted-foreground">
                Live totals from calls, orders, and reservations. The estimate uses those totals.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {monthTiles.map((tile) => (
              <div key={tile.label} className="rounded-xl border border-border/70 bg-card px-4 py-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <tile.icon className="h-4 w-4" aria-hidden />
                  <p className="text-[11px] font-semibold uppercase tracking-wider">{tile.label}</p>
                </div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">
                  {isPending ? "…" : tile.value}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-4 sm:px-5">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Estimated missed revenue avoided</p>
            <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-emerald-700 dark:text-emerald-200">
              {isPending ? "…" : formatCurrency(data?.estimated_missed_revenue_avoided ?? 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Answered calls × phone-order conversion × average order.
              {data && data.estimated_revenue_still_missed > 0
                ? ` Unanswered calls at the same rate are still about ${formatCurrency(data.estimated_revenue_still_missed)}.`
                : ""}
            </p>
          </div>
          {allZero && (
            <p className="text-sm text-muted-foreground">
              No calls, orders, or reservations in the last 30 days for this restaurant on this dashboard’s database.
              Phone orders only appear here when the AI agent tools point at the same API this dashboard uses.
            </p>
          )}
          {isError && <p className="text-sm text-destructive">Could not load the last 30 days’ numbers.</p>}
        </CardContent>
      </Card>
  );

  if (embedded) return monthCard;

  return (
    <section className="space-y-4">
      {monthCard}
      <Card className="rounded-xl border-border/80 shadow-sm overflow-hidden">
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <CalendarCheck className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">What the phone AI captured</h3>
              <p className="text-sm text-muted-foreground">Phone and AI orders only, for {monthLabel}.</p>
            </div>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {aiLines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                <dt className="text-sm text-muted-foreground">{line.label}</dt>
                <dd className="text-sm font-bold tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
          {data?.note && <p className="text-xs leading-relaxed text-muted-foreground">{data.note}</p>}
        </CardContent>
      </Card>
    </section>
  );
}
