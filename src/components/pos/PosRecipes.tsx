import { useState, useMemo } from "react";
import {
  ChefHat,
  Search,
  Sparkles,
  UtensilsCrossed,
  CheckCircle2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/i18n/formatters";

export interface RecipeItem {
  menu_item_id: string;
  menu_item_name: string;
  selling_price: number;
  image_url?: string | null;
  has_recipe: boolean;
  recipe_id?: string | null;
  recipe_name?: string | null;
  recipe_description?: string | null;
  ingredients: Array<{
    id: string;
    inventory_item_id: string;
    raw_material_name: string;
    quantity: number;
    unit: string;
    unit_cost: number;
    total_cost: number;
  }>;
  total_food_cost: number;
  profit_margin: number;
}

interface Props {
  recipes: RecipeItem[];
  onOpenRecipeDialog: (recipe: RecipeItem) => void;
  onOpenNewRecipe?: () => void;
}

export function PosRecipes({ recipes, onOpenRecipeDialog, onOpenNewRecipe }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "configured" | "missing">("all");

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const matchSearch =
        !search.trim() || r.menu_item_name.toLowerCase().includes(search.toLowerCase());
      const matchConfig =
        filter === "all" ||
        (filter === "configured" && r.has_recipe) ||
        (filter === "missing" && !r.has_recipe);
      return matchSearch && matchConfig;
    });
  }, [recipes, search, filter]);

  const configuredCount = recipes.filter((r) => r.has_recipe).length;

  return (
    <div className="space-y-4">
      {/* ── Top Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-primary" />
            Recipe Mapping & Food Costing
          </h3>
          <p className="text-xs text-muted-foreground">
            Map menu items to raw materials so inventory automatically deducts whenever orders are sold.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
            {configuredCount} of {recipes.length} dishes mapped
          </Badge>
          {onOpenNewRecipe && (
            <Button
              type="button"
              size="sm"
              onClick={onOpenNewRecipe}
              className="h-8 gap-1.5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              + Add / Map Recipe
            </Button>
          )}
        </div>
      </div>

      {/* ── Filters & Search ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search dish name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs bg-card"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              filter === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            All Dishes ({recipes.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("configured")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              filter === "configured" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold" : "text-muted-foreground"
            }`}
          >
            ✓ Mapped ({configuredCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("missing")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              filter === "missing" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold" : "text-muted-foreground"
            }`}
          >
            Unmapped ({recipes.length - configuredCount})
          </button>
        </div>
      </div>

      {/* ── Recipes Grid ── */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <ChefHat className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <h4 className="text-sm font-semibold">No dishes found</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {search ? `No items matching "${search}"` : "Add menu items in your restaurant menu first."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((r) => {
            return (
              <Card
                key={r.menu_item_id}
                onClick={() => onOpenRecipeDialog(r)}
                className={`border bg-card overflow-hidden flex flex-col justify-between cursor-pointer transition-all hover:shadow-md ${
                  r.has_recipe ? "border-border/80 hover:border-primary/50" : "border-amber-500/40 hover:border-amber-500/70 bg-amber-500/[0.02]"
                }`}
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm overflow-hidden flex-shrink-0">
                        {r.image_url ? (
                          <img src={r.image_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-foreground line-clamp-1">
                          {r.menu_item_name}
                        </h4>
                        <p className="text-xs font-semibold text-foreground">
                          Selling Price: {formatCurrency(r.selling_price)}
                        </p>
                      </div>
                    </div>

                    {r.has_recipe ? (
                      <Badge variant="secondary" className="h-5 text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        ✓ Mapped
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 text-[10px] font-bold text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10">
                        + Needs Recipe
                      </Badge>
                    )}
                  </div>

                  {/* Financial Metrics */}
                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-muted/20 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Food Cost:</span>
                      <div className="font-extrabold text-foreground">
                        {r.has_recipe ? formatCurrency(r.total_food_cost) : "—"}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Gross Margin:</span>
                      <div className={`font-extrabold ${r.profit_margin >= 60 ? "text-emerald-500" : "text-amber-500"}`}>
                        {r.has_recipe ? `${r.profit_margin}%` : "—"}
                      </div>
                    </div>
                  </div>

                  {/* Ingredients preview */}
                  {r.has_recipe && r.ingredients.length > 0 ? (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Ingredients ({r.ingredients.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {r.ingredients.map((ing) => (
                          <span
                            key={ing.id}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-muted/50 border border-border text-foreground"
                          >
                            {ing.quantity} {ing.unit} {ing.raw_material_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90 font-medium italic">
                      Click here to map recipe ingredients. Sales will not deduct inventory until mapped.
                    </p>
                  )}
                </div>

                <div className="p-3 border-t border-border bg-muted/10 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {r.has_recipe ? "✓ Auto-deduction active" : "⚠ Not deducting"}
                  </span>
                  <Button
                    type="button"
                    variant={r.has_recipe ? "outline" : "default"}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRecipeDialog(r);
                    }}
                    className={`h-8 text-xs font-bold gap-1.5 ${
                      !r.has_recipe ? "bg-amber-600 hover:bg-amber-700 text-white shadow-xs" : ""
                    }`}
                  >
                    <ChefHat className="h-3.5 w-3.5" />
                    {r.has_recipe ? "Edit Recipe" : "+ Map Recipe"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
