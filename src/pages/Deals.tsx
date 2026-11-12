import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Tag, Trash2, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/restaurant";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { DealsImportButton } from "@/components/deals/DealsImportButton";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { useAuth } from "@/hooks/useAuth";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/i18n/formatters";
import { syncRestaurantMenuToVoiceAgent } from "@/lib/syncRestaurantMenuToVoiceAgent";

interface Deal {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  original_price: number | null;
  image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** 0=Sun … 6=Sat. Empty = every day. */
  available_days?: number[] | null;
  available_start_time?: string | null;
  available_end_time?: string | null;
  is_active: boolean;
}
interface Discount { id: string; code: string; description: string | null; discount_type: string; discount_value: number; min_order_amount: number; max_uses: number | null; used_count: number; starts_at: string | null; ends_at: string | null; is_active: boolean }

const DEAL_WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function normalizeDealDays(days: unknown): number[] {
  let raw: unknown = days;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

function timeInputValue(t: string | null | undefined): string {
  if (t == null || t === "") return "";
  const s = String(t).trim();
  // Postgres TIME may arrive as "17:04:00" or "17:04:00.000"
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** datetime-local value in the browser's local timezone (never slice UTC ISO directly). */
function toDatetimeLocalValue(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) {
    const s = String(value);
    return s.length >= 16 ? s.slice(0, 16) : "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Persist datetime-local wall time as UTC ISO for timestamptz columns. */
function fromDatetimeLocalValue(local: string | null | undefined): string | null {
  if (local == null || !String(local).trim()) return null;
  const d = new Date(String(local).trim());
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function formatDealSchedule(d: Pick<Deal, "available_days" | "available_start_time" | "available_end_time">): string {
  const days = normalizeDealDays(d.available_days);
  const dayPart =
    days.length === 0
      ? "Every day"
      : days
          .map((v) => DEAL_WEEKDAYS.find((x) => x.value === v)?.label || String(v))
          .join(", ");
  const start = timeInputValue(d.available_start_time);
  const end = timeInputValue(d.available_end_time);
  if (!start && !end) return dayPart;
  return `${dayPart} · ${start || "00:00"}–${end || "23:59"}`;
}

type DealFieldKey = "name" | "description" | "price" | "original_price" | "dates" | "schedule";

function validateDealForm(form: Partial<Deal>): Partial<Record<DealFieldKey, string>> {
  const errors: Partial<Record<DealFieldKey, string>> = {};
  const name = (form.name ?? "").trim();
  if (!name) errors.name = "Name is required.";
  else if (name.length > 200) errors.name = "Name must be at most 200 characters.";

  const descRaw = form.description;
  if (descRaw != null && String(descRaw).length > 5000) {
    errors.description = "Description must be at most 5000 characters.";
  }

  const rawPrice = form.price;
  const price = typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice ?? ""));
  if (!Number.isFinite(price)) errors.price = "Enter a valid price.";
  else if (price < 0) errors.price = "Price cannot be negative.";
  else if (price > 99_999_999.99) errors.price = "Price is too large (max 99,999,999.99).";

  const op = form.original_price;
  if (op != null && String(op).trim() !== "") {
    const orig = typeof op === "number" ? op : parseFloat(String(op));
    if (!Number.isFinite(orig)) errors.original_price = "Enter a valid original price or leave it empty.";
    else if (orig < 0) errors.original_price = "Original price cannot be negative.";
    else if (orig > 99_999_999.99) errors.original_price = "Original price is too large.";
    else if (Number.isFinite(price) && orig < price) {
      errors.original_price = "Original price should be at least the deal price.";
    }
  }

  const s = form.starts_at;
  const e = form.ends_at;
  if (s && e) {
    const ts = new Date(s).getTime();
    const te = new Date(e).getTime();
    if (!Number.isFinite(ts) || !Number.isFinite(te)) errors.dates = "Enter valid start and end dates.";
    else if (ts > te) errors.dates = "End date/time must be on or after the start.";
  }

  const startT = timeInputValue(form.available_start_time);
  const endT = timeInputValue(form.available_end_time);
  if ((startT && !endT) || (!startT && endT)) {
    errors.schedule = "Set both daily start and end time, or leave both empty.";
  } else if (startT && endT && startT === endT) {
    errors.schedule = "Daily end time must be after start time (or leave both empty for all day).";
  }

  return errors;
}

type DealClusterRow = Pick<
  Deal,
  | "id"
  | "restaurant_id"
  | "name"
  | "description"
  | "price"
  | "original_price"
  | "image_url"
  | "starts_at"
  | "ends_at"
  | "available_days"
  | "available_start_time"
  | "available_end_time"
  | "is_active"
>;

function dealPriceNorm(n: unknown): string {
  const x = typeof n === "number" ? n : parseFloat(String(n ?? ""));
  if (!Number.isFinite(x)) return "";
  return String(Math.round(x * 100) / 100);
}

/** Best-effort grouping for multi-restaurant copies (same fields; no shared DB group id). */
function dealIdentityKey(
  d: Pick<
    Deal,
    | "name"
    | "description"
    | "price"
    | "original_price"
    | "image_url"
    | "starts_at"
    | "ends_at"
    | "available_days"
    | "available_start_time"
    | "available_end_time"
    | "is_active"
  >,
) {
  const desc = d.description == null ? "" : String(d.description);
  const orig = d.original_price == null ? "" : dealPriceNorm(d.original_price);
  return [
    (d.name ?? "").trim(),
    desc,
    dealPriceNorm(d.price),
    orig,
    (d.image_url ?? "").trim(),
    d.starts_at ?? "",
    d.ends_at ?? "",
    normalizeDealDays(d.available_days).join(","),
    timeInputValue(d.available_start_time),
    timeInputValue(d.available_end_time),
    d.is_active ? "1" : "0",
  ].join("\0");
}

function buildDealRestaurantClusters(
  rows: DealClusterRow[],
  restaurantNameById: Map<string, string>,
): Record<string, { count: number; restaurantNames: string[] }> {
  const fpToRestaurantIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const fp = dealIdentityKey(row);
    if (!fpToRestaurantIds.has(fp)) fpToRestaurantIds.set(fp, new Set());
    fpToRestaurantIds.get(fp)!.add(row.restaurant_id);
  }
  const fpToSortedNames = new Map<string, string[]>();
  for (const [fp, rids] of fpToRestaurantIds) {
    const names = [...rids]
      .map((id) => restaurantNameById.get(id) || "Unknown")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    fpToSortedNames.set(fp, names);
  }
  const byDealId: Record<string, { count: number; restaurantNames: string[] }> = {};
  for (const row of rows) {
    const fp = dealIdentityKey(row);
    byDealId[row.id] = {
      count: fpToRestaurantIds.get(fp)!.size,
      restaurantNames: fpToSortedNames.get(fp)!,
    };
  }
  return byDealId;
}

function buildDealRestaurantIdClusters(
  rows: DealClusterRow[],
): Record<string, string[]> {
  const fpToRestaurantIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const fp = dealIdentityKey(row);
    if (!fpToRestaurantIds.has(fp)) fpToRestaurantIds.set(fp, new Set());
    fpToRestaurantIds.get(fp)!.add(row.restaurant_id);
  }
  const byDealId: Record<string, string[]> = {};
  for (const row of rows) {
    const fp = dealIdentityKey(row);
    byDealId[row.id] = [...(fpToRestaurantIds.get(fp) ?? new Set())];
  }
  return byDealId;
}

function fmtTableDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

type DealFormSubmit = Partial<Deal> & { restaurant_ids?: string[] };

export default function Deals() {
  const { t } = useTranslation(["deals", "common"]);
  const { toast } = useToast();
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { restaurantId, loading: activeRestaurantLoading } = useActiveRestaurant();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [dealDialog, setDealDialog] = useState(false);
  const [discDialog, setDiscDialog] = useState(false);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [restaurantPickerList, setRestaurantPickerList] = useState<{ id: string; name: string }[]>([]);
  const [dealRestaurantCluster, setDealRestaurantCluster] = useState<
    Record<string, { count: number; restaurantNames: string[] }>
  >({});
  const [dealRestaurantIdsMap, setDealRestaurantIdsMap] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    if (!restaurantId) return;
    const { data: dData } = await supabase
      .from("deals")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("name");
    const list = (dData as Deal[]) || [];
    const { data: rRow } = await supabase.from("restaurants").select("name").eq("id", restaurantId).maybeSingle();
    const rName = rRow?.name ?? null;
    setRestaurantName(rName);
    setRestaurantPickerList(rName ? [{ id: restaurantId, name: rName }] : []);
    const nameMap = new Map<string, string>([[restaurantId, rName || "Current restaurant"]]);
    setDealRestaurantCluster(buildDealRestaurantClusters(list, nameMap));
    setDealRestaurantIdsMap(buildDealRestaurantIdClusters(list));
    setDeals(list);
  }, [restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDeal = async (form: DealFormSubmit) => {
    const { restaurant_ids: pickedIds, ...dealFields } = form;
    const days = normalizeDealDays(dealFields.available_days);
    const startT = timeInputValue(dealFields.available_start_time);
    const endT = timeInputValue(dealFields.available_end_time);
    const basePayload = {
      name: dealFields.name,
      description: dealFields.description || null,
      price: dealFields.price ?? 0,
      original_price: dealFields.original_price ?? null,
      image_url: dealFields.image_url ?? null,
      // Campaign window: convert datetime-local → UTC ISO for timestamptz
      starts_at: fromDatetimeLocalValue(dealFields.starts_at),
      ends_at: fromDatetimeLocalValue(dealFields.ends_at),
      // Must be JSON text: knex/pg rejects JS arrays for jsonb ("invalid input syntax for type json")
      available_days: JSON.stringify(days),
      // Daily wall-clock window (HH:MM) — not timezone-shifted
      available_start_time: startT || null,
      available_end_time: endT || null,
      is_active: dealFields.is_active ?? true,
    };

    if (editDeal) {
      if (isSuperAdmin && pickedIds && pickedIds.length > 0) {
        const initialLinked = dealRestaurantIdsMap[editDeal.id] ?? [editDeal.restaurant_id];
        const fp = dealIdentityKey(editDeal);
        const { data: fullRows } = await supabase.from("deals").select("*");
        const matchingCluster = ((fullRows as Deal[]) || []).filter((r) => dealIdentityKey(r) === fp);
        const currentRestIds = new Set(matchingCluster.map((r) => r.restaurant_id));
        const desiredRestIds = new Set(pickedIds);

        for (const row of matchingCluster) {
          if (!desiredRestIds.has(row.restaurant_id)) {
            await supabase.from("deals").delete().eq("id", row.id);
          }
        }
        for (const row of matchingCluster) {
          if (desiredRestIds.has(row.restaurant_id)) {
            await supabase.from("deals").update(basePayload).eq("id", row.id);
          }
        }
        const toAdd = pickedIds.filter((rid) => !currentRestIds.has(rid));
        if (toAdd.length) {
          await supabase.from("deals").insert(toAdd.map((restaurant_id) => ({ ...basePayload, restaurant_id })));
        }
        toast({ title: t("deals:editDeal", "Deal updated"), description: `Synced across ${pickedIds.length} restaurant(s).` });
        setDealDialog(false);
        setEditDeal(null);
        void load();
        return;
      }

      let q = supabase.from("deals").update(basePayload).eq("id", editDeal.id);
      if (!isSuperAdmin) q = q.eq("restaurant_id", restaurantId);
      const res = await q;
      if (res.error) toast({ variant: "destructive", title: t("common:error", "Failed"), description: (res.error as any)?.message || "Failed to update deal" });
      else {
        toast({ title: t("deals:editDeal", "Deal updated") });
        setDealDialog(false);
        setEditDeal(null);
        void load();
        if (restaurantId) void syncRestaurantMenuToVoiceAgent(restaurantId);
      }
      return;
    }

    const targetIds =
      isSuperAdmin && pickedIds && pickedIds.length > 0
        ? pickedIds
        : restaurantId
          ? [restaurantId]
          : [];

    if (!targetIds.length) {
      toast({
        variant: "destructive",
        title: "Restaurant required",
        description: isSuperAdmin ? "Select at least one restaurant." : "No restaurant is linked to your account.",
      });
      return;
    }

    const rows = targetIds.map((restaurant_id) => ({ ...basePayload, restaurant_id }));
    const res = await supabase.from("deals").insert(rows);
    if (res.error) toast({ variant: "destructive", title: t("common:error", "Failed"), description: (res.error as any)?.message || "Failed to create deal" });
    else {
      const n = rows.length;
      if (isSuperAdmin && n > 1) {
        toast({
          title: "Deals created",
          description: `Created ${n} copies (one per selected restaurant).`,
        });
      } else {
        toast({
          title: "Deal created",
        });
      }
      setDealDialog(false);
      setEditDeal(null);
      void load();
      for (const rid of targetIds) {
        void syncRestaurantMenuToVoiceAgent(rid);
      }
    }
  };

  if (activeRestaurantLoading) {
    return <p className="text-muted-foreground p-4">{t("common:loading", "Loading…")}</p>;
  }
  if (!restaurantId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-muted-foreground">
        <p className="font-medium text-foreground">{t("deals:noRestaurantSelected", "No restaurant selected")}</p>
        <p className="text-sm mt-1">{t("deals:selectRestaurantToManage", "Select or join a restaurant to manage deals.")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="h-6 w-6 text-primary" />
            {t("deals:title", "Deals & Offers")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("deals:subtitle", "Combo deals and promotional offers")}</p>
        </div>
        <div className="flex items-center gap-2">
          <DealsImportButton restaurantId={restaurantId} type="deals" onImported={() => void load()} />
          <Dialog open={dealDialog} onOpenChange={(o) => { setDealDialog(o); if (!o) setEditDeal(null); }}>
            <DialogTrigger asChild>
              <Button type="button" onClick={() => setEditDeal(null)}>
                <Plus className="h-4 w-4 mr-1" />{t("deals:addDeal", "New deal")}
              </Button>
            </DialogTrigger>
            <DealForm
              initial={editDeal}
              initialRestaurantIds={editDeal ? dealRestaurantIdsMap[editDeal.id] ?? [editDeal.restaurant_id] : [restaurantId]}
              restaurantName={restaurantName}
              defaultRestaurantId={restaurantId}
              showRestaurantPicker={false}
              restaurantPickerOptions={[]}
              onSubmit={saveDeal}
            />
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left bg-muted/50">
              <tr>
                <th className="p-3 w-14">{t("deals:colImage", "Image")}</th>
                <th className="p-3">{t("deals:colName", "Name")}</th>
                <th className="p-3 max-w-[200px]">{t("deals:colDescription", "Description")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colPrice", "Price")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colOriginal", "Original")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colStarts", "Starts")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colEnds", "Ends")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colSchedule", "Days / Time")}</th>
                <th className="p-3 whitespace-nowrap">{t("deals:colRestaurants", "Restaurants")}</th>
                <th className="p-3">{t("deals:colStatus", "Status")}</th>
                <th className="p-3 w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const cluster = dealRestaurantCluster[d.id];
                const restaurantCount = cluster?.count ?? 1;
                const restaurantNames =
                  cluster?.restaurantNames?.length ? cluster.restaurantNames : restaurantName ? [restaurantName] : [];
                const tooltipTitle = restaurantNames.join(", ");
                const imgSrc = resolveMediaUrl(d.image_url);
                return (
                  <tr key={d.id} className="border-t">
                    <td className="p-2 align-middle">
                      {imgSrc ? (
                        <img src={imgSrc} alt="" className="h-10 w-10 rounded object-cover border" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3 align-middle font-medium">{d.name}</td>
                    <td className="p-3 align-middle text-muted-foreground max-w-[220px] truncate" title={d.description || undefined}>{d.description || "—"}</td>
                    <td className="p-3 align-middle whitespace-nowrap">{formatCurrency(d.price)}</td>
                    <td className="p-3 align-middle whitespace-nowrap text-muted-foreground">{d.original_price != null ? formatCurrency(d.original_price) : "—"}</td>
                    <td className="p-3 align-middle whitespace-nowrap text-muted-foreground">{fmtTableDate(d.starts_at)}</td>
                    <td className="p-3 align-middle whitespace-nowrap text-muted-foreground">{fmtTableDate(d.ends_at)}</td>
                    <td className="p-3 align-middle text-muted-foreground text-sm max-w-[180px]" title={formatDealSchedule(d)}>
                      {formatDealSchedule(d)}
                    </td>
                    <td className="p-3 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "tabular-nums font-medium text-foreground rounded px-1.5 py-0.5 -mx-1.5",
                              "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              restaurantNames.length ? "cursor-help underline decoration-dotted underline-offset-2" : "",
                            )}
                            aria-label={tooltipTitle ? `Restaurants: ${tooltipTitle}` : "Restaurants"}
                          >
                            {restaurantCount}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs font-medium text-foreground mb-1.5">
                            {restaurantCount === 1 ? "Restaurant" : `${restaurantCount} restaurants`}
                          </p>
                          {restaurantNames.length > 0 ? (
                            <ul className="text-xs text-popover-foreground list-disc pl-4 space-y-0.5">
                              {restaurantNames.map((n, idx) => (
                                <li key={`${n}-${idx}`}>{n}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">No names loaded.</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="p-3 align-middle">
                      {d.is_active ? (
                        <Badge variant="outline" className="bg-green-500/15 text-green-700">{t("deals:active", "Active")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("deals:inactive", "Inactive")}</Badge>
                      )}
                    </td>
                    <td className="p-2 align-middle">
                      <Button size="sm" variant="ghost" onClick={() => { setEditDeal(d); setDealDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(t("common:confirmDelete", "Delete?"))) return;
                          let q = supabase.from("deals").delete().eq("id", d.id);
                          if (!isSuperAdmin) q = q.eq("restaurant_id", restaurantId);
                          const { error } = await q;
                          if (error) toast({ variant: "destructive", title: t("common:error", "Failed"), description: (error as any)?.message || "Failed to delete deal" });
                          else {
                            void load();
                            if (restaurantId) void syncRestaurantMenuToVoiceAgent(restaurantId);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {deals.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-10 text-center text-muted-foreground">{t("deals:noDeals", "No deals yet")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function DealForm({
  initial,
  initialRestaurantIds,
  restaurantName,
  defaultRestaurantId,
  showRestaurantPicker,
  restaurantPickerOptions,
  onSubmit,
}: {
  initial: Deal | null;
  initialRestaurantIds: string[];
  restaurantName: string | null;
  defaultRestaurantId: string;
  showRestaurantPicker: boolean;
  restaurantPickerOptions: { id: string; name: string }[];
  onSubmit: (f: DealFormSubmit) => void | Promise<void>;
}) {
  const { t } = useTranslation(["deals", "common"]);
  const { toast } = useToast();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DealFieldKey, string>>>({});
  const [form, setForm] = useState<Partial<Deal>>(
    () =>
      initial || {
        name: "",
        description: "",
        price: 0,
        original_price: null,
        image_url: null,
        starts_at: null,
        ends_at: null,
        available_days: [],
        available_start_time: null,
        available_end_time: null,
        is_active: true,
        restaurant_id: defaultRestaurantId,
      },
  );
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<string[]>([defaultRestaurantId]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        // Keep datetime-local strings in form state (not raw UTC ISO)
        starts_at: toDatetimeLocalValue(initial.starts_at) || null,
        ends_at: toDatetimeLocalValue(initial.ends_at) || null,
        available_days: normalizeDealDays(initial.available_days),
        available_start_time: timeInputValue(initial.available_start_time) || null,
        available_end_time: timeInputValue(initial.available_end_time) || null,
      });
      setSelectedRestaurantIds(initialRestaurantIds.length ? initialRestaurantIds : [initial.restaurant_id]);
    } else {
      setForm({
        name: "",
        description: "",
        price: 0,
        original_price: null,
        image_url: null,
        starts_at: null,
        ends_at: null,
        available_days: [],
        available_start_time: null,
        available_end_time: null,
        is_active: true,
        restaurant_id: defaultRestaurantId,
      });
      setSelectedRestaurantIds([defaultRestaurantId]);
    }
    setImageFile(null);
    setFieldErrors({});
  }, [initial, defaultRestaurantId, initialRestaurantIds]);

  const toggleRestaurantPick = (id: string) => {
    setSelectedRestaurantIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const selectedLabel = selectedRestaurantIds
    .map((rid) => restaurantPickerOptions.find((x) => x.id === rid)?.name)
    .filter(Boolean)
    .join(", ");

  const filePreview = imageFile ? URL.createObjectURL(imageFile) : null;
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  const displayImageSrc = filePreview ?? resolveMediaUrl(form.image_url) ?? undefined;

  const clearFieldError = (key: DealFieldKey) => {
    setFieldErrors((fe) => {
      if (!fe[key]) return fe;
      const next = { ...fe };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    const errs = validateDealForm(form);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    if (!initial && showRestaurantPicker && selectedRestaurantIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Select a restaurant",
        description: "Choose at least one restaurant for this deal.",
      });
      return;
    }

    setUploading(true);
    try {
      let image_url: string | null = form.image_url ?? null;
      if (imageFile) {
        const token = getToken();
        if (!token) {
          toast({ variant: "destructive", title: "Not signed in", description: "Sign in to upload images." });
          return;
        }
        const fd = new FormData();
        fd.append("file", imageFile);
        const res = await fetch(`${getApiBase()}/api/uploads/deal-image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ variant: "destructive", title: "Image upload failed", description: typeof j.error === "string" ? j.error : res.statusText });
          return;
        }
        if (!j.url || typeof j.url !== "string") {
          toast({ variant: "destructive", title: "Upload failed", description: "Invalid response from server." });
          return;
        }
        image_url = j.url;
      }
      const base: DealFormSubmit = { ...form, image_url };
      if (!initial && showRestaurantPicker && selectedRestaurantIds.length) {
        base.restaurant_ids = selectedRestaurantIds;
      }
      await onSubmit(base);
    } finally {
      setUploading(false);
    }
  };

  const origInputValue =
    form.original_price === null || form.original_price === undefined ? "" : String(form.original_price);

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initial ? t("deals:editDeal", "Edit deal") : t("deals:addDeal", "New deal")}</DialogTitle>
        {showRestaurantPicker ? (
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            {initial
              ? "Super admin: move this deal to another restaurant if needed."
              : "Super admin: select one or more restaurants."}
          </DialogDescription>
        ) : restaurantName ? (
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            {restaurantName}
          </DialogDescription>
        ) : (
          <DialogDescription className="text-sm text-muted-foreground pt-1">Saved for your authenticated restaurant.</DialogDescription>
        )}
      </DialogHeader>
      <div className="space-y-3 pt-4 pb-4">
        {showRestaurantPicker && restaurantPickerOptions.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t("deals:selectRestaurants", "Restaurants")}</Label>
              <div className="flex gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedRestaurantIds(restaurantPickerOptions.map((r) => r.id))}
                >
                  {t("deals:selectAll", "Select all")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedRestaurantIds(initial ? initialRestaurantIds : [defaultRestaurantId])}
                >
                  {t("deals:reset", "Reset")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {initial
                ? "Editing updates one grouped deal across selected locations."
                : "Creates one deal row per selected location (same details and image)."}
            </p>
            <div className="max-h-52 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1.5">
              {restaurantPickerOptions.map((row) => (
                <label
                  key={row.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/80"
                >
                  <Checkbox
                    checked={selectedRestaurantIds.includes(row.id)}
                    onCheckedChange={() => toggleRestaurantPick(row.id)}
                  />
                  <span className="flex-1">{row.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedRestaurantIds.length} {t("deals:colRestaurants", "Restaurants")}
            </p>
          </div>
        ) : null}
        {showRestaurantPicker && selectedLabel ? (
          <p className="text-xs text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{selectedLabel}</span>
          </p>
        ) : null}
        <div>
          <Label htmlFor="deal-name">{t("deals:colName", "Name")}</Label>
          <Input
            id="deal-name"
            required
            maxLength={200}
            value={form.name || ""}
            aria-invalid={!!fieldErrors.name}
            className={cn(fieldErrors.name && "border-destructive focus-visible:ring-destructive")}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError("name");
            }}
          />
          {fieldErrors.name ? <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p> : null}
        </div>
        <div>
          <Label htmlFor="deal-description">{t("deals:colDescription", "Description")}</Label>
          <Textarea
            id="deal-description"
            maxLength={5000}
            value={form.description || ""}
            aria-invalid={!!fieldErrors.description}
            className={cn(fieldErrors.description && "border-destructive focus-visible:ring-destructive")}
            onChange={(e) => {
              setForm({ ...form, description: e.target.value });
              clearFieldError("description");
            }}
          />
          {fieldErrors.description ? (
            <p className="text-xs text-destructive mt-1">{fieldErrors.description}</p>
          ) : (form.description || "").length > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">{(form.description || "").length} / 5000</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="deal-price">{t("deals:colPrice", "Price")}</Label>
            <Input
              id="deal-price"
              type="number"
              min={0}
              max={99999999.99}
              step="0.01"
              inputMode="decimal"
              value={form.price ?? 0}
              aria-invalid={!!fieldErrors.price}
              className={cn(fieldErrors.price && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                const v = e.target.value;
                const n = v === "" ? 0 : parseFloat(v);
                setForm({ ...form, price: Number.isFinite(n) ? n : 0 });
                clearFieldError("price");
                clearFieldError("original_price");
              }}
            />
            {fieldErrors.price ? <p className="text-xs text-destructive mt-1">{fieldErrors.price}</p> : null}
          </div>
          <div>
            <Label htmlFor="deal-original">{t("deals:colOriginal", "Original price")}</Label>
            <Input
              id="deal-original"
              type="number"
              min={0}
              max={99999999.99}
              step="0.01"
              inputMode="decimal"
              value={origInputValue}
              aria-invalid={!!fieldErrors.original_price}
              className={cn(fieldErrors.original_price && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") setForm({ ...form, original_price: null });
                else {
                  const n = parseFloat(v);
                  setForm({ ...form, original_price: Number.isFinite(n) ? n : null });
                }
                clearFieldError("original_price");
                clearFieldError("price");
              }}
            />
            {fieldErrors.original_price ? (
              <p className="text-xs text-destructive mt-1">{fieldErrors.original_price}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t("deals:dealImage", "Deal image")}</Label>
          {displayImageSrc ? <img src={displayImageSrc} alt="" className="w-full h-32 object-cover rounded-md border" /> : null}
          <Input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setImageFile(f ?? null);
            }}
          />
          {(form.image_url || imageFile) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setImageFile(null);
                setForm((prev) => ({ ...prev, image_url: null }));
              }}
            >
              {t("deals:removeImage", "Remove image")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("deals:imageHint", "JPEG, PNG, GIF, or WebP — up to 5MB.")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="deal-starts">{t("deals:colStarts", "Starts")}</Label>
            <Input
              id="deal-starts"
              type="datetime-local"
              value={toDatetimeLocalValue(form.starts_at)}
              aria-invalid={!!fieldErrors.dates}
              className={cn(fieldErrors.dates && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                setForm({ ...form, starts_at: e.target.value || null });
                clearFieldError("dates");
              }}
            />
          </div>
          <div>
            <Label htmlFor="deal-ends">{t("deals:colEnds", "Ends")}</Label>
            <Input
              id="deal-ends"
              type="datetime-local"
              value={toDatetimeLocalValue(form.ends_at)}
              aria-invalid={!!fieldErrors.dates}
              className={cn(fieldErrors.dates && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                setForm({ ...form, ends_at: e.target.value || null });
                clearFieldError("dates");
              }}
            />
          </div>
        </div>
        {fieldErrors.dates ? <p className="text-xs text-destructive">{fieldErrors.dates}</p> : null}
        <div className="space-y-2">
          <Label>{t("deals:availableDays", "Available days")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("deals:availableDaysHint", "Leave all unselected for every day. Select one or more weekdays to limit the deal.")}
          </p>
          <div className="flex flex-wrap gap-2">
            {DEAL_WEEKDAYS.map((day) => {
              const selected = normalizeDealDays(form.available_days).includes(day.value);
              return (
                <Button
                  key={day.value}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => {
                    const current = normalizeDealDays(form.available_days);
                    const next = selected ? current.filter((d) => d !== day.value) : [...current, day.value];
                    setForm({ ...form, available_days: normalizeDealDays(next) });
                    clearFieldError("schedule");
                  }}
                >
                  {day.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="deal-day-start">{t("deals:availableStartTime", "Daily start time")}</Label>
            <Input
              id="deal-day-start"
              type="time"
              step={60}
              value={timeInputValue(form.available_start_time)}
              aria-invalid={!!fieldErrors.schedule}
              className={cn(fieldErrors.schedule && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                setForm({ ...form, available_start_time: timeInputValue(e.target.value) || null });
                clearFieldError("schedule");
              }}
            />
          </div>
          <div>
            <Label htmlFor="deal-day-end">{t("deals:availableEndTime", "Daily end time")}</Label>
            <Input
              id="deal-day-end"
              type="time"
              step={60}
              value={timeInputValue(form.available_end_time)}
              aria-invalid={!!fieldErrors.schedule}
              className={cn(fieldErrors.schedule && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                setForm({ ...form, available_end_time: timeInputValue(e.target.value) || null });
                clearFieldError("schedule");
              }}
            />
          </div>
        </div>
        {fieldErrors.schedule ? <p className="text-xs text-destructive">{fieldErrors.schedule}</p> : null}
        <p className="text-xs text-muted-foreground">
          {t(
            "deals:scheduleHint",
            "Optional daily window in restaurant local time (e.g. 11:00–15:00 Pakistan time). Leave empty for all day. Campaign Starts/Ends above still apply.",
          )}
        </p>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          <Label>{t("deals:active", "Active")}</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" onClick={() => void handleSave()} disabled={uploading}>
          {uploading ? t("common:saving", "Saving…") : t("common:save", "Save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DiscountForm({ initial, onSubmit }: { initial: Discount | null; onSubmit: (f: Partial<Discount>) => void }) {
  const { t } = useTranslation(["coupons", "common"]);
  const blank = (): Partial<Discount> => ({
    code: "",
    discount_type: "percentage",
    discount_value: 10,
    min_order_amount: 0,
    is_active: true,
    starts_at: null,
    ends_at: null,
  });
  const fromInitial = (row: Discount | null): Partial<Discount> => {
    if (!row) return blank();
    return {
      ...row,
      starts_at: toDatetimeLocalValue(row.starts_at) || null,
      ends_at: toDatetimeLocalValue(row.ends_at) || null,
    };
  };
  const [form, setForm] = useState<Partial<Discount>>(() => fromInitial(initial));
  useEffect(() => {
    setForm(fromInitial(initial));
  }, [initial]);
  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initial ? t("coupons:editCoupon", "Edit coupon") : t("coupons:addCoupon", "New coupon")}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground pt-1">
          {initial ? "Update coupon details and rules." : "Create a new discount coupon code for your customers."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div><Label>{t("coupons:couponCode", "Code")}</Label><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div>
        <div><Label>{t("common:description", "Description")}</Label><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("coupons:discountType", "Type")}</Label>
            <Select value={form.discount_type || "percentage"} onValueChange={(v) => setForm({ ...form, discount_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="percentage">{t("coupons:percentage", "Percentage")}</SelectItem><SelectItem value="fixed">{t("coupons:fixedAmount", "Fixed amount")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>{t("coupons:discountValue", "Value")}</Label><Input type="number" step="0.01" value={form.discount_value || 0} onChange={(e) => setForm({ ...form, discount_value: parseFloat(e.target.value) || 0 })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("coupons:minOrder", "Min order")}</Label><Input type="number" step="0.01" value={form.min_order_amount || 0} onChange={(e) => setForm({ ...form, min_order_amount: parseFloat(e.target.value) || 0 })} /></div>
          <div><Label>{t("coupons:maxUses", "Max uses")}</Label><Input type="number" value={form.max_uses || ""} onChange={(e) => setForm({ ...form, max_uses: parseInt(e.target.value) || null })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("coupons:startDate", "Starts")}</Label><Input type="datetime-local" value={toDatetimeLocalValue(form.starts_at)} onChange={(e) => setForm({ ...form, starts_at: e.target.value || null })} /></div>
          <div><Label>{t("coupons:endDate", "Ends")}</Label><Input type="datetime-local" value={toDatetimeLocalValue(form.ends_at)} onChange={(e) => setForm({ ...form, ends_at: e.target.value || null })} /></div>
        </div>
        <div className="flex items-center gap-2"><Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label>{t("coupons:active", "Active")}</Label></div>
      </div>
      <DialogFooter>
        <Button
          onClick={() =>
            onSubmit({
              ...form,
              starts_at: fromDatetimeLocalValue(form.starts_at),
              ends_at: fromDatetimeLocalValue(form.ends_at),
            })
          }
        >
          {t("common:save", "Save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}