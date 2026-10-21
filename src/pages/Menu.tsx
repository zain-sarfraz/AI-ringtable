import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter, DialogBody } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2, UtensilsCrossed, Layers, Loader2, LayoutGrid, ListTree, PlusSquare, RefreshCw, Boxes, Gauge, Search, X, FilterX, Eye, ArrowUp, ArrowDown, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { MenuImportButton } from "@/components/menu/MenuImportButton";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { syncRestaurantMenuToVoiceAgent } from "@/lib/syncRestaurantMenuToVoiceAgent";

interface Category { id: string; restaurant_id?: string; name: string; description: string | null; sort_order: number; is_active: boolean }
interface SubCategory { id: string; restaurant_id: string; category_id: string; name: string; description: string | null; sort_order: number; is_active: boolean }
interface MenuItem {
  id: string;
  category_id: string | null;
  sub_category_id: string | null;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  prep_time_minutes: number;
  dietary_tags: string[];
  spice_level: number;
  track_inventory?: boolean;
  stock_quantity?: number | null;
  max_order_quantity?: number | null;
}
interface MenuItemVariant {
  id: string;
  menu_item_id: string;
  name: string;
  measurement?: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
  variant_type?: "size" | "flavor";
  parent_id?: string | null;
  max_order_quantity?: number | null;
}
interface MenuAddon {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
}
interface ItemAddonLink {
  menu_item_id: string;
  menu_addon_id: string;
}

type AddonFieldKey = "name" | "description" | "price" | "sort_order";

/** Allow typing prices like "12." / "0.5" without the field snapping back. */
function sanitizePriceDraft(raw: string): number | string | null {
  const v = raw.trim();
  if (v === "" || v === ".") return v;
  if (!/^\d*\.?\d*$/.test(v)) return null;
  return v;
}

function priceDraftToNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Matches DB: name text, price numeric(10,2), sort_order int */
function validateAddonForm(form: Partial<MenuAddon>): Partial<Record<AddonFieldKey, string>> {
  const errors: Partial<Record<AddonFieldKey, string>> = {};
  const name = (form.name ?? "").trim();
  if (!name) errors.name = "Name is required.";
  else if (name.length > 200) errors.name = "Name must be at most 200 characters.";

  const descRaw = form.description;
  if (descRaw != null && String(descRaw).length > 5000) {
    errors.description = "Description must be at most 5000 characters.";
  }

  const rawPrice = form.price;
  const price = typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice ?? ""));
  if (!Number.isFinite(price)) errors.price = "Enter a valid extra price.";
  else if (price < 0) errors.price = "Extra price cannot be negative.";
  else if (price > 99_999_999.99) errors.price = "Extra price is too large (max 99,999,999.99).";

  const rawSo = form.sort_order;
  const so =
    typeof rawSo === "number" && Number.isFinite(rawSo) ? Math.trunc(rawSo) : parseInt(String(rawSo ?? "0"), 10);
  if (!Number.isFinite(so) || Number.isNaN(so)) errors.sort_order = "Sort order must be a whole number.";
  else if (so < 0) errors.sort_order = "Sort order cannot be negative.";
  else if (so > 2_147_483_647) errors.sort_order = "Sort order is too large.";

  return errors;
}

type AddonClusterRow = Pick<MenuAddon, "id" | "restaurant_id" | "name" | "description" | "price" | "sort_order" | "is_active">;

/** Best-effort grouping for multi-restaurant copies (same fields, no shared DB group id). */
function addonIdentityKey(ad: Pick<MenuAddon, "name" | "description" | "price" | "sort_order" | "is_active">) {
  const desc = ad.description == null ? "" : String(ad.description);
  const price = typeof ad.price === "number" ? ad.price : parseFloat(String(ad.price ?? "0"));
  const so =
    typeof ad.sort_order === "number" && Number.isFinite(ad.sort_order)
      ? Math.trunc(ad.sort_order)
      : parseInt(String(ad.sort_order ?? "0"), 10);
  return `${(ad.name ?? "").trim()}\t${desc}\t${Number(price)}\t${so}\t${Boolean(ad.is_active)}`;
}

function buildAddonRestaurantClusters(
  rows: AddonClusterRow[],
  restaurantNameById: Map<string, string>,
): Record<string, { count: number; restaurantNames: string[] }> {
  const fpToRestaurantIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const fp = addonIdentityKey(row);
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
  const byAddonId: Record<string, { count: number; restaurantNames: string[] }> = {};
  for (const row of rows) {
    const fp = addonIdentityKey(row);
    byAddonId[row.id] = {
      count: fpToRestaurantIds.get(fp)!.size,
      restaurantNames: fpToSortedNames.get(fp)!,
    };
  }
  return byAddonId;
}

function MenuItemsTable({
  items: rows,
  categories,
  subCategories,
  itemVariants,
  onEdit,
  onDelete,
  onToggleAvailability,
  addonSummary,
  itemAddonCount,
  emptyMessage,
}: {
  items: MenuItem[];
  categories?: Category[];
  subCategories?: SubCategory[];
  itemVariants?: MenuItemVariant[];
  onEdit: (it: MenuItem) => void;
  onDelete: (id: string) => void;
  onToggleAvailability?: (it: MenuItem) => void;
  addonSummary?: Record<string, string>;
  itemAddonCount?: Record<string, number>;
  emptyMessage?: string;
}) {
  const { t } = useTranslation(["menu", "common"]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[980px] border-collapse">
        <thead className="text-left bg-muted/40 text-muted-foreground border-b text-xs font-semibold uppercase tracking-wider">
          <tr>
            <th className="py-3 px-4 w-12 text-center">{t("menu:itemNumber", "Item #")}</th>
            <th className="py-3 px-4 w-16">{t("menu:image", "Image")}</th>
            <th className="py-3 px-4 min-w-[240px]">{t("menu:itemName", "Item Name")}</th>
            <th className="py-3 px-4">{t("menu:category", "Category")}</th>
            <th className="py-3 px-4">{t("menu:subCategory", "Sub-category")}</th>
            <th className="py-3 px-4 text-center whitespace-nowrap">{t("menu:stock", "Stock")}</th>
            <th className="py-3 px-4 whitespace-nowrap">{t("menu:preparationTime", "Prep Time")}</th>
            <th className="py-3 px-4 whitespace-nowrap">{t("menu:price", "Price")}</th>
            <th className="py-3 px-4 text-center">{t("common:status", "Status")}</th>
            <th className="py-3 px-4 w-28 text-right">{t("common:actions", "Actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((it, idx) => {
            const thumbSrc = resolveMediaUrl(it.image_url);
            const categoryName = categories?.find((c) => c.id === it.category_id)?.name || t("common:uncategorized", "Uncategorized");
            const subCategoryName = subCategories?.find((sc) => sc.id === it.sub_category_id)?.name || "—";

            const itemVars = itemVariants?.filter((v) => v.menu_item_id === it.id) || [];
            const itemSizes = itemVars.filter((v) => v.variant_type === "size");
            const itemFlavors = itemVars.filter((v) => v.variant_type !== "size");

            const sizePrices = itemSizes.filter((s) => s.is_active).map((s) => Number(s.price));
            const flavorPrices = itemFlavors.filter((v) => v.is_active && Number(v.price) > 0).map((v) => Number(v.price));

            let minPrice = Number(it.price) || 0;
            let maxPrice = Number(it.price) || 0;
            if (sizePrices.length > 0) {
              minPrice = Math.min(...sizePrices);
              maxPrice = Math.max(...sizePrices);
            } else if (flavorPrices.length > 0) {
              minPrice = Math.min(...flavorPrices);
              maxPrice = Math.max(...flavorPrices);
            }

            return (
              <tr key={it.id} className="hover:bg-muted/40 transition-colors">
                {/* 1. Item # */}
                <td className="py-3 px-4 align-middle text-center text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-muted/50 border border-border/40 font-semibold text-xs">
                    {idx + 1}
                  </span>
                </td>

                {/* 2. Image */}
                <td className="py-3 px-4 align-middle">
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={it.name} className="h-11 w-11 rounded-lg object-cover border bg-muted/20 shadow-2xs" />
                  ) : (
                    <div className="h-11 w-11 rounded-lg border bg-muted/30 flex items-center justify-center text-muted-foreground text-xs font-medium">
                      <UtensilsCrossed className="h-5 w-5 opacity-50" />
                    </div>
                  )}
                </td>

                {/* 3. Item Name */}
                <td className="py-3 px-4 align-middle font-medium">
                  {/* Name + Out of stock badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/menu/items/${it.id}`}
                      className="text-foreground font-bold hover:text-primary hover:underline underline-offset-2 text-sm leading-tight"
                    >
                      {it.name}
                    </Link>
                    {(!it.is_available || (it.track_inventory && Number(it.stock_quantity || 0) <= 0)) && (
                      <Badge
                        variant="destructive"
                        className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 py-0 h-4 font-semibold"
                      >
                        {t("menu:outOfStock", "Out of Stock")}
                      </Badge>
                    )}
                  </div>

                  {/* Description */}
                  {it.description && (
                    <div className="text-xs text-muted-foreground line-clamp-1 max-w-[280px] mt-0.5" title={it.description}>
                      {it.description}
                    </div>
                  )}
                </td>

                {/* 4. Category */}
                <td className="py-3 px-4 align-middle">
                  <span className="inline-block text-xs font-medium text-foreground bg-muted/60 px-2.5 py-1 rounded-md">
                    {categoryName}
                  </span>
                </td>

                {/* 5. Sub-category */}
                <td className="py-3 px-4 align-middle">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 lowercase">
                    {subCategoryName}
                  </span>
                </td>

                {/* 6. Stock */}
                <td className="py-3 px-4 align-middle text-center">
                  <span className="inline-block border border-border/80 bg-background px-2.5 py-0.5 rounded-md text-xs font-semibold text-foreground">
                    {it.track_inventory ? (it.stock_quantity ?? 0) : "1"}
                  </span>
                </td>

                {/* 7. Prep Time */}
                <td className="py-3 px-4 align-middle whitespace-nowrap">
                  {it.prep_time_minutes ? (
                    <div className="flex flex-col text-xs">
                      <span className="font-semibold text-foreground leading-tight">{it.prep_time_minutes}</span>
                      <span className="text-[10px] text-muted-foreground leading-none">min</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* 8. Price */}
                <td className="py-3 px-4 align-middle whitespace-nowrap">
                  {(sizePrices.length > 1 || flavorPrices.length > 1) && minPrice !== maxPrice ? (
                    <div className="flex flex-col">
                      <span className="text-[11px] text-muted-foreground font-medium leading-none mb-0.5">From</span>
                      <span className="text-sm sm:text-base font-extrabold text-foreground leading-tight">{formatCurrency(minPrice)}</span>
                    </div>
                  ) : (
                    <span className="text-sm sm:text-base font-extrabold text-foreground">
                      {formatCurrency(minPrice || it.price)}
                    </span>
                  )}
                </td>

                {/* 9. Status Switch */}
                <td className="py-3 px-4 align-middle text-center">
                  <Switch
                    checked={it.is_available}
                    onCheckedChange={() => onToggleAvailability?.(it)}
                    className="data-[state=checked]:bg-primary"
                  />
                </td>

                {/* Actions Column */}
                <td className="py-3 px-4 align-middle text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0 rounded-lg border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      asChild
                      title={t("common:view", "View details")}
                    >
                      <Link to={`/menu/items/${it.id}`}>
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0 rounded-lg border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => onEdit(it)}
                      title={t("common:edit", "Edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0 rounded-lg border-red-200/60 bg-red-50/40 dark:bg-red-950/20 text-red-600 hover:bg-red-100/80 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/50"
                      onClick={() => onDelete(it.id)}
                      title={t("common:delete", "Delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="py-12 text-center text-muted-foreground">
                {emptyMessage || t("menu:noItemsFound", "No items found.")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}


export default function Menu() {
  const { t } = useTranslation(["menu", "common", "superAdmin"]);
  const { toast } = useToast();
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { restaurantId, loading: activeRestaurantLoading } = useActiveRestaurant();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "items";
  const itemsTab = activeTab === "items";
  const categoriesTab = activeTab === "categories";
  const subCategoriesTab = activeTab === "sub-categories";
  const addonsTab = activeTab === "addons";
  const inventoryTab = activeTab === "inventory";
  const maxOrderTab = activeTab === "max-order";

  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [itemVariants, setItemVariants] = useState<MenuItemVariant[]>([]);
  const [addons, setAddons] = useState<MenuAddon[]>([]);
  const [itemAddonLinks, setItemAddonLinks] = useState<ItemAddonLink[]>([]);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [catDialog, setCatDialog] = useState(false);
  const [subCatDialog, setSubCatDialog] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [addonDialog, setAddonDialog] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editSubCat, setEditSubCat] = useState<SubCategory | null>(null);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [editItemAddonIds, setEditItemAddonIds] = useState<string[]>([]);
  const [editAddon, setEditAddon] = useState<MenuAddon | null>(null);

  const [restaurantFilterId, setRestaurantFilterId] = useState('all');
  const [restaurantPickerList, setRestaurantPickerList] = useState<{ id: string; name: string }[]>([]);
  const [allRestaurants, setAllRestaurants] = useState<{ id: string; name: string }[]>([]);
  const [restaurantMap, setRestaurantMap] = useState<Record<string, string>>({});
  const [addonRestaurantCluster, setAddonRestaurantCluster] = useState<
    Record<string, { count: number; restaurantNames: string[] }>
  >({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilterId, setCategoryFilterId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [limitFilter, setLimitFilter] = useState("all");
  const [flavorFilter, setFlavorFilter] = useState("all");

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);

    const [
      { data: catsData },
      { data: subCatsData },
      { data: itemsData },
      { data: variantsData },
      { data: addonsData },
      { data: linksData },
      { data: restData },
    ] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('menu_sub_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('menu_item_variants').select('*').order('sort_order'),
      supabase.from('menu_addons').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('menu_item_addons').select('*'),
      supabase.from('restaurants').select('id, name').eq('id', restaurantId).maybeSingle(),
    ]);

    if (catsData) setCategories(catsData as Category[]);
    if (subCatsData) setSubCategories(subCatsData as SubCategory[]);
    if (itemsData) setItems(itemsData as MenuItem[]);
    if (variantsData) setItemVariants(variantsData as MenuItemVariant[]);
    if (addonsData) setAddons(addonsData as MenuAddon[]);
    if (linksData) setItemAddonLinks(linksData as ItemAddonLink[]);
    if (restData) setRestaurantName((restData as any).name);

    setLoading(false);
  }, [restaurantId]);

  const displayedItems = items;
  const displayedCategories = categories;
  const displayedSubCategories = subCategories;
  const displayedAddons = addons;

  const filteredItems = useMemo(() => {
    let list = displayedItems;

    if (categoryFilterId !== 'all') {
      list = list.filter((it) => String(it.category_id) === String(categoryFilterId));
    }

    if (statusFilter === 'available') {
      list = list.filter((it) => Boolean(it.is_available));
    } else if (statusFilter === 'unavailable') {
      list = list.filter((it) => !it.is_available);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description && it.description.toLowerCase().includes(q))
      );
    }

    return list;
  }, [displayedItems, categoryFilterId, statusFilter, searchQuery]);

  const flattenedMaxOrderRows = useMemo(() => {
    const rows: {
      item: MenuItem;
      flavor: string | null;
      maxOrderQuantity: number | null;
      key: string;
    }[] = [];

    for (const it of items) {
      if (categoryFilterId !== 'all' && String(it.category_id) !== String(categoryFilterId)) {
        continue;
      }

      const itemVars = itemVariants.filter((v) => v.menu_item_id === it.id);
      const flavorVars = itemVars.filter((v) => v.variant_type !== 'size');
      const uniqueFlavors = Array.from(new Set(flavorVars.map((f) => f.name.trim()))).filter(Boolean);

      if (flavorFilter === 'with_flavors' && uniqueFlavors.length === 0) {
        continue;
      } else if (flavorFilter === 'without_flavors' && uniqueFlavors.length > 0) {
        continue;
      }

      if (uniqueFlavors.length > 0) {
        for (const flv of uniqueFlavors) {
          const matchingVariants = flavorVars.filter((v) => v.name.trim() === flv);
          const flvMaxOrder = matchingVariants.find((v) => v.max_order_quantity != null)?.max_order_quantity ?? null;

          if (limitFilter === 'limited' && (flvMaxOrder == null || flvMaxOrder <= 0)) {
            continue;
          } else if (limitFilter === 'unlimited' && flvMaxOrder != null && flvMaxOrder > 0) {
            continue;
          }

          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const matchesItem =
              it.name.toLowerCase().includes(q) ||
              (it.description && it.description.toLowerCase().includes(q));
            const matchesFlavor = flv.toLowerCase().includes(q);
            if (!matchesItem && !matchesFlavor) {
              continue;
            }
          }
          rows.push({
            item: it,
            flavor: flv,
            maxOrderQuantity: flvMaxOrder,
            key: `${it.id}-flv-${flv}`,
          });
        }
      } else {
        const itemMaxOrder = it.max_order_quantity ?? null;

        if (limitFilter === 'limited' && (itemMaxOrder == null || itemMaxOrder <= 0)) {
          continue;
        } else if (limitFilter === 'unlimited' && itemMaxOrder != null && itemMaxOrder > 0) {
          continue;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchesItem =
            it.name.toLowerCase().includes(q) ||
            (it.description && it.description.toLowerCase().includes(q));
          if (!matchesItem) {
            continue;
          }
        }
        rows.push({
          item: it,
          flavor: null,
          maxOrderQuantity: itemMaxOrder,
          key: `${it.id}-standard`,
        });
      }
    }

    return rows;
  }, [items, categoryFilterId, limitFilter, flavorFilter, searchQuery, itemVariants]);

  const hasActiveFilters = searchQuery !== "" || categoryFilterId !== "all" || statusFilter !== "all" || (isSuperAdmin && restaurantFilterId !== "all");

  const hasActiveMaxOrderFilters = searchQuery !== "" || limitFilter !== "all" || flavorFilter !== "all" || (isSuperAdmin && restaurantFilterId !== "all");

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilterId("all");
    setStatusFilter("all");
    if (isSuperAdmin) setRestaurantFilterId("all");
  };

  const clearMaxOrderFilters = () => {
    setSearchQuery("");
    setLimitFilter("all");
    setFlavorFilter("all");
    if (isSuperAdmin) setRestaurantFilterId("all");
  };

  const { addonSummary, itemAddonCount } = useMemo(() => {
    const namesByItem: Record<string, string[]> = {};
    const countByItem: Record<string, number> = {};
    for (const row of itemAddonLinks) {
      if (!namesByItem[row.menu_item_id]) namesByItem[row.menu_item_id] = [];
      const ad = addons.find((a) => a.id === row.menu_addon_id);
      if (ad) namesByItem[row.menu_item_id].push(ad.name);
      countByItem[row.menu_item_id] = (countByItem[row.menu_item_id] || 0) + 1;
    }
    const out: Record<string, string> = {};
    for (const [id, names] of Object.entries(namesByItem)) {
      out[id] = names.join(", ");
    }
    return { addonSummary: out, itemAddonCount: countByItem };
  }, [itemAddonLinks, addons]);

  const toggleItemAvailability = async (item: MenuItem) => {
    const nextAvailable = !item.is_available;
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_available: nextAvailable } : row)));
    const { error } = await supabase.from("menu_items").update({ is_available: nextAvailable }).eq("id", item.id);
    if (error) {
      toast({ variant: "destructive", title: "Failed to update status", description: (error as any)?.message || "Failed to update status" });
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_available: item.is_available } : row)));
    } else {
      toast({ title: nextAvailable ? `"${item.name}" marked as available` : `"${item.name}" marked as unavailable` });
      void triggerMenuSync();
    }
  };

  // Load items for all restaurants when role is super_admin
  useEffect(() => {
    void load();
  }, [isSuperAdmin, load]);

  const triggerMenuSync = useCallback(async (interactive = false) => {
    if (!restaurantId) return;
    try {
      const result = await syncRestaurantMenuToVoiceAgent(restaurantId);
      if (result.skipped) {
        console.info("AI voice agent sync skipped (dev):", result.error);
        if (interactive) {
          toast({
            title: "Menu saved — live voice sync skipped",
            description:
              result.error ||
              "Development mode does not push to Synthflow. Sync from the production server to update the live phone agent.",
          });
        }
        return;
      }
      if (!result.success) {
        console.warn("AI voice agent sync notice:", result.error);
        if (interactive) {
          toast({
            variant: "destructive",
            title: "AI Voice Sync",
            description:
              result.error ||
              "Menu updated locally. To sync with Voice Agent, configure ElevenLabs or Synthflow credentials in Settings.",
          });
        }
      } else if (interactive && result.provider !== "none") {
        toast({
          title: "AI Agent Updated",
          description:
            result.provider === "synthflow"
              ? "Menu & inventory are now live on your Synthflow voice agent."
              : "Your menu changes are now live on the voice agent.",
        });
      }
    } catch (e: any) {
      console.warn("AI sync notice:", e?.message || e);
    }
  }, [restaurantId, toast]);

  useEffect(() => {
    if (activeRestaurantLoading) return;
    if (!restaurantId) {
      setCategories([]);
      setSubCategories([]);
      setItems([]);
      setItemVariants([]);
      setAddons([]);
      setItemAddonLinks([]);
      setRestaurantName(null);
      setAddonRestaurantCluster({});
      setLoading(false);
      return;
    }
    void load();
  }, [restaurantId, activeRestaurantLoading, load]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void (async () => {
      const { data, error } = await supabase.from("restaurants").select("id, name").order("name");
      if (error) {
        console.error(error);
        return;
      }
      const list = (data as { id: string; name: string }[]) ?? [];
      setAllRestaurants(list);
      setRestaurantPickerList(list);
      const map: Record<string, string> = {};
      list.forEach((r) => {
        map[r.id] = r.name;
      });
      setRestaurantMap(map);
    })();
  }, [isSuperAdmin]);

  const beginEditItem = async (it: MenuItem) => {
    setEditItem(it);
    const [{ data: linkData }, { data: variantData }] = await Promise.all([
      supabase.from("menu_item_addons").select("menu_addon_id").eq("menu_item_id", it.id),
      supabase.from("menu_item_variants").select("*").eq("menu_item_id", it.id).order("sort_order"),
    ]);
    const allowed = new Set(addons.map((x) => x.id));
    const raw = ((linkData as { menu_addon_id: string }[]) || []).map((r) => r.menu_addon_id);
    setEditItemAddonIds(raw.filter((id) => allowed.has(id)));
    if (variantData) {
      setItemVariants((prev) => {
        const others = prev.filter((v) => v.menu_item_id !== it.id);
        return [...others, ...(variantData as MenuItemVariant[])];
      });
    }
    setItemDialog(true);
  };

  // Open edit dialog when arriving from item details (?editItem=...)
  useEffect(() => {
    const editId = searchParams.get("editItem");
    if (!editId || loading || !items.length) return;
    const match = items.find((it) => it.id === editId);
    if (!match) return;
    void beginEditItem(match);
    const next = new URLSearchParams(searchParams);
    next.delete("editItem");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when items ready
  }, [loading, items, searchParams]);

  /** Only links add-ons that belong to this restaurant (`addons` list). */
  const syncItemAddonLinks = async (itemId: string, addonIds: string[], allowedAddonIds: Set<string>) => {
    const safe = addonIds.filter((id) => allowedAddonIds.has(id));
    const { error: delErr } = await supabase.from("menu_item_addons").delete().eq("menu_item_id", itemId);
    if (delErr) throw delErr;
    if (!safe.length) return;
    const rows = safe.map((menu_addon_id) => ({ menu_item_id: itemId, menu_addon_id }));
    const { error: insErr } = await supabase.from("menu_item_addons").insert(rows);
    if (insErr) throw insErr;
  };
  const syncItemVariants = async (itemId: string, variants: Partial<MenuItemVariant>[]) => {
    const { error: delErr } = await supabase.from("menu_item_variants").delete().eq("menu_item_id", itemId);
    if (delErr) throw delErr;
    if (!variants.length) return;

    const sizeVariants = variants.filter((v) => v.variant_type === "size");
    const flavorVariants = variants.filter((v) => v.variant_type !== "size");

    if (sizeVariants.length) {
      const sizeRows = sizeVariants.map((s, idx) => ({
        id: s.id && !s.id.startsWith("temp-") ? s.id : crypto.randomUUID(),
        menu_item_id: itemId,
        name: (s.name || "").trim(),
        measurement: (s.measurement || "").trim() || null,
        price: Number(s.price) || 0,
        sort_order: s.sort_order ?? idx,
        is_active: s.is_active ?? true,
        variant_type: "size" as const,
        parent_id: null,
      }));

      const { error: sizeErr } = await supabase.from("menu_item_variants").insert(sizeRows);
      if (sizeErr) throw sizeErr;

      const parentIdMap = new Map<string, string>();
      sizeVariants.forEach((s, i) => {
        if (s.id) parentIdMap.set(s.id, sizeRows[i].id);
      });

      if (flavorVariants.length) {
        const flavorRows = flavorVariants.map((f, idx) => {
          let resolvedParentId = f.parent_id || null;
          if (resolvedParentId && parentIdMap.has(resolvedParentId)) {
            resolvedParentId = parentIdMap.get(resolvedParentId)!;
          }
          return {
            id: f.id && !f.id.startsWith("temp-") ? f.id : crypto.randomUUID(),
            menu_item_id: itemId,
            name: (f.name || "").trim(),
            measurement: null,
            price: Number(f.price) || 0,
            sort_order: f.sort_order ?? idx,
            is_active: f.is_active ?? true,
            variant_type: "flavor" as const,
            parent_id: resolvedParentId,
            max_order_quantity: f.max_order_quantity ?? null,
          };
        });

        const { error: flvErr } = await supabase.from("menu_item_variants").insert(flavorRows);
        if (flvErr) throw flvErr;
      }
    } else if (flavorVariants.length) {
      const flavorRows = flavorVariants.map((f, idx) => ({
        id: f.id && !f.id.startsWith("temp-") ? f.id : crypto.randomUUID(),
        menu_item_id: itemId,
        name: (f.name || "").trim(),
        measurement: null,
        price: Number(f.price) || 0,
        sort_order: f.sort_order ?? idx,
        is_active: f.is_active ?? true,
        variant_type: "flavor" as const,
        parent_id: null,
        max_order_quantity: f.max_order_quantity ?? null,
      }));

      const { error: flvErr } = await supabase.from("menu_item_variants").insert(flavorRows);
      if (flvErr) throw flvErr;
    }
  };

  const saveCategory = async (form: Partial<Category> & { restaurant_id?: string }) => {
    const targetRestaurantId = form.restaurant_id || restaurantId;
    if (!targetRestaurantId) return;
    setIsSaving(true);
    const payload = {
      name: form.name || "",
      description: form.description || null,
      sort_order: form.sort_order || 0,
      is_active: form.is_active ?? true,
      restaurant_id: targetRestaurantId
    };
    const res = editCat
      ? await supabase.from("menu_categories").update(payload).eq("id", editCat.id)
      : await supabase.from("menu_categories").insert(payload);
    setIsSaving(false);
    if (res.error) toast({ variant: "destructive", title: "Failed", description: (res.error as any).message });
    else {
      toast({ title: editCat ? "Category updated" : "Category created" });
      setCatDialog(false);
      setEditCat(null);
      load();
      void triggerMenuSync();
    }
  };

  const saveSubCategory = async (form: Partial<SubCategory> & { restaurant_id?: string }) => {
    const targetRestaurantId = form.restaurant_id || restaurantId;
    if (!targetRestaurantId) {
      toast({ variant: "destructive", title: "Restaurant required", description: "Please select a restaurant." });
      return;
    }
    if (!form.name?.trim()) {
      toast({ variant: "destructive", title: "Name required", description: "Please enter a sub-category name." });
      return;
    }
    if (!form.category_id) {
      toast({ variant: "destructive", title: "Category required", description: "Please select a parent category." });
      return;
    }
    setIsSaving(true);
    const payload = {
      category_id: form.category_id,
      name: form.name.trim(),
      description: form.description?.trim() || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
      restaurant_id: targetRestaurantId
    };
    const res = editSubCat
      ? await supabase.from("menu_sub_categories").update(payload).eq("id", editSubCat.id)
      : await supabase.from("menu_sub_categories").insert(payload);
    setIsSaving(false);
    if (res.error) toast({ variant: "destructive", title: "Failed", description: (res.error as any).message });
    else {
      toast({ title: editSubCat ? "Sub-category updated" : "Sub-category created" });
      setSubCatDialog(false);
      setEditSubCat(null);
      load();
      void triggerMenuSync();
    }
  };

  const saveItem = async (form: Partial<MenuItem> & { addon_ids?: string[]; variants?: Partial<MenuItemVariant>[]; restaurant_id?: string }) => {
    const targetRestaurantId = form.restaurant_id || restaurantId;
    if (!targetRestaurantId) return;
    setIsSaving(true);
    const addon_ids = form.addon_ids ?? [];
    const payload = {
      category_id: form.category_id || null,
      name: form.name || "",
      description: form.description || null,
      price: Number(form.price) || 0,
      image_url: form.image_url ?? null,
      is_available: form.is_available ?? true,
      prep_time_minutes: Number(form.prep_time_minutes) || 15,
      dietary_tags: form.dietary_tags || [],
      spice_level: Number(form.spice_level) || 0,
      sub_category_id: form.sub_category_id || null,
      restaurant_id: targetRestaurantId,
    };
    const allowedAddonIds = new Set(addons.map((x) => x.id));
    try {
      if (editItem) {
        const res = await supabase.from("menu_items").update(payload).eq("id", editItem.id);
        if (res.error) throw res.error;
        await syncItemAddonLinks(editItem.id, addon_ids, allowedAddonIds);
        if (form.variants) await syncItemVariants(editItem.id, form.variants);
      } else {
        const res = await supabase.from("menu_items").insert(payload).select("id").single();
        if (res.error) throw res.error;
        const id = (res.data as { id?: string })?.id;
        if (id) {
          await syncItemAddonLinks(id, addon_ids, allowedAddonIds);
          if (form.variants) await syncItemVariants(id, form.variants);
        }
      }
      setIsSaving(false);
      toast({ title: editItem ? "Item updated" : "Item created" });
      setItemDialog(false);
      setEditItem(null);
      setEditItemAddonIds([]);
      load();
      void triggerMenuSync();
    } catch (e: unknown) {
      setIsSaving(false);
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "Failed", description: msg });
    }
  };

  const saveAddon = async (form: Partial<MenuAddon> & { restaurant_ids?: string[] }) => {
    if (editAddon && !isSuperAdmin && editAddon.restaurant_id !== restaurantId) {
      toast({ variant: "destructive", title: "Cannot edit this add-on", description: "It belongs to another restaurant." });
      return;
    }

    const addonFieldErrors = validateAddonForm(form);
    if (Object.keys(addonFieldErrors).length > 0) {
      toast({
        variant: "destructive",
        title: "Check your input",
        description: Object.values(addonFieldErrors).join(" "),
      });
      return;
    }

    setIsSaving(true);
    const nameTrim = (form.name ?? "").trim();
    const priceVal = typeof form.price === "number" ? form.price : parseFloat(String(form.price ?? "0"));
    const sortVal =
      typeof form.sort_order === "number" && Number.isFinite(form.sort_order)
        ? Math.trunc(form.sort_order)
        : parseInt(String(form.sort_order ?? "0"), 10);
    const descTrim = (form.description ?? "").trim();
    const basePayload = {
      name: nameTrim,
      description: descTrim.length ? descTrim : null,
      price: Math.round(priceVal * 100) / 100,
      sort_order: sortVal,
      is_active: form.is_active ?? true,
    };

    if (editAddon) {
      const targetRestaurantId = isSuperAdmin ? String(form.restaurant_id || editAddon.restaurant_id) : restaurantId;
      if (!targetRestaurantId) {
        toast({ variant: "destructive", title: "Restaurant required", description: "Select a restaurant for this add-on." });
        setIsSaving(false);
        return;
      }
      const payload = { ...basePayload, restaurant_id: targetRestaurantId };
      const res = await supabase.from("menu_addons").update(payload).eq("id", editAddon.id).eq("restaurant_id", editAddon.restaurant_id);
      setIsSaving(false);
      if (res.error) toast({ variant: "destructive", title: "Failed", description: (res.error as any).message });
      else {
        toast({ title: "Add-on updated" });
        setAddonDialog(false);
        setEditAddon(null);
        load();
      }
      return;
    }

    // Create
    let targetIds: string[];
    if (isSuperAdmin) {
      const fromMulti = form.restaurant_ids?.filter(Boolean) ?? [];
      targetIds = fromMulti.length ? [...new Set(fromMulti)] : [String(form.restaurant_id || restaurantId || "")].filter(Boolean);
    } else {
      if (!restaurantId) {
        toast({ variant: "destructive", title: "No restaurant", description: "No restaurant is linked to your account." });
        setIsSaving(false);
        return;
      }
      targetIds = [restaurantId];
    }
    if (!targetIds.length) {
      toast({
        variant: "destructive",
        title: "Restaurant required",
        description: isSuperAdmin ? "Select at least one restaurant." : "No restaurant is linked to your account.",
      });
      setIsSaving(false);
      return;
    }

    const rows = targetIds.map((restaurant_id) => ({ ...basePayload, restaurant_id }));
    const res = await supabase.from("menu_addons").insert(rows);
    setIsSaving(false);
    if (res.error) toast({ variant: "destructive", title: "Failed", description: (res.error as any).message });
    else {
      const n = rows.length;
      if (isSuperAdmin && n > 1) {
        toast({
          title: "Add-ons created",
          description: `Created ${n} copies (one per selected restaurant). This table still shows add-ons for your current location.`,
        });
      } else {
        const pickedName = restaurantPickerList.find((x) => x.id === targetIds[0])?.name;
        toast({
          title: "Add-on created",
          ...(pickedName && targetIds[0] !== restaurantId
            ? { description: `Stored for “${pickedName}”.` }
            : {}),
        });
      }
      setAddonDialog(false);
      setEditAddon(null);
      load();
    }
  };

  const deleteAddon = async (id: string) => {
    if (!restaurantId) return;
    if (!confirm("Delete this add-on? It will be removed from any linked menu items in this restaurant.")) return;
    const { error } = await supabase.from("menu_addons").delete().eq("id", id).eq("restaurant_id", restaurantId);
    if (error) toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    else load();
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    const { error } = await supabase.from("menu_categories").delete().eq("id", id);
    if (error) toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    else {
      load();
      void triggerMenuSync();
    }
  };
  const deleteSubCategory = async (id: string) => {
    if (!confirm("Delete this sub-category?")) return;
    const { error } = await supabase.from("menu_sub_categories").delete().eq("id", id);
    if (error) toast({ variant: "destructive", title: "Failed", description: (error as any).message });
    else {
      load();
      void triggerMenuSync();
    }
  };
  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return;
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    if (error) toast({ variant: 'destructive', title: 'Failed', description: (error as any).message });
    else { load(); void triggerMenuSync(); }
  };

  const saveInventoryFields = async (
    item: MenuItem,
    fields: { track_inventory: boolean; stock_quantity: number | null },
  ) => {
    setSavingItemId(item.id);
    const stockQty = fields.track_inventory ? Math.max(0, fields.stock_quantity ?? 0) : null;
    const isAvailable = fields.track_inventory ? stockQty! > 0 : item.is_available;
    const { error } = await supabase
      .from("menu_items")
      .update({
        track_inventory: fields.track_inventory,
        stock_quantity: stockQty,
        is_available: isAvailable,
      })
      .eq("id", item.id);
    setSavingItemId(null);
    if (error) {
      toast({ variant: "destructive", title: "Failed", description: (error as any)?.message || "Failed to update inventory" });
      return;
    }
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, track_inventory: fields.track_inventory, stock_quantity: stockQty, is_available: isAvailable }
          : row,
      ),
    );
    toast({ title: "Inventory updated" });
    void triggerMenuSync();
  };

  const saveMaxOrderQuantity = async (item: MenuItem, flavor: string | null, raw: string) => {
    const trimmed = raw.trim();
    const maxOrderQty = trimmed === "" ? null : Math.max(1, parseInt(trimmed, 10) || 1);

    if (flavor) {
      const saveKey = `${item.id}-flv-${flavor}`;
      setSavingItemId(saveKey);
      const { error } = await supabase
        .from("menu_item_variants")
        .update({ max_order_quantity: maxOrderQty })
        .eq("menu_item_id", item.id)
        .eq("name", flavor);
      setSavingItemId(null);
      if (error) {
        toast({ variant: "destructive", title: "Failed", description: (error as any)?.message || "Failed to update max order quantity" });
        return;
      }
      setItemVariants((prev) =>
        prev.map((v) =>
          v.menu_item_id === item.id && v.name.trim() === flavor.trim()
            ? { ...v, max_order_quantity: maxOrderQty }
            : v
        )
      );
      toast({ title: `Max order updated for "${flavor}"` });
    } else {
      setSavingItemId(item.id);
      const { error } = await supabase
        .from("menu_items")
        .update({ max_order_quantity: maxOrderQty })
        .eq("id", item.id);
      setSavingItemId(null);
      if (error) {
        toast({ variant: "destructive", title: "Failed", description: (error as any)?.message || "Failed to update max order quantity" });
        return;
      }
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, max_order_quantity: maxOrderQty } : row))
      );
      toast({ title: `Max order updated for "${item.name}"` });
    }
    void triggerMenuSync();
  };

  if (activeRestaurantLoading) {
    return <p className="text-muted-foreground p-4">Loading…</p>;
  }
  if (!restaurantId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-muted-foreground">
        <p className="font-medium text-foreground">No restaurant selected</p>
        <p className="font-medium text-foreground">{t("menu:noRestaurantSelected", "No restaurant selected")}</p>
        <p className="text-sm mt-1">{t("menu:linkRestaurantToView", "Menu and add-ons are per restaurant. Link your account to a restaurant, then open this page again.")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {itemsTab ? <UtensilsCrossed className="h-6 w-6" /> :
                categoriesTab ? <LayoutGrid className="h-6 w-6" /> :
                  subCategoriesTab ? <ListTree className="h-6 w-6" /> :
                    inventoryTab ? <Boxes className="h-6 w-6" /> :
                      maxOrderTab ? <Gauge className="h-6 w-6" /> :
                        <PlusSquare className="h-6 w-6" />}
              {itemsTab ? t("menu:title", "Menu") :
                categoriesTab ? t("menu:tabCategories", "Categories") :
                  subCategoriesTab ? t("menu:tabSubCategories", "Sub-categories") :
                    inventoryTab ? t("menu:tabInventory", "Inventory") :
                      maxOrderTab ? t("menu:tabMaxOrder", "Max Order") :
                        t("menu:tabAddOns", "Add-ons")}
            </h1>
            {isSuperAdmin ? (
              <Badge variant="secondary" className="font-normal">
                {restaurantFilterId === 'all' ? t("superAdmin:allRestaurants", "All Restaurants") : (restaurantMap[restaurantFilterId] || 'Loading...')}
              </Badge>
            ) : restaurantName ? (
              <Badge variant="secondary" className="font-normal">
                {restaurantName}
              </Badge>
            ) : null}
            {addonsTab ? (
              <Badge variant="outline" className="text-xs font-normal border-primary/40 text-primary">
                {t("menu:thisLocationOnly", "This location only")}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">
            {addonsTab
              ? t("menu:addonsDesc", "Add-ons belong only to this restaurant. They never appear on another location’s menu. Link them to items from the Items tab when editing an item.")
              : categoriesTab ? t("menu:categoriesDesc", "Manage menu categories for this restaurant.")
                : subCategoriesTab ? t("menu:subCategoriesDesc", "Manage menu sub-categories for this restaurant.")
                  : inventoryTab ? t("menu:inventoryDesc", "Track stock per item. When inventory hits zero, the item is marked unavailable.")
                    : maxOrderTab ? t("menu:maxOrderDesc", "Set the maximum quantity a customer can order per item. Leave blank for no limit.")
                      : t("menu:categoriesAndItemsDesc", "Categories and items for this restaurant only.")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {itemsTab && restaurantId ? <MenuImportButton restaurantId={restaurantId} onImported={load} /> : null}
          {categoriesTab && (
            <Dialog open={catDialog} onOpenChange={(o) => { setCatDialog(o); if (!o) setEditCat(null); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />{t("menu:addCategory", "Add Category")}</Button></DialogTrigger>
              {catDialog && (
                <CategoryForm
                  key={editCat ? `edit-${editCat.id}` : "new-cat"}
                  initial={editCat}
                  onSubmit={saveCategory}
                  isSaving={isSaving}
                  isSuperAdmin={false}
                  restaurantPickerOptions={[]}
                />
              )}
            </Dialog>
          )}
          {subCategoriesTab && (
            <Dialog open={subCatDialog} onOpenChange={(o) => { setSubCatDialog(o); if (!o) setEditSubCat(null); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />{t("menu:addSubCategory", "Add Sub-category")}</Button></DialogTrigger>
              {subCatDialog && (
                <SubCategoryForm
                  key={editSubCat ? `edit-${editSubCat.id}` : "new-subcat"}
                  initial={editSubCat}
                  categories={categories}
                  onSubmit={saveSubCategory}
                  isSaving={isSaving}
                  isSuperAdmin={false}
                  restaurantPickerOptions={[]}
                />
              )}
            </Dialog>
          )}
          {itemsTab && (
            <Button
              onClick={() => {
                setEditItem(null);
                setEditItemAddonIds([]);
                setItemDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />{t("menu:addItem", "Add Item")}
            </Button>
          )}
          {addonsTab && (
            <Button
              onClick={() => {
                setEditAddon(null);
                setAddonDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />{t("menu:addAddOn", "Add Add-on")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void triggerMenuSync(true)}
            title="Sync menu & inventory to Synthflow (or ElevenLabs) AI agent"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {t("menu:syncAi", "Sync AI")}
          </Button>
        </div>
      </div>

      <Dialog open={itemDialog} onOpenChange={(o) => {
        setItemDialog(o);
        if (!o) {
          setEditItem(null);
          setEditItemAddonIds([]);
        }
      }}
      >
        {itemDialog && (
          <ItemForm
            key={editItem ? `edit-${editItem.id}` : "new-item"}
            initial={editItem}
            initialAddonIds={editItem ? editItemAddonIds : []}
            initialVariants={editItem ? itemVariants.filter(v => v.menu_item_id === editItem.id) : []}
            categories={categories}
            subCategories={subCategories}
            addons={addons}
            onSubmit={saveItem}
            isSaving={isSaving}
            isSuperAdmin={false}
            restaurantPickerOptions={[]}
          />
        )}
      </Dialog>

      <Dialog open={addonDialog} onOpenChange={(o) => { setAddonDialog(o); if (!o) setEditAddon(null); }}>
        {addonDialog && (
          <AddonForm
            key={editAddon ? `edit-${editAddon.id}` : "new-addon"}
            initial={editAddon}
            restaurantName={restaurantName}
            defaultRestaurantId={restaurantId}
            showRestaurantPicker={false}
            restaurantPickerOptions={[]}
            onSubmit={saveAddon}
            isSaving={isSaving}
          />
        )}
      </Dialog>

      {loading ? (
        <p className="text-muted-foreground">{t("common:loading", "Loading…")}</p>
      ) : addonsTab ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="text-left bg-muted/50">
                  <tr>
                    <th className="p-3">{t("menu:itemName", "Name")}</th>
                    <th className="p-3 max-w-[200px]">{t("menu:itemDescription", "Description")}</th>
                    <th className="p-3 whitespace-nowrap">{t("menu:price", "Price")}</th>
                    <th className="p-3">{t("common:sort", "Sort")}</th>
                    <th className="p-3 whitespace-nowrap">{t("superAdmin:allRestaurants", "Restaurants")}</th>
                    <th className="p-3">{t("common:status", "Active")}</th>
                    <th className="p-3 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {displayedAddons.map((ad) => {
                    const cluster = addonRestaurantCluster[ad.id];
                    const restaurantCount = cluster?.count ?? 1;
                    const restaurantNames =
                      cluster?.restaurantNames?.length ? cluster.restaurantNames : restaurantName ? [restaurantName] : [];
                    const tooltipTitle = restaurantNames.join(", ");
                    return (
                      <tr key={ad.id} className="border-t">
                        <td className="p-3 font-medium">{ad.name}</td>
                        <td className="p-3 text-muted-foreground truncate max-w-[200px]" title={ad.description || undefined}>{ad.description || "—"}</td>
                        <td className="p-3 whitespace-nowrap">{formatCurrency(ad.price)}</td>
                        <td className="p-3 text-muted-foreground">{ad.sort_order}</td>
                        <td className="p-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "tabular-nums font-medium text-foreground rounded px-1.5 py-0.5 -mx-1.5",
                                  "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  restaurantNames.length ? "cursor-help underline decoration-dotted underline-offset-2" : "",
                                )}
                                aria-label={tooltipTitle ? t("menu:restaurantsLabel", "Restaurants: {{list}}", { list: tooltipTitle }) : t("menu:restaurants", "Restaurants")}
                              >
                                {restaurantCount}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs font-medium text-foreground mb-1.5">
                                {restaurantCount === 1 ? t("menu:restaurant", "Restaurant") : t("menu:restaurantsCount", "{{count}} restaurants", { count: restaurantCount })}
                              </p>
                              {restaurantNames.length > 0 ? (
                                <ul className="text-xs text-popover-foreground list-disc pl-4 space-y-0.5">
                                  {restaurantNames.map((n, idx) => (
                                    <li key={`${n}-${idx}`}>{n}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">{t("menu:noNamesLoaded", "No names loaded.")}</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3">
                          {ad.is_active ? (
                            <Badge variant="outline" className="bg-green-500/15 text-green-700">{t("common:yes", "Yes")}</Badge>
                          ) : (
                            <Badge variant="secondary">{t("common:no", "No")}</Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditAddon(ad); setAddonDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteAddon(ad.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                  {addons.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">{t("menu:noAddonsYet", "No add-ons yet. Create add-ons here, then link them to items from the Items screen.")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : categoriesTab ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left bg-muted/50">
                  <tr>
                    <th className="p-3">{t("menu:itemName", "Name")}</th>
                    <th className="p-3">{t("menu:itemDescription", "Description")}</th>
                    <th className="p-3">{t("common:sort", "Sort")}</th>
                    {isSuperAdmin && <th className="p-3">{t("menu:restaurant", "Restaurant")}</th>}
                    <th className="p-3">{t("common:status", "Active")}</th>
                    <th className="p-3 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {displayedCategories.map((cat) => (
                    <tr key={cat.id} className="border-t">
                      <td className="p-3 font-medium">{cat.name}</td>
                      <td className="p-3 text-muted-foreground">{cat.description || "—"}</td>
                      <td className="p-3">{cat.sort_order}</td>
                      {isSuperAdmin && (
                        <td className="p-3 text-muted-foreground">
                          {restaurantMap[cat.restaurant_id || ""] || "—"}
                        </td>
                      )}
                      <td className="p-3">
                        {cat.is_active ? <Badge variant="outline" className="bg-green-500/15 text-green-700">{t("common:yes", "Yes")}</Badge> : <Badge variant="secondary">{t("common:no", "No")}</Badge>}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="ghost" onClick={() => { setEditCat(cat); setCatDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteCategory(cat.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : subCategoriesTab ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left bg-muted/50">
                  <tr>
                    <th className="p-3">{t("menu:itemName", "Name")}</th>
                    <th className="p-3">{t("menu:category", "Category")}</th>
                    <th className="p-3">{t("menu:itemDescription", "Description")}</th>
                    <th className="p-3">{t("common:sort", "Sort")}</th>
                    {isSuperAdmin && <th className="p-3">{t("menu:restaurant", "Restaurant")}</th>}
                    <th className="p-3">{t("common:status", "Active")}</th>
                    <th className="p-3 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {displayedSubCategories.map((sc) => (
                    <tr key={sc.id} className="border-t">
                      <td className="p-3 font-medium">{sc.name}</td>
                      <td className="p-3">{categories.find(c => c.id === sc.category_id)?.name || "—"}</td>
                      <td className="p-3 text-muted-foreground">{sc.description || "—"}</td>
                      <td className="p-3">{sc.sort_order}</td>
                      {isSuperAdmin && (
                        <td className="p-3 text-muted-foreground">
                          {restaurantMap[sc.restaurant_id || ""] || "—"}
                        </td>
                      )}
                      <td className="p-3">
                        {sc.is_active ? <Badge variant="outline" className="bg-green-500/15 text-green-700">{t("common:yes", "Yes")}</Badge> : <Badge variant="secondary">{t("common:no", "No")}</Badge>}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="ghost" onClick={() => { setEditSubCat(sc); setSubCatDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteSubCategory(sc.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : inventoryTab ? (
        <div className="space-y-4">
          {isSuperAdmin && restaurantFilterId === 'all' && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-500 p-4 rounded-lg text-sm font-medium">
              ⚠️ {t("menu:selectRestaurantWarning", "To track and edit stock levels, please select a specific restaurant using the filter dropdown above.")}
            </div>
          )}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="text-left bg-muted/50">
                    <tr>
                      <th className="p-3">{t("menu:itemName", "Item")}</th>
                      <th className="p-3">{t("menu:trackInventory", "Track inventory")}</th>
                      <th className="p-3 whitespace-nowrap">{t("menu:stock", "Stock")}</th>
                      <th className="p-3">{t("common:status", "Status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedItems.map((it) => {
                      const tracked = Boolean(it.track_inventory);
                      const stock = it.stock_quantity ?? 0;
                      const statusLabel = !tracked
                        ? t("menu:notTracked", "Not tracked")
                        : stock > 0
                          ? t("menu:inStock", "In stock")
                          : t("menu:outOfStock", "Out of stock");
                      const statusVariant = !tracked
                        ? "secondary"
                        : stock > 0
                          ? "outline"
                          : "destructive";
                      return (
                        <tr key={it.id} className="border-t">
                          <td className="p-3 font-medium">{it.name}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={tracked}
                                disabled={savingItemId === it.id || (isSuperAdmin && restaurantFilterId === 'all')}
                                onCheckedChange={(checked) =>
                                  void saveInventoryFields(it, {
                                    track_inventory: checked,
                                    stock_quantity: checked ? stock || 0 : null,
                                  })
                                }
                              />
                              {savingItemId === it.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                            </div>
                          </td>
                          <td className="p-3">
                            {tracked ? (
                              <Input
                                key={`${it.id}-stock-${stock}`}
                                type="number"
                                min={0}
                                className="w-24"
                                defaultValue={stock}
                                disabled={savingItemId === it.id || (isSuperAdmin && restaurantFilterId === 'all')}
                                onBlur={(e) =>
                                  void saveInventoryFields(it, {
                                    track_inventory: true,
                                    stock_quantity: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  })
                                }
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={statusVariant as "outline" | "secondary" | "destructive"}
                              className={tracked && stock > 0 ? "bg-green-500/15 text-green-700" : undefined}
                            >
                              {statusLabel}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {displayedItems.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-muted-foreground">
                          {t("menu:noItemsFound", "No menu items yet. Add items from the Items tab first.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : maxOrderTab ? (
        <div className="space-y-4">
          {isSuperAdmin && restaurantFilterId === 'all' && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-500 p-4 rounded-lg text-sm font-medium">
              ⚠️ {t("menu:selectRestaurantWarning", "To set and edit maximum order quantities, please select a specific restaurant using the filter dropdown above.")}
            </div>
          )}
          <Card className="border shadow-sm">
            <CardHeader className="p-4 pb-3 border-b bg-card">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                {/* Search input */}
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("menu:searchMaxOrderPlaceholder", "Search by item or flavor name...")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-sm bg-background"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Limit status filter */}
                  <Select value={limitFilter} onValueChange={setLimitFilter}>
                    <SelectTrigger className="w-[140px] h-9 text-sm">
                      <SelectValue placeholder={t("common:limit", "Limit")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common:allLimits", "All Limits")}</SelectItem>
                      <SelectItem value="limited">{t("menu:limitedOnly", "Limited Only")}</SelectItem>
                      <SelectItem value="unlimited">{t("menu:unlimitedOnly", "Unlimited")}</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Flavors filter */}
                  <Select value={flavorFilter} onValueChange={setFlavorFilter}>
                    <SelectTrigger className="w-[145px] h-9 text-sm">
                      <SelectValue placeholder="Flavors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Items</SelectItem>
                      <SelectItem value="with_flavors">With Flavors</SelectItem>
                      <SelectItem value="without_flavors">No Flavors</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Restaurants filter for Super Admin */}
                  {isSuperAdmin && (
                    <Select value={restaurantFilterId} onValueChange={setRestaurantFilterId}>
                      <SelectTrigger className="w-[150px] h-9 text-sm">
                        <SelectValue placeholder={t("superAdmin:restaurants", "Restaurants")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("superAdmin:allRestaurants", "All Restaurants")}</SelectItem>
                        {allRestaurants.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Clear filters button */}
                  {hasActiveMaxOrderFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearMaxOrderFilters}
                      className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FilterX className="h-3.5 w-3.5 mr-1" />
                      {t("menu:clearFilters", "Clear filters")}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px] border-collapse">
                  <thead className="text-left bg-muted/40 text-muted-foreground border-b text-xs font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4 w-12 text-center">{t("menu:itemNumber", "ITEM #")}</th>
                      <th className="py-3 px-4 min-w-[220px]">{t("menu:itemName", "ITEM NAME")}</th>
                      <th className="py-3 px-4 min-w-[200px]">{t("menu:flavor", "FLAVOR")}</th>
                      <th className="py-3 px-4 w-44 whitespace-nowrap">{t("menu:maxOrderQuantity", "MAX ORDER QUANTITY")}</th>
                      <th className="py-3 px-4 w-32 whitespace-nowrap">{t("common:limit", "LIMIT STATUS")}</th>
                      <th className="py-3 px-4 w-20 text-right">{t("common:actions", "ACTIONS")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {flattenedMaxOrderRows.map(({ item: it, flavor, maxOrderQuantity, key }, idx) => {
                      const thumbSrc = resolveMediaUrl(it.image_url);
                      const categoryName = categories.find((c) => c.id === it.category_id)?.name || t("common:uncategorized", "Uncategorized");
                      const subCategoryName = subCategories.find((sc) => sc.id === it.sub_category_id)?.name;
                      const saveKey = flavor ? `${it.id}-flv-${flavor}` : it.id;

                      return (
                        <tr key={key} className="hover:bg-muted/30 transition-colors">
                          {/* # */}
                          <td className="py-3 px-4 align-middle text-center text-xs font-medium text-muted-foreground">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-muted/50 border border-border/40 font-semibold text-xs">
                              {idx + 1}
                            </span>
                          </td>

                          {/* Item Info */}
                          <td className="py-3 px-4 align-middle">
                            <div className="flex items-center gap-3">
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  alt={it.name}
                                  className="h-11 w-11 rounded-lg object-cover border bg-muted/20 shadow-2xs shrink-0"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="h-11 w-11 rounded-lg border bg-muted/30 flex items-center justify-center text-muted-foreground shrink-0">
                                  <UtensilsCrossed className="h-5 w-5 opacity-50" />
                                </div>
                              )}
                              <div className="min-w-0 space-y-0.5">
                                <Link
                                  to={`/menu/items/${it.id}`}
                                  className="font-bold text-foreground hover:text-primary hover:underline underline-offset-2 text-sm leading-tight line-clamp-1"
                                >
                                  {it.name}
                                </Link>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-block text-[11px] font-medium text-muted-foreground bg-muted/70 px-2 py-0.5 rounded">
                                    {categoryName}
                                  </span>
                                  {subCategoryName && (
                                    <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                                      • {subCategoryName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Flavor */}
                          <td className="py-3 px-4 align-middle">
                            {flavor ? (
                              <Badge
                                variant="secondary"
                                className="bg-amber-500/10 text-amber-900 dark:text-amber-300 border border-amber-500/25 font-semibold text-xs px-2.5 py-1 inline-flex items-center gap-1.5 shadow-2xs"
                              >
                                <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                {flavor}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">— Standard</span>
                            )}
                          </td>

                          {/* Max per order input */}
                          <td className="py-3 px-4 align-middle">
                            <div className="flex items-center gap-2">
                              <Input
                                key={`${it.id}-${flavor ?? "standard"}-max-${maxOrderQuantity ?? "none"}`}
                                type="number"
                                min={1}
                                className="w-32 h-9 text-sm font-semibold tabular-nums"
                                placeholder={t("common:noLimit", "No limit")}
                                defaultValue={maxOrderQuantity ?? ""}
                                disabled={savingItemId === saveKey || (isSuperAdmin && restaurantFilterId === 'all')}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                onBlur={(e) => void saveMaxOrderQuantity(it, flavor, e.target.value)}
                              />
                              {savingItemId === saveKey && (
                                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                              )}
                            </div>
                          </td>

                          {/* Limit Status */}
                          <td className="py-3 px-4 align-middle">
                            {maxOrderQuantity ? (
                              <Badge
                                variant="outline"
                                className="bg-primary/10 text-primary border-primary/20 font-bold text-xs whitespace-nowrap"
                              >
                                {t("common:upTo", "Up to")} {maxOrderQuantity} / order
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-muted-foreground font-normal text-xs whitespace-nowrap"
                              >
                                {t("common:unlimited", "Unlimited")}
                              </Badge>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 align-middle text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 rounded-lg border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                                asChild
                                title={t("common:view", "View details")}
                              >
                                <Link to={`/menu/items/${it.id}`}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 rounded-lg border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                                onClick={() => beginEditItem(it)}
                                title={t("common:edit", "Edit")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {flattenedMaxOrderRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Gauge className="h-8 w-8 text-muted-foreground/50" />
                            <p className="font-medium text-foreground">
                              {hasActiveMaxOrderFilters
                                ? "No menu items match your search or filter criteria."
                                : t("menu:noItemsFound", "No menu items yet. Add items from the Items tab first.")}
                            </p>
                            {hasActiveMaxOrderFilters && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={clearMaxOrderFilters}
                                className="mt-1 text-xs"
                              >
                                <FilterX className="h-3.5 w-3.5 mr-1" />
                                {t("menu:clearFilters", "Clear filters")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border shadow-sm">
          <CardHeader className="p-4 pb-3 border-b bg-card">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Search by name */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("menu:searchPlaceholder", "Search by product name...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm bg-background"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Status filter */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[130px] h-9 text-sm">
                    <SelectValue placeholder={t("common:status", "Status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common:status", "Status")}: {t("common:all", "All")}</SelectItem>
                    <SelectItem value="available">{t("menu:available", "Available")}</SelectItem>
                    <SelectItem value="unavailable">{t("menu:unavailable", "Unavailable")}</SelectItem>
                  </SelectContent>
                </Select>

                {/* Category filter */}
                <Select value={categoryFilterId} onValueChange={setCategoryFilterId}>
                  <SelectTrigger className="w-[160px] h-9 text-sm">
                    <SelectValue placeholder={t("menu:category", "Category")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("menu:allCategories", "All Categories")}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Restaurants filter for Super Admin */}
                {isSuperAdmin && (
                  <Select value={restaurantFilterId} onValueChange={setRestaurantFilterId}>
                    <SelectTrigger className="w-[160px] h-9 text-sm">
                      <SelectValue placeholder={t("superAdmin:restaurants", "Restaurants")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("superAdmin:allRestaurants", "All Restaurants")}</SelectItem>
                      {allRestaurants.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Clear filters button */}
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <FilterX className="h-3.5 w-3.5 mr-1" />
                    {t("menu:clearFilters", "Clear filters")}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <MenuItemsTable
              items={filteredItems}
              categories={categories}
              subCategories={subCategories}
              itemVariants={itemVariants}
              onEdit={beginEditItem}
              onDelete={deleteItem}
              onToggleAvailability={toggleItemAvailability}
              addonSummary={addonSummary}
              itemAddonCount={itemAddonCount}
              emptyMessage={
                hasActiveFilters
                  ? "No menu items match your current search and filter criteria."
                  : "No menu items found. Click 'Add Item' to create your first item."
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type AddonFormSubmit = Partial<MenuAddon> & { restaurant_ids?: string[] };

function AddonForm({
  initial,
  restaurantName,
  defaultRestaurantId,
  showRestaurantPicker,
  restaurantPickerOptions,
  onSubmit,
  isSaving,
}: {
  initial: MenuAddon | null;
  restaurantName: string | null;
  defaultRestaurantId: string;
  showRestaurantPicker: boolean;
  restaurantPickerOptions: { id: string; name: string }[];
  onSubmit: (f: AddonFormSubmit) => void;
  isSaving?: boolean;
}) {
  const { t } = useTranslation(["menu", "common", "superAdmin"]);
  const { toast } = useToast();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AddonFieldKey, string>>>({});
  const [form, setForm] = useState<Partial<MenuAddon>>(() =>
    initial || {
      name: "",
      description: "",
      price: 0,
      sort_order: 0,
      is_active: true,
      restaurant_id: defaultRestaurantId,
    },
  );
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<string[]>([defaultRestaurantId]);

  useEffect(() => {
    if (initial) {
      setForm({ ...initial });
    } else {
      setForm({
        name: "",
        description: "",
        price: 0,
        sort_order: 0,
        is_active: true,
        restaurant_id: defaultRestaurantId,
      });
      setSelectedRestaurantIds([defaultRestaurantId]);
    }
    setFieldErrors({});
  }, [initial, defaultRestaurantId]);

  const toggleRestaurantPick = (id: string) => {
    setSelectedRestaurantIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const selectedRid = String(form.restaurant_id || defaultRestaurantId);
  const selectedLabel = restaurantPickerOptions.find((x) => x.id === selectedRid)?.name ?? restaurantName;

  const handleSubmit = () => {
    const errs = validateAddonForm(form);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    if (!initial && showRestaurantPicker && selectedRestaurantIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Select a restaurant",
        description: "Choose at least one restaurant for this add-on.",
      });
      return;
    }
    if (!initial && showRestaurantPicker && selectedRestaurantIds.length) {
      onSubmit({ ...form, restaurant_ids: selectedRestaurantIds });
      return;
    }
    onSubmit({ ...form });
  };

  return (
    <DialogContent className="max-w-lg sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit add-on" : "New add-on"}</DialogTitle>
        {showRestaurantPicker ? (
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            {initial
              ? "Super admin: move this add-on to another restaurant if needed."
              : "Super admin: select one or more restaurants — we create the same add-on for each. Tenant logins always create add-ons only for their own restaurant."}
          </DialogDescription>
        ) : restaurantName ? (
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            Saved for <span className="font-medium text-foreground">{restaurantName}</span> (the restaurant linked to your
            account).
          </DialogDescription>
        ) : (
          <DialogDescription className="text-sm text-muted-foreground pt-1">Saved for your authenticated restaurant.</DialogDescription>
        )}
      </DialogHeader>
      <DialogBody className="space-y-3">
        {showRestaurantPicker && restaurantPickerOptions.length > 0 && !initial ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Restaurants</Label>
              <div className="flex gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedRestaurantIds(restaurantPickerOptions.map((r) => r.id))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedRestaurantIds([defaultRestaurantId])}
                >
                  Reset
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">One add-on row per selected location (same name, price, and options).</p>
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
              {selectedRestaurantIds.length} restaurant{selectedRestaurantIds.length === 1 ? "" : "s"} selected
            </p>
          </div>
        ) : null}
        {showRestaurantPicker && restaurantPickerOptions.length > 0 && initial ? (
          <div className="space-y-2">
            <Label>{t("superAdmin:restaurant", "Restaurant")}</Label>
            <Select value={selectedRid} onValueChange={(v) => setForm({ ...form, restaurant_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder={t("menu:selectRestaurant", "Select restaurant")} />
              </SelectTrigger>
              <SelectContent>
                {restaurantPickerOptions.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLabel ? (
              <p className="text-xs text-muted-foreground">
                Add-on will be stored under <span className="font-medium text-foreground">{selectedLabel}</span>.
              </p>
            ) : null}
          </div>
        ) : null}
        <div>
          <Label htmlFor="addon-name">Name</Label>
          <Input
            id="addon-name"
            name="addon-name"
            required
            maxLength={200}
            value={form.name || ""}
            aria-invalid={!!fieldErrors.name}
            className={cn(fieldErrors.name && "border-destructive focus-visible:ring-destructive")}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              setFieldErrors((fe) => {
                if (!fe.name) return fe;
                const next = { ...fe };
                delete next.name;
                return next;
              });
            }}
          />
          {fieldErrors.name ? <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p> : null}
        </div>
        <div>
          <Label htmlFor="addon-description">Description</Label>
          <Textarea
            id="addon-description"
            name="addon-description"
            maxLength={5000}
            value={form.description || ""}
            aria-invalid={!!fieldErrors.description}
            className={cn(fieldErrors.description && "border-destructive focus-visible:ring-destructive")}
            onChange={(e) => {
              setForm({ ...form, description: e.target.value });
              setFieldErrors((fe) => {
                if (!fe.description) return fe;
                const next = { ...fe };
                delete next.description;
                return next;
              });
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
            <Label htmlFor="addon-price">Extra price</Label>
            <Input
              id="addon-price"
              name="addon-price"
              type="text"
              inputMode="decimal"
              value={form.price === undefined || form.price === null ? "" : String(form.price)}
              aria-invalid={!!fieldErrors.price}
              className={cn(fieldErrors.price && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                const next = sanitizePriceDraft(e.target.value);
                if (next === null) return;
                setForm({ ...form, price: next as unknown as number });
                setFieldErrors((fe) => {
                  if (!fe.price) return fe;
                  const cleared = { ...fe };
                  delete cleared.price;
                  return cleared;
                });
              }}
            />
            {fieldErrors.price ? <p className="text-xs text-destructive mt-1">{fieldErrors.price}</p> : null}
          </div>
          <div>
            <Label htmlFor="addon-sort">Sort order</Label>
            <Input
              id="addon-sort"
              name="addon-sort"
              type="number"
              min={0}
              max={2147483647}
              step={1}
              inputMode="numeric"
              value={form.sort_order ?? 0}
              aria-invalid={!!fieldErrors.sort_order}
              className={cn(fieldErrors.sort_order && "border-destructive focus-visible:ring-destructive")}
              onChange={(e) => {
                const v = e.target.value;
                const n = v === "" ? 0 : parseInt(v, 10);
                setForm({ ...form, sort_order: Number.isFinite(n) && !Number.isNaN(n) ? n : 0 });
                setFieldErrors((fe) => {
                  if (!fe.sort_order) return fe;
                  const next = { ...fe };
                  delete next.sort_order;
                  return next;
                });
              }}
            />
            {fieldErrors.sort_order ? (
              <p className="text-xs text-destructive mt-1">{fieldErrors.sort_order}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          <Label>Active</Label>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={handleSubmit} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CategoryForm({
  initial,
  onSubmit,
  isSaving,
  isSuperAdmin,
  restaurantPickerOptions,
}: {
  initial: Category | null;
  onSubmit: (f: Partial<Category> & { restaurant_id?: string }) => void;
  isSaving?: boolean;
  isSuperAdmin: boolean;
  restaurantPickerOptions: { id: string; name: string }[];
}) {
  const { t } = useTranslation(["menu", "common", "superAdmin"]);
  const [form, setForm] = useState<Partial<Category> & { restaurant_id?: string }>(
    initial || { name: "", description: "", sort_order: 0, is_active: true }
  );
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>(
    initial?.restaurant_id ?? (isSuperAdmin && restaurantPickerOptions.length ? restaurantPickerOptions[0].id : "")
  );

  useEffect(() => {
    setForm(initial || { name: "", description: "", sort_order: 0, is_active: true });
    if (isSuperAdmin && restaurantPickerOptions.length) {
      setSelectedRestaurantId(initial?.restaurant_id ?? restaurantPickerOptions[0].id);
    }
  }, [initial, isSuperAdmin, restaurantPickerOptions]);

  const handleSave = () => {
    const payload = { ...form };
    if (isSuperAdmin) {
      payload.restaurant_id = selectedRestaurantId;
    }
    onSubmit(payload);
  };

  return (
    <DialogContent className="max-w-lg sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit category" : "New category"}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground pt-1">
          {initial ? "Update the category details below." : "Create a new category for your menu items."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {isSuperAdmin && (
          <div>
            <Label>{t("superAdmin:restaurant", "Restaurant")}</Label>
            <Select value={selectedRestaurantId} onValueChange={setSelectedRestaurantId}>
              <SelectTrigger>
                <SelectValue placeholder={t("menu:selectRestaurant", "Select restaurant")} />
              </SelectTrigger>
              <SelectContent>
                {restaurantPickerOptions.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>{t("common:name", "Name")}</Label>
          <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <Label>{t("common:description", "Description")}</Label>
          <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <Label>{t("common:sortOrder", "Sort order")}</Label>
          <Input
            type="number"
            value={form.sort_order || 0}
            onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          <Label>{t("common:active", "Active")}</Label>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("common:save", "Save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SubCategoryForm({
  initial,
  categories,
  onSubmit,
  isSaving,
  isSuperAdmin,
  restaurantPickerOptions,
}: {
  initial: SubCategory | null;
  categories: Category[];
  onSubmit: (f: Partial<SubCategory> & { restaurant_id?: string }) => void;
  isSaving?: boolean;
  isSuperAdmin: boolean;
  restaurantPickerOptions: { id: string; name: string }[];
}) {
  const { t } = useTranslation(["menu", "common", "superAdmin"]);
  const [form, setForm] = useState<Partial<SubCategory> & { restaurant_id?: string }>(
    initial || { name: "", description: "", sort_order: 0, is_active: true, category_id: "" }
  );
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>(
    initial?.restaurant_id ?? (isSuperAdmin && restaurantPickerOptions.length ? restaurantPickerOptions[0].id : "")
  );

  useEffect(() => {
    setForm(initial || { name: "", description: "", sort_order: 0, is_active: true, category_id: "" });
    if (isSuperAdmin && restaurantPickerOptions.length) {
      setSelectedRestaurantId(initial?.restaurant_id ?? restaurantPickerOptions[0].id);
    }
  }, [initial, isSuperAdmin, restaurantPickerOptions]);

  const handleSave = () => {
    const payload = { ...form };
    if (isSuperAdmin) {
      payload.restaurant_id = selectedRestaurantId;
    }
    onSubmit(payload);
  };

  const filteredCategories = useMemo(() => {
    if (!isSuperAdmin) return categories;
    return categories.filter(c => !selectedRestaurantId || String(c.restaurant_id) === String(selectedRestaurantId));
  }, [categories, isSuperAdmin, selectedRestaurantId]);

  return (
    <DialogContent className="max-w-lg sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{initial ? t("menu:editSubCategory", "Edit sub-category") : t("menu:addSubCategory", "New sub-category")}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground pt-1">
          {initial ? "Update sub-category details below." : "Create a new sub-category."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {isSuperAdmin && (
          <div>
            <Label>{t("superAdmin:restaurant", "Restaurant")}</Label>
            <Select value={selectedRestaurantId} onValueChange={(v) => {
              setSelectedRestaurantId(v);
              setForm(prev => ({ ...prev, category_id: "" }));
            }}>
              <SelectTrigger>
                <SelectValue placeholder={t("menu:selectRestaurant", "Select restaurant")} />
              </SelectTrigger>
              <SelectContent>
                {restaurantPickerOptions.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>{t("menu:category", "Category")}</Label>
          <Select value={form.category_id || ""} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger>
              <SelectValue placeholder={t("menu:selectParentCategory", "Select parent category")} />
            </SelectTrigger>
            <SelectContent>
              {filteredCategories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Name</Label>
          <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <Label>Sort order</Label>
          <Input
            type="number"
            value={form.sort_order || 0}
            onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          <Label>Active</Label>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}


interface FlavorEntry {
  id: string;
  name: string;
  is_active: boolean;
}

interface SizeEntry {
  id: string;
  name: string;
  measurement: string;
  /** number when saved; string while typing so decimals like "12." are not wiped */
  price: number | string;
  is_active: boolean;
  flavors: FlavorEntry[];
}

function ItemForm({
  initial,
  initialAddonIds,
  initialVariants,
  categories,
  subCategories,
  addons,
  onSubmit,
  isSaving,
  isSuperAdmin,
  restaurantPickerOptions,
}: {
  initial: MenuItem | null;
  initialAddonIds: string[];
  initialVariants: MenuItemVariant[];
  categories: Category[];
  subCategories: SubCategory[];
  addons: MenuAddon[];
  onSubmit: (f: Partial<MenuItem> & { addon_ids?: string[]; variants?: Partial<MenuItemVariant>[]; restaurant_id?: string }) => void | Promise<void>;
  isSaving?: boolean;
  isSuperAdmin: boolean;
  restaurantPickerOptions: { id: string; name: string }[];
}) {
  const { t } = useTranslation(["menu", "common", "superAdmin"]);
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<MenuItem>>(() =>
    initial
      ? { ...initial }
      : {
          name: "",
          description: "",
          price: 0,
          is_available: true,
          prep_time_minutes: 15,
          dietary_tags: [],
          spice_level: 0,
          category_id: "",
          sub_category_id: null,
        }
  );
  const [tagsText, setTagsText] = useState(() => (initial?.dietary_tags || []).join(", "));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(() => (initial ? initialAddonIds || [] : []));
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>(
    initial?.restaurant_id ?? (isSuperAdmin && restaurantPickerOptions.length ? restaurantPickerOptions[0].id : "")
  );

  const [sizes, setSizes] = useState<SizeEntry[]>(() => {
    if (!initial) return [];
    const initialList = (initialVariants || []) as MenuItemVariant[];
    const sizeRows = initialList.filter((v) => v.variant_type === "size");
    const childFlavors = initialList.filter((v) => v.variant_type !== "size" && v.parent_id);
    return sizeRows.map((s) => ({
      id: s.id || crypto.randomUUID(),
      name: s.name,
      measurement: s.measurement || "",
      price: Number(s.price) || 0,
      is_active: s.is_active ?? true,
      flavors: childFlavors
        .filter((f) => f.parent_id === s.id)
        .map((f) => ({
          id: f.id || crypto.randomUUID(),
          name: f.name,
          is_active: f.is_active ?? true,
        })),
    }));
  });

  const [standaloneFlavors, setStandaloneFlavors] = useState<FlavorEntry[]>(() => {
    if (!initial) return [];
    const initialList = (initialVariants || []) as MenuItemVariant[];
    const rootFlavors = initialList.filter((v) => v.variant_type !== "size" && !v.parent_id);
    return rootFlavors.map((f) => ({
      id: f.id || crypto.randomUUID(),
      name: f.name,
      is_active: f.is_active ?? true,
    }));
  });

  const filteredCategories = useMemo(() => {
    if (!isSuperAdmin) return categories;
    return categories.filter((c) => !selectedRestaurantId || String(c.restaurant_id) === String(selectedRestaurantId));
  }, [categories, isSuperAdmin, selectedRestaurantId]);

  const filteredSubCategories = useMemo(() => {
    let list = subCategories;
    if (isSuperAdmin && selectedRestaurantId) {
      list = list.filter((sc) => String(sc.restaurant_id) === String(selectedRestaurantId));
    }
    if (form.category_id) {
      list = list.filter((sc) => sc.category_id === form.category_id);
    }
    return list;
  }, [subCategories, isSuperAdmin, selectedRestaurantId, form.category_id]);

  const filteredAddons = useMemo(() => {
    if (!isSuperAdmin) return addons;
    return addons.filter((a) => !selectedRestaurantId || String(a.restaurant_id) === String(selectedRestaurantId));
  }, [addons, isSuperAdmin, selectedRestaurantId]);

  useEffect(() => {
    if (initial) {
      setForm({ ...initial });
      setTagsText((initial?.dietary_tags || []).join(", "));
      setSelectedAddonIds(initialAddonIds || []);
      const initialList = (initialVariants || []) as MenuItemVariant[];
      const sizeRows = initialList.filter((v) => v.variant_type === "size");
      const childFlavors = initialList.filter((v) => v.variant_type !== "size" && v.parent_id);
      const rootFlavors = initialList.filter((v) => v.variant_type !== "size" && !v.parent_id);

      if (sizeRows.length > 0) {
        setSizes(
          sizeRows.map((s) => ({
            id: s.id || crypto.randomUUID(),
            name: s.name,
            measurement: s.measurement || "",
            price: Number(s.price) || 0,
            is_active: s.is_active ?? true,
            flavors: childFlavors
              .filter((f) => f.parent_id === s.id)
              .map((f) => ({
                id: f.id || crypto.randomUUID(),
                name: f.name,
                is_active: f.is_active ?? true,
              })),
          }))
        );
        setStandaloneFlavors([]);
      } else {
        setSizes([]);
        setStandaloneFlavors(
          rootFlavors.map((f) => ({
            id: f.id || crypto.randomUUID(),
            name: f.name,
            is_active: f.is_active ?? true,
          }))
        );
      }
    } else {
      setForm({
        name: "",
        description: "",
        price: 0,
        is_available: true,
        prep_time_minutes: 15,
        dietary_tags: [],
        spice_level: 0,
        category_id: "",
        sub_category_id: null,
      });
      setTagsText("");
      setSelectedAddonIds([]);
      setSizes([]);
      setStandaloneFlavors([]);
    }
    setImageFile(null);
    if (isSuperAdmin && restaurantPickerOptions.length) {
      setSelectedRestaurantId(initial?.restaurant_id ?? restaurantPickerOptions[0].id);
    }
  }, [initial, initialAddonIds, initialVariants, isSuperAdmin, restaurantPickerOptions]);

  const toggleAddon = (id: string) => {
    setSelectedAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const applyStandardPizzaSizes = () => {
    const defaultFlavors = () => [
      { id: crypto.randomUUID(), name: "Chicken Fajita", is_active: true },
      { id: crypto.randomUUID(), name: "Chicken Tikka", is_active: true },
      { id: crypto.randomUUID(), name: "BBQ Chicken", is_active: true },
      { id: crypto.randomUUID(), name: "Cheese Lover", is_active: true },
      { id: crypto.randomUUID(), name: "Pepperoni", is_active: true },
    ];
    setSizes([
      { id: crypto.randomUUID(), name: "Small", measurement: '9"', price: 8.0, is_active: true, flavors: defaultFlavors() },
      { id: crypto.randomUUID(), name: "Medium", measurement: '12"', price: 12.0, is_active: true, flavors: defaultFlavors() },
      { id: crypto.randomUUID(), name: "Large", measurement: '14"', price: 16.0, is_active: true, flavors: defaultFlavors() },
      { id: crypto.randomUUID(), name: "Family", measurement: '18"', price: 22.0, is_active: true, flavors: defaultFlavors() },
    ]);
    setStandaloneFlavors([]);
  };

  const addSizeCard = () => {
    const newId = crypto.randomUUID();
    const existingFlavors =
      sizes.length > 0 && sizes[sizes.length - 1].flavors.length > 0
        ? sizes[sizes.length - 1].flavors.map((f) => ({ id: crypto.randomUUID(), name: f.name, is_active: true }))
        : [
            { id: crypto.randomUUID(), name: "Chicken Fajita", is_active: true },
            { id: crypto.randomUUID(), name: "Chicken Tikka", is_active: true },
            { id: crypto.randomUUID(), name: "BBQ Chicken", is_active: true },
            { id: crypto.randomUUID(), name: "Cheese Lover", is_active: true },
          ];

    setSizes([
      ...sizes,
      {
        id: newId,
        name: "",
        measurement: "",
        price: Number(form.price) || 0,
        is_active: true,
        flavors: existingFlavors,
      },
    ]);
  };

  const removeSize = (idx: number) => {
    setSizes(sizes.filter((_, i) => i !== idx));
  };

  const moveSize = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= sizes.length) return;
    const next = [...sizes];
    const [removed] = next.splice(idx, 1);
    next.splice(target, 0, removed);
    setSizes(next);
  };

  const updateSize = (idx: number, field: keyof SizeEntry, value: any) => {
    const next = [...sizes];
    next[idx] = { ...next[idx], [field]: value };
    setSizes(next);
  };

  const addFlavorToSize = (sizeIdx: number, name = "") => {
    const next = [...sizes];
    next[sizeIdx] = {
      ...next[sizeIdx],
      flavors: [...next[sizeIdx].flavors, { id: crypto.randomUUID(), name, is_active: true }],
    };
    setSizes(next);
  };

  const removeFlavorFromSize = (sizeIdx: number, flvIdx: number) => {
    const next = [...sizes];
    next[sizeIdx] = {
      ...next[sizeIdx],
      flavors: next[sizeIdx].flavors.filter((_, i) => i !== flvIdx),
    };
    setSizes(next);
  };

  const updateFlavorInSize = (sizeIdx: number, flvIdx: number, field: keyof FlavorEntry, value: any) => {
    const next = [...sizes];
    const flvs = [...next[sizeIdx].flavors];
    flvs[flvIdx] = { ...flvs[flvIdx], [field]: value };
    next[sizeIdx] = { ...next[sizeIdx], flavors: flvs };
    setSizes(next);
  };

  const copyFlavorsToAllSizes = (sourceSizeIdx: number) => {
    const sourceFlavors = sizes[sourceSizeIdx].flavors;
    if (!sourceFlavors.length) {
      toast({ variant: "destructive", title: "No flavors", description: "This size has no flavors to copy." });
      return;
    }
    const next = sizes.map((s, i) => {
      if (i === sourceSizeIdx) return s;
      return {
        ...s,
        flavors: sourceFlavors.map((f) => ({ id: crypto.randomUUID(), name: f.name, is_active: f.is_active })),
      };
    });
    setSizes(next);
    toast({ title: "Flavors copied", description: `Copied ${sourceFlavors.length} flavors to all sizes.` });
  };

  const filePreview = imageFile ? URL.createObjectURL(imageFile) : null;
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  const displayImageSrc = filePreview ?? resolveMediaUrl(form.image_url) ?? undefined;

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast({ variant: "destructive", title: "Name required", description: "Please enter a name for the menu item." });
      return;
    }

    // Validate sizes & flavors if sizes are used
    if (sizes.length > 0) {
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i];
        if (!s.name || !s.name.trim()) {
          toast({
            variant: "destructive",
            title: "Size name required",
            description: `Size #${i + 1} has an empty name. Please enter a name (e.g. Small, Medium) or remove the card.`,
          });
          return;
        }
        if (Number(s.price) < 0) {
          toast({
            variant: "destructive",
            title: "Invalid price",
            description: `Price for size "${s.name}" cannot be negative.`,
          });
          return;
        }
        for (let j = 0; j < s.flavors.length; j++) {
          const f = s.flavors[j];
          if (!f.name || !f.name.trim()) {
            toast({
              variant: "destructive",
              title: "Flavor name required",
              description: `Size "${s.name}" has an empty flavor at #${j + 1}. Please enter a name or remove it.`,
            });
            return;
          }
        }
      }

      const sizeNames = sizes.map((s) => (s.name || "").trim().toLowerCase());
      const dupSizes = sizeNames.filter((name, index) => sizeNames.indexOf(name) !== index);
      if (dupSizes.length > 0) {
        toast({
          variant: "destructive",
          title: "Duplicate size",
          description: `Size name "${dupSizes[0]}" appears more than once. Each size must have a unique name.`,
        });
        return;
      }
    } else if (standaloneFlavors.length > 0) {
      for (let i = 0; i < standaloneFlavors.length; i++) {
        const f = standaloneFlavors[i];
        if (!f.name || !f.name.trim()) {
          toast({
            variant: "destructive",
            title: "Flavor name required",
            description: `Variation #${i + 1} has an empty name. Please enter a name or remove the row.`,
          });
          return;
        }
      }
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
        const res = await fetch(`${getApiBase()}/api/uploads/menu-item-image`, {
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

      const cleanedVariants: Partial<MenuItemVariant>[] = [];

      sizes.forEach((s, sIdx) => {
        cleanedVariants.push({
          id: s.id,
          name: s.name.trim(),
          measurement: s.measurement?.trim() || null,
          price: priceDraftToNumber(s.price),
          sort_order: sIdx,
          is_active: s.is_active ?? true,
          variant_type: "size" as const,
          parent_id: null,
        });

        s.flavors.forEach((f, fIdx) => {
          if (!f.name?.trim()) return;
          cleanedVariants.push({
            id: f.id,
            name: f.name.trim(),
            measurement: null,
            price: 0,
            sort_order: fIdx,
            is_active: f.is_active ?? true,
            variant_type: "flavor" as const,
            parent_id: s.id,
          });
        });
      });

      if (sizes.length === 0) {
        standaloneFlavors.forEach((f, fIdx) => {
          if (!f.name?.trim()) return;
          cleanedVariants.push({
            id: f.id,
            name: f.name.trim(),
            measurement: null,
            price: 0,
            sort_order: fIdx,
            is_active: f.is_active ?? true,
            variant_type: "flavor" as const,
            parent_id: null,
          });
        });
      }

      // If sizes exist, set base price to the first active size's price for consistent display
      const firstActiveSize = sizes.find((s) => s.is_active) || sizes[0];
      const basePrice =
        sizes.length > 0 && firstActiveSize
          ? priceDraftToNumber(firstActiveSize.price)
          : priceDraftToNumber(form.price);

      const payload: any = {
        ...form,
        price: basePrice,
        image_url,
        addon_ids: selectedAddonIds,
        variants: cleanedVariants,
      };
      if (isSuperAdmin) payload.restaurant_id = selectedRestaurantId;
      await onSubmit(payload);
    } finally {
      setUploading(false);
    }
  };

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initial ? t("menu:editItem", "Edit item") : t("menu:addItem", "New item")}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground pt-1">
          Fill in the details below, configure sizes, flavors, and add-ons, then save to update the menu.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {/* Basic Information */}
        <div className="form-field">
          <Label>{t("menu:itemName", "Item Name")} *</Label>
          <Input
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Crown Crust Supreme Pizza"
          />
        </div>
        <div className="form-field">
          <Label>{t("menu:category", "Category")} *</Label>
          <Select value={form.category_id || ""} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger><SelectValue placeholder={t("menu:selectCategory", "Select category")} /></SelectTrigger>
            <SelectContent>{filteredCategories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="form-row">
          {isSuperAdmin && (
            <div className="form-field">
              <Label>{t("menu:restaurant", "Restaurant")}</Label>
              <Select value={selectedRestaurantId} onValueChange={setSelectedRestaurantId}>
                <SelectTrigger><SelectValue placeholder={t("menu:selectRestaurant", "Select restaurant")} /></SelectTrigger>
                <SelectContent>
                  {restaurantPickerOptions.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="form-field">
            <Label>{t("menu:subCategory", "Sub-category")}</Label>
            <Select
              value={form.sub_category_id || "none"}
              onValueChange={(v) => setForm({ ...form, sub_category_id: v === "none" ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder={t("menu:selectSubCategory", "Select sub-category")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common:none", "None")}</SelectItem>
                {filteredSubCategories.map((sc) => (
                  <SelectItem key={sc.id} value={String(sc.id)}>{sc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="form-field">
          <Label>{t("menu:itemDescription", "Description")}</Label>
          <Textarea
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Delicious crown crust pizza loaded with cheese, fresh toppings and flavorful sauce..."
          />
        </div>

        {/* Pricing & Prep */}
        <div className="form-row">
          <div className="form-field">
            <Label>
              {sizes.length > 0 ? "Base Reference Price" : t("menu:price", "Price")} ({formatCurrency(0).charAt(0)})
            </Label>
            <Input
              type="text"
              inputMode="decimal"
              value={
                sizes.length > 0
                  ? String(sizes.find((s) => s.is_active)?.price ?? form.price ?? "")
                  : form.price === undefined || form.price === null
                    ? ""
                    : String(form.price)
              }
              disabled={sizes.length > 0}
              onChange={(e) => {
                if (sizes.length > 0) return;
                const next = sanitizePriceDraft(e.target.value);
                if (next === null) return;
                // Store draft string while typing; convert to number on save
                setForm((prev) => ({ ...prev, price: next as unknown as number }));
              }}
            />
            {sizes.length > 0 ? (
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1">
                Edit each size price in the Sizes section below — those are the prices the phone agent quotes.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1">
                This price is what the phone agent will speak for this item.
              </p>
            )}
          </div>
          <div className="form-field">
            <Label>{t("menu:preparationTime", "Prep time (min)")}</Label>
            <Input
              type="number"
              min={0}
              value={form.prep_time_minutes || 15}
              onChange={(e) => setForm({ ...form, prep_time_minutes: parseInt(e.target.value) || 15 })}
            />
          </div>
        </div>

        {/* Image Upload */}
        <div className="form-field">
          <Label>{t("menu:image", "Item image")}</Label>
          {displayImageSrc && (
            <img src={displayImageSrc} alt="" className="w-full max-h-40 object-cover rounded-lg border border-zinc-200" />
          )}
          <Input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="cursor-pointer"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
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
              Remove image
            </Button>
          )}
          <p className="text-xs text-muted-foreground">JPEG, PNG, GIF, or WebP — up to 5MB.</p>
        </div>

        {/* ========================================================================= */}
        {/* ================= 🍕 Pizza Sizes & Flavors Section ====================== */}
        {/* ========================================================================= */}
        <div className="space-y-3.5 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Boxes className="h-4 w-4 text-blue-500" />
                🍕 {t("menu:pizzaSizesTitle", "Pizza Sizes & Variations")}
                {sizes.length > 0 && (
                  <Badge variant="secondary" className="text-xs px-2 py-0.5 ml-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    {sizes.length} {sizes.length === 1 ? "size" : "sizes"}
                  </Badge>
                )}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("menu:pizzaSizesDesc", "Add different sizes, measurements, prices, and specific flavors for each size.")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={applyStandardPizzaSizes}
              >
                🍕 + Standard Pizza Sizes
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                onClick={addSizeCard}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("menu:addSize", "Add Size")}
              </Button>
            </div>
          </div>

          {/* Sizes Cards List */}
          {sizes.length > 0 ? (
            <div className="space-y-3">
              {sizes.map((s, sIdx) => (
                <div
                  key={s.id || sIdx}
                  className="rounded-xl border border-blue-500/30 bg-blue-500/[0.02] dark:bg-blue-950/10 p-4 space-y-3.5 shadow-2xs"
                >
                  {/* Size Card Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                        #{sIdx + 1}
                      </span>
                      <span className="font-bold text-sm text-foreground">
                        {s.name ? `${s.name}${s.measurement ? ` (${s.measurement})` : ""}` : `Size #${sIdx + 1}`}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        — {formatCurrency(s.price || 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        disabled={sIdx === 0}
                        onClick={() => moveSize(sIdx, -1)}
                        title="Move Up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        disabled={sIdx === sizes.length - 1}
                        onClick={() => moveSize(sIdx, 1)}
                        title="Move Down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive/80 hover:text-destructive hover:bg-destructive/10 ml-1"
                        onClick={() => removeSize(sIdx)}
                        title="Delete Size"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Size Fields: Name, Measurement, Price, Availability */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-4">
                      <Label className="text-xs font-semibold">{t("menu:sizeName", "Size Name")} *</Label>
                      <Input
                        placeholder="e.g. Small, Medium, Large, Family"
                        value={s.name}
                        className="h-8.5 text-sm mt-1"
                        onChange={(e) => updateSize(sIdx, "name", e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Label className="text-xs font-semibold">{t("menu:measurement", "Measurement")}</Label>
                      <Input
                        placeholder='e.g. 9", 12", 14", 18"'
                        value={s.measurement}
                        className="h-8.5 text-sm mt-1"
                        onChange={(e) => updateSize(sIdx, "measurement", e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Label className="text-xs font-semibold">{t("menu:price", "Price")} *</Label>
                      <div className="relative mt-1">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="8.00"
                          value={s.price === undefined || s.price === null ? "" : String(s.price)}
                          className="h-8.5 text-sm pl-6"
                          onChange={(e) => {
                            const next = sanitizePriceDraft(e.target.value);
                            if (next === null) return;
                            updateSize(sIdx, "price", next);
                          }}
                        />
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">
                          {formatCurrency(0).charAt(0)}
                        </span>
                      </div>
                    </div>
                    <div className="sm:col-span-2 flex items-center gap-2 pb-1">
                      <Switch
                        checked={s.is_active}
                        onCheckedChange={(val) => updateSize(sIdx, "is_active", val)}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {s.is_active ? t("common:active", "Active") : t("common:inactive", "Off")}
                      </span>
                    </div>
                  </div>

                  {/* Nested Flavors for this Size */}
                  <div className="rounded-lg border border-border/80 bg-background p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-bold text-foreground">
                          Flavors for {s.name || `Size #${sIdx + 1}`}
                        </span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {s.flavors.length} {s.flavors.length === 1 ? "flavor" : "flavors"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sizes.length > 1 && sIdx > 0 && sizes[0].flavors.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              const source = sizes[0].flavors;
                              updateSize(sIdx, "flavors", source.map((f) => ({ id: crypto.randomUUID(), name: f.name, is_active: f.is_active })));
                            }}
                          >
                            Copy from #{1}
                          </Button>
                        )}
                        {sizes.length > 1 && s.flavors.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => copyFlavorsToAllSizes(sIdx)}
                          >
                            Copy to all sizes
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-[11px] h-6 px-2"
                          onClick={() => addFlavorToSize(sIdx)}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          {t("menu:addFlavorToSize", "Add Flavor")}
                        </Button>
                      </div>
                    </div>

                    {s.flavors.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {s.flavors.map((flv, fIdx) => (
                          <div
                            key={flv.id || fIdx}
                            className="flex items-center gap-1.5 p-1.5 rounded-md border border-border/70 bg-muted/20 hover:border-primary/40 transition-colors"
                          >
                            <span className="text-[11px] font-semibold text-muted-foreground w-4 text-center">
                              {fIdx + 1}.
                            </span>
                            <Input
                              placeholder="e.g. Chicken Fajita, Tikka..."
                              value={flv.name}
                              className="h-7 text-xs flex-1"
                              onChange={(e) => updateFlavorInSize(sIdx, fIdx, "name", e.target.value)}
                            />
                            <Switch
                              checked={flv.is_active}
                              onCheckedChange={(val) => updateFlavorInSize(sIdx, fIdx, "is_active", val)}
                              className="scale-75"
                              title={flv.is_active ? "Active" : "Inactive"}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0"
                              onClick={() => removeFlavorFromSize(sIdx, fIdx)}
                              title="Remove flavor"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic py-1 text-center">
                        No flavors defined for this size. Click &apos;+ Add Flavor&apos; to add options like Chicken Fajita, Tikka, BBQ Chicken etc.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-border bg-muted/10 text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                No pizza sizes configured for this item. Click below to add sizes or configure standalone variations.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={applyStandardPizzaSizes}
                >
                  🍕 + Add Pizza Sizes (Small, Medium, Large, Family)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => {
                    setStandaloneFlavors([
                      { id: crypto.randomUUID(), name: "Single Patty", is_active: true },
                      { id: crypto.randomUUID(), name: "Double Beef", is_active: true },
                      { id: crypto.randomUUID(), name: "Crispy Chicken", is_active: true },
                    ]);
                  }}
                >
                  🍔 + Burger Variations
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Standalone Variations Section (Only shown when no sizes are configured) */}
        {sizes.length === 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Standalone Variations / Flavors (Optional)
                  {standaloneFlavors.length > 0 && (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 ml-1">
                      {standaloneFlavors.length}
                    </Badge>
                  )}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  For items like Burgers, Platters, or Drinks that don&apos;t use pizza sizes.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() =>
                  setStandaloneFlavors([
                    ...standaloneFlavors,
                    { id: crypto.randomUUID(), name: "", is_active: true },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Variation
              </Button>
            </div>

            {standaloneFlavors.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg border border-border/80 bg-muted/10">
                {standaloneFlavors.map((flv, idx) => (
                  <div
                    key={flv.id || idx}
                    className="flex items-center gap-1.5 p-1.5 rounded-md border bg-background"
                  >
                    <span className="text-xs font-semibold text-muted-foreground w-4 text-center">{idx + 1}.</span>
                    <Input
                      placeholder="e.g. Single Patty, Crispy..."
                      value={flv.name}
                      className="h-7 text-xs flex-1"
                      onChange={(e) => {
                        const next = [...standaloneFlavors];
                        next[idx] = { ...flv, name: e.target.value };
                        setStandaloneFlavors(next);
                      }}
                    />
                    <Switch
                      checked={flv.is_active}
                      onCheckedChange={(val) => {
                        const next = [...standaloneFlavors];
                        next[idx] = { ...flv, is_active: val };
                        setStandaloneFlavors(next);
                      }}
                      className="scale-75"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setStandaloneFlavors(standaloneFlavors.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dietary Information */}
        <div className="form-field border-t border-border pt-3">
          <Label>Dietary tags (comma separated)</Label>
          <Input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              setForm({
                ...form,
                dietary_tags: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
            }}
            placeholder="Halal, High Protein, Gluten-Free"
          />
        </div>
        <div className="form-field">
          <Label>Spice level (0-5)</Label>
          <Input
            type="number"
            min={0}
            max={5}
            value={form.spice_level || 0}
            onChange={(e) => setForm({ ...form, spice_level: parseInt(e.target.value) || 0 })}
          />
        </div>

        {/* Linked Addons Section */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>{t("menu:tabAddOns", "Add-ons / Extras")}</Label>
          <p className="text-xs text-muted-foreground">
            {addons.length === 0
              ? "Create add-ons for this restaurant under Menu → Add-ons, then link them here."
              : "Optional extras for this item (e.g. Extra Cheese, Extra Chicken, Jalapeños, Sauces)."}
          </p>
          {addons.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto rounded-lg border border-border p-2 bg-muted/10">
              {filteredAddons.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    "flex items-center gap-2 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-background transition-colors",
                    !a.is_active && "opacity-70",
                  )}
                >
                  <Checkbox
                    checked={selectedAddonIds.includes(a.id)}
                    onCheckedChange={() => toggleAddon(a.id)}
                  />
                  <span className="flex-1 font-medium">{a.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums font-semibold">
                    +{formatCurrency(a.price)}
                  </span>
                  {!a.is_active && <Badge variant="secondary" className="text-[10px] px-1 py-0">Inactive</Badge>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Item Level Availability */}
        <div className="setting-row border-t border-border pt-4">
          <div className="space-y-0.5">
            <Label className="font-semibold">{t("menu:available", "Item Available")}</Label>
            <p className="text-xs text-muted-foreground">Show this item on the menu and allow ordering</p>
          </div>
          <Switch
            checked={form.is_available ?? true}
            onCheckedChange={(v) => setForm({ ...form, is_available: v })}
          />
        </div>
      </DialogBody>
      <DialogFooter className="border-t pt-3">
        <Button onClick={() => void handleSave()} disabled={uploading || isSaving}>
          {(uploading || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {uploading || isSaving ? "Saving…" : "Save Item"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}