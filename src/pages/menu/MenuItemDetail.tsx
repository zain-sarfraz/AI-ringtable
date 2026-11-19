import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Boxes,
  Clock,
  Copy,
  Layers,
  Loader2,
  Package,
  Pencil,
  Sparkles,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/restaurant";
import { resolveMediaUrl } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/layout/PageShell";

type MenuItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  sub_category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  prep_time_minutes: number | null;
  dietary_tags: string[] | null;
  spice_level: number | null;
  track_inventory: boolean | null;
  stock_quantity: number | null;
  max_order_quantity: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type VariantRow = {
  id: string;
  name: string;
  price: number;
  sort_order: number;
  is_active: boolean;
  variant_type?: "size" | "flavor";
  measurement?: string | null;
  parent_id?: string | null;
};

type AddonRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2.5 text-sm sm:grid-cols-[160px_1fr]">
      <dt className="text-muted-foreground font-medium">{label}</dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </div>
  );
}

export default function MenuItemDetail() {
  const { t } = useTranslation(["menu", "common"]);
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role } = useAuth();
  const canManageMenu =
    role === "admin" || role === "manager" || role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<MenuItemRow | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [subCategoryName, setSubCategoryName] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [imgFailed, setImgFailed] = useState(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const { data: row, error } = await supabase
        .from("menu_items")
        .select(
          "id, restaurant_id, category_id, sub_category_id, name, description, price, image_url, is_available, prep_time_minutes, dietary_tags, spice_level, track_inventory, stock_quantity, max_order_quantity, created_at, updated_at",
        )
        .eq("id", itemId)
        .maybeSingle();

      if (error) throw error;
      if (!row) {
        setItem(null);
        return;
      }

      const menuItem = row as MenuItemRow;
      setItem(menuItem);

      const [restRes, catRes, subRes, varRes, linkRes] = await Promise.all([
        supabase.from("restaurants").select("name").eq("id", menuItem.restaurant_id).maybeSingle(),
        menuItem.category_id
          ? supabase.from("menu_categories").select("name").eq("id", menuItem.category_id).maybeSingle()
          : Promise.resolve({ data: null }),
        menuItem.sub_category_id
          ? supabase.from("menu_sub_categories").select("name").eq("id", menuItem.sub_category_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("menu_item_variants")
          .select("id, name, price, sort_order, is_active, variant_type, measurement, parent_id")
          .eq("menu_item_id", menuItem.id)
          .order("sort_order"),
        supabase.from("menu_item_addons").select("menu_addon_id").eq("menu_item_id", menuItem.id),
      ]);

      setRestaurantName((restRes.data as { name?: string } | null)?.name ?? null);
      setCategoryName((catRes.data as { name?: string } | null)?.name ?? null);
      setSubCategoryName((subRes.data as { name?: string } | null)?.name ?? null);
      setVariants(((varRes.data as VariantRow[]) || []).filter(Boolean));

      const addonIds = ((linkRes.data as { menu_addon_id: string }[]) || []).map((l) => l.menu_addon_id);
      if (addonIds.length) {
        const { data: addonRows } = await supabase
          .from("menu_addons")
          .select("id, name, description, price, is_active")
          .in("id", addonIds)
          .order("sort_order");
        setAddons((addonRows as AddonRow[]) || []);
      } else {
        setAddons([]);
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to load item",
        description: e instanceof Error ? e.message : String(e),
      });
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [itemId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setImgFailed(false);
  }, [item?.image_url]);

  const copyId = async () => {
    if (!item?.id) return;
    try {
      await navigator.clipboard.writeText(item.id);
      toast({ title: "Item ID copied" });
    } catch {
      toast({ variant: "destructive", title: "Could not copy ID" });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <Package className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Item not found</h1>
        <p className="text-sm text-muted-foreground">This menu item may have been deleted.</p>
        <Button variant="outline" onClick={() => navigate("/menu")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to menu
        </Button>
      </div>
    );
  }

  const imageSrc = resolveMediaUrl(item.image_url);
  const tags = Array.isArray(item.dietary_tags) ? item.dietary_tags : [];
  const displayImage = imageSrc && !imgFailed ? imageSrc : "/menu-item-placeholder.svg";

  return (
    <PageShell maxWidth="lg" className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/menu">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Menu
            </Link>
          </Button>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{item.name}</h1>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {restaurantName ? (
                <span className="inline-flex items-center gap-1">
                  <Store className="h-3.5 w-3.5" />
                  {restaurantName}
                </span>
              ) : (
                "Menu item details"
              )}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Badge variant={item.is_available ? "default" : "secondary"} className="w-fit">
            {item.is_available ? t("menu:available", "Available") : t("menu:unavailable", "Unavailable")}
          </Badge>
          {canManageMenu && (
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => navigate(`/menu?tab=items&editItem=${item.id}`)}
            >
              <Pencil className="mr-1 h-4 w-4" />
              {t("common:edit", "Edit")}
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <div className="aspect-square bg-muted/40">
            <img
              src={displayImage}
              alt={item.name}
              className="h-full w-full object-cover"
              onError={() => {
                if (displayImage !== "/menu-item-placeholder.svg") setImgFailed(true);
              }}
            />
          </div>
          <CardContent className="space-y-3 p-4">
            <div className="text-2xl font-bold text-foreground">{formatCurrency(item.price)}</div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {item.prep_time_minutes ? (
                <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
                  <Clock className="h-3.5 w-3.5" />
                  {item.prep_time_minutes} min prep
                </span>
              ) : null}
              {item.spice_level != null && item.spice_level > 0 ? (
                <span className="rounded-md border px-2 py-1">Spice {item.spice_level}/5</span>
              ) : null}
            </div>

            <div className="pt-2 border-t space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Item ID</span>
              <div className="flex items-center justify-between gap-1.5 p-2 rounded-lg bg-muted/60 border font-mono text-xs text-foreground">
                <span className="truncate flex-1 select-all font-mono" title={item.id}>
                  {item.id}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                  onClick={() => void copyId()}
                  title="Copy Item ID"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <CardTitle className="text-base">{t("common:overview", "Overview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/60">
                <DetailRow label={t("common:description", "Description")}>
                  {item.description?.trim() ? (
                    <p className="leading-relaxed whitespace-pre-wrap">{item.description}</p>
                  ) : (
                    <span className="text-muted-foreground">No description</span>
                  )}
                </DetailRow>
                <DetailRow label={t("menu:category", "Category")}>{categoryName || t("common:uncategorized", "Uncategorized")}</DetailRow>
                <DetailRow label={t("menu:subCategory", "Sub-category")}>{subCategoryName || "—"}</DetailRow>
                <DetailRow label={t("menu:preparationTime", "Prep time")}>
                  {item.prep_time_minutes != null ? `${item.prep_time_minutes} minutes` : "—"}
                </DetailRow>
                <DetailRow label="Dietary tags">
                  {tags.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label="Item ID">
                  <code className="break-all text-xs">{item.id}</code>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <CardTitle className="text-base">{t("menu:tabInventory", "Inventory & ordering")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/60">
                <DetailRow label={t("menu:trackStock", "Track inventory")}>{item.track_inventory ? t("common:yes", "Yes") : t("common:no", "No")}</DetailRow>
                <DetailRow label={t("menu:stock", "Stock")}>
                  {item.track_inventory
                    ? item.stock_quantity != null
                      ? String(item.stock_quantity)
                      : "0"
                    : "Not tracked"}
                </DetailRow>
                <DetailRow label={t("menu:maxOrderQuantity", "Max per order")}>
                  {item.max_order_quantity != null ? String(item.max_order_quantity) : "No limit"}
                </DetailRow>
              </dl>
            </CardContent>
          </Card>


          {/* Sizes Card */}
          {variants.filter((v) => v.variant_type === "size").length > 0 && (
            <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
              <CardHeader className="border-b bg-muted/30 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Boxes className="h-4 w-4 text-blue-500" />
                  Sizes & Variations ({variants.filter((v) => v.variant_type === "size").length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {variants
                    .filter((v) => v.variant_type === "size")
                    .map((size) => {
                      const childFlavors = variants.filter(
                        (v) => v.parent_id === size.id && v.variant_type !== "size"
                      );
                      return (
                        <div
                          key={size.id}
                          className={cn(
                            "p-3.5 rounded-xl border bg-blue-500/5 transition-all space-y-2.5",
                            !size.is_active && "opacity-60 bg-muted/60"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="secondary"
                                className="font-bold text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20"
                              >
                                {size.name}
                                {size.measurement ? ` — ${size.measurement}` : ""}
                              </Badge>
                              {!size.is_active ? (
                                <span className="text-[10px] text-destructive font-medium">(Unavailable)</span>
                              ) : (
                                <span className="text-[10px] text-emerald-600 font-medium">Active</span>
                              )}
                            </div>
                            <span className="font-extrabold text-foreground tabular-nums text-sm">
                              {formatCurrency(size.price)}
                            </span>
                          </div>

                          {/* Nested Flavors for this Size */}
                          {childFlavors.length > 0 && (
                            <div className="pt-2 border-t border-blue-500/15 space-y-1.5">
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                Flavors ({childFlavors.length}):
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {childFlavors.map((f) => (
                                  <Badge
                                    key={f.id}
                                    variant="outline"
                                    className={cn(
                                      "text-xs font-medium bg-background/80",
                                      !f.is_active && "line-through opacity-50 text-muted-foreground"
                                    )}
                                  >
                                    {f.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Standalone Flavors Card (for items without sizes or with standalone variations) */}
          {(variants.filter((v) => v.variant_type === "size").length === 0 ||
            variants.filter((v) => v.variant_type !== "size" && !v.parent_id).length > 0) && (
            <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
              <CardHeader className="border-b bg-muted/30 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Flavors & Variations{" "}
                  {variants.filter((v) => v.variant_type !== "size" && !v.parent_id).length > 0
                    ? `(${variants.filter((v) => v.variant_type !== "size" && !v.parent_id).length})`
                    : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {variants.filter((v) => v.variant_type !== "size" && !v.parent_id).length === 0 ? (
                  <p className="text-sm text-muted-foreground">None (Standard single item)</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {variants
                      .filter((v) => v.variant_type !== "size" && !v.parent_id)
                      .map((v) => (
                        <div
                          key={v.id}
                          className={cn(
                            "flex items-center justify-between p-3 rounded-xl border bg-muted/30 transition-all",
                            !v.is_active && "opacity-60 bg-muted/60"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-bold text-xs">
                              {v.name}
                            </Badge>
                            {!v.is_active ? (
                              <span className="text-[10px] text-destructive font-medium">(Unavailable)</span>
                            ) : (
                              <span className="text-[10px] text-emerald-600 font-medium">Active</span>
                            )}
                          </div>
                          <span className="font-extrabold text-foreground tabular-nums text-sm">
                            {Number(v.price) > 0 ? `+${formatCurrency(v.price)}` : formatCurrency(0)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Package className="h-4 w-4 text-primary" />
                Sauces & Add-ons {addons.length > 0 ? `(${addons.length})` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {addons.length === 0 ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {addons.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border bg-muted/30 transition-all",
                        !a.is_active && "opacity-60 bg-muted/60"
                      )}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-semibold text-sm text-foreground truncate">{a.name}</p>
                        {a.description && (
                          <p className="text-xs text-muted-foreground truncate">{a.description}</p>
                        )}
                      </div>
                      <span className="font-bold text-primary tabular-nums text-xs shrink-0">
                        +{formatCurrency(a.price)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
