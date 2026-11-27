import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ArrowUpDown,
  Calendar,
  ChevronDown,
  CircleDot,
  Code2,
  Layers,
  SlidersHorizontal,
  Tag,
  type LucideProps,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/restaurant";
import { getOrderStatusLabel } from "@/i18n/formatters";
import {
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  type OrderChannel,
} from "@/lib/orderChannel";

export type MobileFilterDraft = {
  status: string;
  categories: string[];
  channels: string[];
  orderType: "all" | "dine_in" | "pickup";
  datePreset: string;
  fromDate: string;
  toDate: string;
  sortBy: string;
};

type AccordionKey =
  | "status"
  | "category"
  | "channel"
  | "orderType"
  | "dateRange"
  | "sortBy";

type CategoryOption = { id: string; name: string };

type Props = {
  isAllOrdersPage: boolean;
  categories: CategoryOption[];
  applied: MobileFilterDraft;
  activeCount: number;
  onApply: (draft: MobileFilterDraft) => void;
  onResetAll: () => void;
};

const DEFAULT_DRAFT: MobileFilterDraft = {
  status: "all",
  categories: [],
  channels: [],
  orderType: "all",
  datePreset: "all",
  fromDate: "",
  toDate: "",
  sortBy: "newest",
};

function parseList(value: string): string[] {
  if (!value || value === "all") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function draftFromAppliedFilters(input: {
  statusFilter: string;
  categoryFilter: string;
  sourceFilter: string;
  fulfillmentFilter: "all" | "dine_in" | "pickup";
  datePreset: string;
  fromDate: string;
  toDate: string;
  sortBy: string;
}): MobileFilterDraft {
  return {
    status: input.statusFilter || "all",
    categories: parseList(input.categoryFilter),
    channels: parseList(input.sourceFilter),
    orderType: input.fulfillmentFilter || "all",
    datePreset: input.datePreset || "all",
    fromDate: input.fromDate || "",
    toDate: input.toDate || "",
    sortBy: input.sortBy || "newest",
  };
}

export function encodeCategoryFilter(categories: string[]): string {
  return categories.length ? categories.join(",") : "all";
}

export function encodeChannelFilter(channels: string[]): string {
  return channels.length ? channels.join(",") : "all";
}

export function countMobileActiveFilters(draft: MobileFilterDraft, isAllOrdersPage: boolean): number {
  let count = 0;
  if (isAllOrdersPage && draft.status !== "all") count++;
  if (draft.categories.length) count++;
  if (draft.channels.length) count++;
  if (draft.orderType !== "all") count++;
  if (draft.datePreset !== "all") count++;
  if (draft.sortBy !== "newest") count++;
  return count;
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-h-9 items-center rounded-full border px-3 text-[12px] font-medium transition-none",
        selected
          ? "border-[#EA580C] bg-[#FFEDD5] text-[#9A3412]"
          : "border-border bg-background text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function MobileOrderFilters({
  isAllOrdersPage,
  categories,
  applied,
  activeCount,
  onApply,
  onResetAll,
}: Props) {
  const { t } = useTranslation(["orders", "common"]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MobileFilterDraft>(applied);
  const [expanded, setExpanded] = useState<AccordionKey | null>("status");

  useEffect(() => {
    if (open) {
      setDraft(applied);
      setExpanded(isAllOrdersPage ? "status" : "category");
    }
  }, [open, applied, isAllOrdersPage]);

  const statusOptions = useMemo(
    () => [
      { value: "all", label: t("orders:all", "All") },
      ...ORDER_STATUSES.map((st) => ({
        value: st,
        label: getOrderStatusLabel(st as OrderStatus, t),
      })),
    ],
    [t],
  );

  const orderTypeOptions = useMemo(
    () => [
      { value: "all" as const, label: t("orders:any", "Any") },
      { value: "dine_in" as const, label: t("orders:dineIn", "Dine-in") },
      { value: "pickup" as const, label: t("orders:takeaway", "Takeaway") },
    ],
    [t],
  );

  const dateOptions = useMemo(
    () => [
      { value: "all", label: t("orders:allTime", "All time") },
      { value: "today", label: t("orders:today", "Today") },
      { value: "last_7_days", label: t("orders:last7DaysShort", "7 days") },
      { value: "last_30_days", label: t("orders:last30DaysShort", "30 days") },
      { value: "custom", label: t("orders:custom", "Custom") },
    ],
    [t],
  );

  const sortOptions = useMemo(
    () => [
      { value: "newest", label: t("orders:newest", "Newest") },
      { value: "oldest", label: t("orders:oldest", "Oldest") },
      { value: "highest_amount", label: t("orders:amountHigh", "Amount: high") },
      { value: "lowest_amount", label: t("orders:amountLow", "Amount: low") },
    ],
    [t],
  );

  const categorySummary = (() => {
    if (!draft.categories.length) return t("orders:all", "All");
    if (draft.categories.length > 2) {
      return t("orders:nSelected", "{{count}} selected", { count: draft.categories.length });
    }
    return draft.categories
      .map((id) => categories.find((c) => c.id === id)?.name || id)
      .join(", ");
  })();

  const channelSummary = (() => {
    if (!draft.channels.length) return t("orders:all", "All");
    if (draft.channels.length > 2) {
      return t("orders:nSelected", "{{count}} selected", { count: draft.channels.length });
    }
    return draft.channels
      .map((ch) => t(`orders:channel_${ch}`, ORDER_CHANNEL_LABELS[ch as OrderChannel] || ch))
      .join(", ");
  })();

  const statusSummary =
    draft.status === "all"
      ? t("orders:all", "All")
      : getOrderStatusLabel(draft.status as OrderStatus, t);

  const orderTypeSummary =
    orderTypeOptions.find((o) => o.value === draft.orderType)?.label || t("orders:any", "Any");

  const dateSummary =
    dateOptions.find((o) => o.value === draft.datePreset)?.label || t("orders:allTime", "All time");

  const sortSummary =
    sortOptions.find((o) => o.value === draft.sortBy)?.label || t("orders:newest", "Newest");

  const rows: {
    key: AccordionKey;
    label: string;
    icon: ComponentType<LucideProps>;
    summary: string;
    active: boolean;
    hidden?: boolean;
  }[] = [
    {
      key: "status",
      label: t("orders:orderStatusSentence", "Order status"),
      icon: CircleDot,
      summary: statusSummary,
      active: draft.status !== "all",
      hidden: !isAllOrdersPage,
    },
    {
      key: "category",
      label: t("orders:category", "Category"),
      icon: Layers,
      summary: categorySummary,
      active: draft.categories.length > 0,
    },
    {
      key: "channel",
      label: t("orders:channel", "Channel"),
      icon: Code2,
      summary: channelSummary,
      active: draft.channels.length > 0,
    },
    {
      key: "orderType",
      label: t("orders:orderTypeSentence", "Order type"),
      icon: Tag,
      summary: orderTypeSummary,
      active: draft.orderType !== "all",
    },
    {
      key: "dateRange",
      label: t("orders:dateRangeSentence", "Date range"),
      icon: Calendar,
      summary: dateSummary,
      active: draft.datePreset !== "all",
    },
    {
      key: "sortBy",
      label: t("orders:sortBySentence", "Sort by"),
      icon: ArrowUpDown,
      summary: sortSummary,
      active: draft.sortBy !== "newest",
    },
  ];

  const visibleRows = rows.filter((r) => !r.hidden);

  const toggleMulti = (key: "categories" | "channels", value: string) => {
    setDraft((prev) => {
      const list = prev[key];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [key]: next };
    });
  };

  const renderChips = (key: AccordionKey) => {
    if (key === "status") {
      return statusOptions.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          selected={draft.status === opt.value}
          onClick={() => setDraft((d) => ({ ...d, status: opt.value }))}
        />
      ));
    }
    if (key === "category") {
      return (
        <>
          <Chip
            label={t("orders:all", "All")}
            selected={draft.categories.length === 0}
            onClick={() => setDraft((d) => ({ ...d, categories: [] }))}
          />
          {categories.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name}
              selected={draft.categories.includes(cat.id)}
              onClick={() => toggleMulti("categories", cat.id)}
            />
          ))}
        </>
      );
    }
    if (key === "channel") {
      return (
        <>
          <Chip
            label={t("orders:all", "All")}
            selected={draft.channels.length === 0}
            onClick={() => setDraft((d) => ({ ...d, channels: [] }))}
          />
          {ORDER_CHANNELS.map((ch) => (
            <Chip
              key={ch}
              label={t(`orders:channel_${ch}`, ORDER_CHANNEL_LABELS[ch])}
              selected={draft.channels.includes(ch)}
              onClick={() => toggleMulti("channels", ch)}
            />
          ))}
        </>
      );
    }
    if (key === "orderType") {
      return orderTypeOptions.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          selected={draft.orderType === opt.value}
          onClick={() => setDraft((d) => ({ ...d, orderType: opt.value }))}
        />
      ));
    }
    if (key === "dateRange") {
      return (
        <>
          {dateOptions.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={draft.datePreset === opt.value}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  datePreset: opt.value,
                  ...(opt.value !== "custom" ? { fromDate: "", toDate: "" } : {}),
                }))
              }
            />
          ))}
          {draft.datePreset === "custom" ? (
            <div className="flex w-full flex-col gap-2 pt-1">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {t("orders:from", "From")}
                <input
                  type="date"
                  value={draft.fromDate}
                  onChange={(e) => setDraft((d) => ({ ...d, fromDate: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {t("orders:to", "To")}
                <input
                  type="date"
                  value={draft.toDate}
                  onChange={(e) => setDraft((d) => ({ ...d, toDate: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                />
              </label>
            </div>
          ) : null}
        </>
      );
    }
    return sortOptions.map((opt) => (
      <Chip
        key={opt.value}
        label={opt.label}
        selected={draft.sortBy === opt.value}
        onClick={() => setDraft((d) => ({ ...d, sortBy: opt.value }))}
      />
    ));
  };

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-11 min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold md:hidden",
          "border-[#FDBA74] bg-[#FFF7ED] text-[#C2410C]",
        )}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        <span>{t("orders:filters", "Filters")}</span>
        {activeCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EA580C] px-1.5 text-[10px] font-bold text-white">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          className={cn(
            "basis-full w-full overflow-x-hidden rounded-2xl border-[0.5px] border-border bg-card md:hidden",
          )}
        >
          <div className="divide-y divide-border/70">
            {visibleRows.map((row) => {
              const Icon = row.icon;
              const isExpanded = expanded === row.key;
              return (
                <div key={row.key} className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : row.key)}
                    className="flex min-h-[50px] w-full items-center gap-2.5 px-3 py-2.5 text-left"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-[#EA580C]" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {row.label}
                    </span>
                    <span
                      className={cn(
                        "max-w-[40%] shrink-0 truncate text-xs",
                        row.active
                          ? "font-medium text-[#C2410C]"
                          : "font-normal text-muted-foreground",
                      )}
                    >
                      {row.summary}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                        isExpanded && "rotate-180",
                      )}
                    />
                  </button>
                  {isExpanded ? (
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      {renderChips(row.key)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-border/70 p-3">
            <button
              type="button"
              onClick={() => {
                setDraft({ ...DEFAULT_DRAFT });
                onResetAll();
              }}
              className="h-[42px] flex-1 rounded-xl border border-border bg-background text-sm font-semibold text-foreground"
            >
              {t("orders:resetAll", "Reset all")}
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="h-[42px] flex-[1.4] rounded-xl bg-[#EA580C] text-sm font-semibold text-white"
            >
              {t("common:apply", "Apply")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
