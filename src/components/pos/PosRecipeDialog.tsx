import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChefHat, Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { formatCurrency } from "@/i18n/formatters";

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  current_stock: number;
}

interface RecipeIngredient {
  inventory_item_id: string;
  quantity: number;
  unit: string;
}

interface MenuItemRecipe {
  menu_item_id: string;
  menu_item_name: string;
  selling_price: number;
  recipe_name?: string | null;
  recipe_description?: string | null;
  ingredients?: Array<{
    inventory_item_id: string;
    quantity: number;
    unit: string;
  }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  recipe: MenuItemRecipe | null;
  allRecipes?: MenuItemRecipe[];
  rawMaterials: RawMaterial[];
  onSaved: () => void;
}

export function PosRecipeDialog({
  open,
  onOpenChange,
  restaurantId,
  recipe,
  allRecipes = [],
  rawMaterials,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [selectedDishId, setSelectedDishId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const effectiveRecipe = recipe || allRecipes.find((r) => r.menu_item_id === selectedDishId) || null;

  useEffect(() => {
    if (recipe) {
      setSelectedDishId(recipe.menu_item_id);
      setName(recipe.recipe_name || `${recipe.menu_item_name} Recipe`);
      setDescription(recipe.recipe_description || "");
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        setIngredients(
          recipe.ingredients.map((ing) => ({
            inventory_item_id: ing.inventory_item_id,
            quantity: Number(ing.quantity) || 0,
            unit: ing.unit,
          }))
        );
      } else {
        setIngredients([{ inventory_item_id: "", quantity: 1, unit: "pcs" }]);
      }
    } else if (open) {
      setSelectedDishId("");
      setName("");
      setDescription("");
      setIngredients([{ inventory_item_id: "", quantity: 1, unit: "pcs" }]);
    }
  }, [recipe, open]);

  const handleSelectDish = (dishId: string) => {
    setSelectedDishId(dishId);
    const chosen = allRecipes.find((r) => r.menu_item_id === dishId);
    if (chosen) {
      setName(chosen.recipe_name || `${chosen.menu_item_name} Recipe`);
      setDescription(chosen.recipe_description || "");
      if (chosen.ingredients && chosen.ingredients.length > 0) {
        setIngredients(
          chosen.ingredients.map((ing) => ({
            inventory_item_id: ing.inventory_item_id,
            quantity: Number(ing.quantity) || 0,
            unit: ing.unit,
          }))
        );
      } else {
        setIngredients([{ inventory_item_id: "", quantity: 1, unit: "pcs" }]);
      }
    }
  };

  const addIngredient = () => {
    setIngredients([...ingredients, { inventory_item_id: "", quantity: 1, unit: "pcs" }]);
  };

  const removeIngredient = (idx: number) => {
    if (ingredients.length === 1) {
      setIngredients([{ inventory_item_id: "", quantity: 1, unit: "pcs" }]);
      return;
    }
    setIngredients(ingredients.filter((_, i) => i !== idx));
  };

  const updateIngredient = (idx: number, patch: Partial<RecipeIngredient>) => {
    setIngredients((prev) =>
      prev.map((ing, i) => {
        if (i !== idx) return ing;
        const updated = { ...ing, ...patch };
        if (patch.inventory_item_id) {
          const mat = rawMaterials.find((m) => m.id === patch.inventory_item_id);
          if (mat) {
            updated.unit = mat.unit;
          }
        }
        return updated;
      })
    );
  };

  // Compute total food cost
  const totalFoodCost = ingredients.reduce((sum, ing) => {
    const mat = rawMaterials.find((m) => m.id === ing.inventory_item_id);
    const cost = Number(mat?.cost_price || 0);
    const qty = Number(ing.quantity || 0);
    return sum + cost * qty;
  }, 0);

  const sellingPrice = Number(effectiveRecipe?.selling_price || 0);
  const profitMargin = sellingPrice > 0 ? Math.round(((sellingPrice - totalFoodCost) / sellingPrice) * 100) : 0;

  const handleSubmit = async () => {
    if (!effectiveRecipe) {
      toast({
        variant: "destructive",
        title: "Dish Selection Required",
        description: "Please select a menu dish to map ingredients.",
      });
      return;
    }

    const validIngredients = ingredients.filter(
      (ing) => ing.inventory_item_id && Number(ing.quantity) > 0
    );

    if (validIngredients.length === 0) {
      toast({
        variant: "destructive",
        title: "Ingredients Required",
        description: "Add at least one ingredient to this recipe.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/recipes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          menu_item_id: effectiveRecipe.menu_item_id,
          name: name.trim() || `${effectiveRecipe.menu_item_name} Recipe`,
          description: description.trim() || null,
          ingredients: validIngredients,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save recipe");

      toast({
        title: "✅ Recipe Configured",
        description: `Recipe saved for "${effectiveRecipe.menu_item_name}". Raw materials will now auto-deduct when sold!`,
      });

      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save recipe";
      toast({
        variant: "destructive",
        title: "Error",
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <ChefHat className="h-5 w-5 text-primary" />
            {effectiveRecipe ? `Recipe Mapping: ${effectiveRecipe.menu_item_name}` : "Configure Dish Recipe"}
          </DialogTitle>
          {effectiveRecipe && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
              <span>Selling Price: <strong className="text-foreground">{formatCurrency(sellingPrice)}</strong></span>
              <span>·</span>
              <span>Food Cost: <strong className="text-foreground">{formatCurrency(totalFoodCost)}</strong></span>
              <span>·</span>
              <span className={profitMargin >= 60 ? "text-emerald-500 font-bold" : "text-amber-500 font-bold"}>
                Margin: {profitMargin}%
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!recipe && (
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/30 border border-border">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <ChefHat className="h-3.5 w-3.5 text-primary" />
                Select Dish from Menu *
              </Label>
              <Select value={selectedDishId} onValueChange={handleSelectDish}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Choose a dish to map ingredients..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {allRecipes.map((r) => (
                    <SelectItem key={r.menu_item_id} value={r.menu_item_id}>
                      {r.menu_item_name} ({formatCurrency(r.selling_price)}) {r.has_recipe ? "✓ Already Mapped" : "• Not Mapped"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Recipe Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Notes / Prep Instructions</Label>
              <Input
                placeholder="e.g. Grill patty for 4 mins, toast bun"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ingredients per 1 Single Portion
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Exact raw material deducted when 1 portion is ordered
              </span>
            </div>

            <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-card">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                <div className="col-span-6">Raw Material</div>
                <div className="col-span-3 text-center">Portion Quantity</div>
                <div className="col-span-2 text-right">Approx Cost</div>
                <div className="col-span-1 text-center"></div>
              </div>

              {ingredients.map((ing, idx) => {
                const mat = rawMaterials.find((m) => m.id === ing.inventory_item_id);
                const cost = Number(mat?.cost_price || 0) * (Number(ing.quantity) || 0);

                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center text-xs">
                    <div className="col-span-6">
                      <Select
                        value={ing.inventory_item_id}
                        onValueChange={(val) => updateIngredient(idx, { inventory_item_id: val })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select raw material..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {rawMaterials.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name} ({m.unit}) · {formatCurrency(m.cost_price)}/{m.unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-3 flex items-center gap-1.5">
                      <Input
                        type="number"
                        step="any"
                        min="0.001"
                        value={ing.quantity}
                        onChange={(e) => updateIngredient(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs text-center"
                      />
                      <span className="text-[11px] font-semibold text-muted-foreground w-12 truncate">
                        {mat?.unit || ing.unit}
                      </span>
                    </div>

                    <div className="col-span-2 text-right font-medium text-foreground">
                      {formatCurrency(cost)}
                    </div>

                    <div className="col-span-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeIngredient(idx)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="p-2.5 bg-muted/10 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addIngredient}
                  className="h-7 text-xs gap-1 border-dashed"
                >
                  <Plus className="h-3 w-3" /> Add Ingredient
                </Button>

                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Food Cost: </span>
                    <strong className="text-foreground">{formatCurrency(totalFoodCost)}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Gross Profit: </span>
                    <strong className="text-emerald-500 font-bold">
                      {formatCurrency(Math.max(0, sellingPrice - totalFoodCost))} ({profitMargin}%)
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="h-8 text-xs font-semibold gradient-primary"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Save Recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
