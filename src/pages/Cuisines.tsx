import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus, Save, Search, Store, Check, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

type Cuisine = { id: string; name: string };
type RestaurantCuisine = { id?: string; restaurant_id: string; cuisine_id: string };

export default function Cuisines() {
  const { t } = useTranslation(["cuisines", "common"]);
  const { role } = useAuth();
  const { restaurantId } = useActiveRestaurant();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [newCuisine, setNewCuisine] = useState("");
  const [savingCuisine, setSavingCuisine] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // 1. Fetch all cuisines
  const {
    data: cuisines = [],
    isLoading: cuisinesLoading,
    refetch: refetchCuisines,
  } = useQuery({
    queryKey: ["cuisines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cuisines")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data as Cuisine[]) ?? [];
    },
  });

  // 2. Fetch restaurant name
  const { data: currentRestaurant } = useQuery({
    queryKey: ["current-restaurant", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("id", restaurantId)
        .maybeSingle();
      return (data as { id: string; name: string } | null) ?? null;
    },
    enabled: Boolean(restaurantId),
  });

  // 3. Fetch linked cuisines for THIS active restaurant only
  const {
    data: activeLinks = [],
    isLoading: linksLoading,
    refetch: refetchLinks,
  } = useQuery({
    queryKey: ["restaurant-cuisines", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("restaurant_cuisines")
        .select("restaurant_id, cuisine_id")
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
      return (data as RestaurantCuisine[]) ?? [];
    },
    enabled: Boolean(restaurantId),
  });

  const linkedCuisineIds = useMemo(() => {
    return new Set(activeLinks.map((l) => l.cuisine_id));
  }, [activeLinks]);

  const filteredCuisines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cuisines;
    return cuisines.filter((c) => c.name.toLowerCase().includes(q));
  }, [cuisines, search]);

  const toggleCuisineForRestaurant = async (cuisineId: string, currentlyLinked: boolean) => {
    if (!restaurantId) {
      toast({
        variant: "destructive",
        title: "No Active Restaurant",
        description: "Please make sure a restaurant is selected.",
      });
      return;
    }

    setTogglingId(cuisineId);
    try {
      if (currentlyLinked) {
        // Unlink from this restaurant
        const { error } = await supabase
          .from("restaurant_cuisines")
          .delete()
          .eq("restaurant_id", restaurantId)
          .eq("cuisine_id", cuisineId);
        if (error) throw error;
        toast({ title: "Cuisine removed from your restaurant" });
      } else {
        // Link to this restaurant
        const { error } = await supabase
          .from("restaurant_cuisines")
          .insert({
            restaurant_id: restaurantId,
            cuisine_id: cuisineId,
          });
        if (error) throw error;
        toast({ title: "Cuisine linked to your restaurant" });
      }
      await refetchLinks();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: t("common:error", "Failed to update cuisine"),
        description: e?.message ?? String(e),
      });
    } finally {
      setTogglingId(null);
    }
  };

  async function addCuisine() {
    const name = newCuisine.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!restaurantId) {
      toast({ variant: "destructive", title: "No active restaurant" });
      return;
    }

    setSavingCuisine(true);
    try {
      // 1. Insert into cuisines
      const { data: newCuisineData, error } = await supabase
        .from("cuisines")
        .upsert({ name }, { onConflict: "name" })
        .select("id, name")
        .maybeSingle();

      if (error) throw error;

      // 2. Automatically link to this active restaurant
      const cId = (newCuisineData as any)?.id;
      if (cId && restaurantId) {
        await supabase
          .from("restaurant_cuisines")
          .upsert({ restaurant_id: restaurantId, cuisine_id: cId });
      }

      setNewCuisine("");
      await Promise.all([refetchCuisines(), refetchLinks()]);
      toast({ title: `✅ Added cuisine "${name}" to your restaurant!` });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: t("common:error", "Could not save cuisine"),
        description: e?.message ?? String(e),
      });
    } finally {
      setSavingCuisine(false);
    }
  }

  const isLoading = cuisinesLoading || linksLoading;

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        icon={<Layers className="h-5 w-5" />}
        title={t("cuisines:title", "Cuisines")}
        description={t(
          "cuisines:subtitle",
          "Manage cuisine types and food categories for your restaurant.",
        )}
        actions={
          currentRestaurant ? (
            <div className="flex w-full items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs sm:w-auto">
              <Store className="h-4 w-4 text-primary" />
              <span className="truncate">{currentRestaurant.name}</span>
            </div>
          ) : undefined
        }
      />

      {/* Add Cuisine Card */}
      <Card className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-bold">
            {t("cuisines:addCuisine", "Add New Cuisine")}
          </CardTitle>
          <CardDescription className="text-xs">
            Create a cuisine (e.g. Italian, Fast Food, Chinese, Desi) and attach it to your restaurant menu.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addCuisine();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <Input
              value={newCuisine}
              onChange={(e) => setNewCuisine(e.target.value)}
              placeholder="e.g. Fast Food, Italian, BBQ, Dessert..."
              className="rounded-xl text-xs flex-1"
            />
            <Button
              type="submit"
              disabled={savingCuisine || !newCuisine.trim()}
              className="gradient-primary text-primary-foreground font-semibold rounded-xl gap-2 min-w-[130px]"
            >
              {savingCuisine ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {savingCuisine ? t("common:saving", "Saving...") : t("common:add", "Add Cuisine")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Cuisines Table Card */}
      <Card className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-bold">
              {t("cuisines:allCuisines", "Restaurant Cuisines")} ({filteredCuisines.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Toggle cuisines to enable or disable them for your active restaurant.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 rounded-xl text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cuisines:searchCuisinesPlaceholder", "Search cuisines...")}
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>Loading cuisines...</span>
            </div>
          ) : filteredCuisines.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground space-y-2">
              <Layers className="h-10 w-10 mx-auto text-muted-foreground/30" />
              <p className="font-semibold text-sm">No cuisines found.</p>
              <p className="text-xs">Add a new cuisine using the form above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                    <TableHead className="py-3.5 px-6 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                      Cuisine Name
                    </TableHead>
                    <TableHead className="py-3.5 px-4 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                      Status for This Restaurant
                    </TableHead>
                    <TableHead className="py-3.5 px-6 text-right font-bold text-xs uppercase tracking-wider text-muted-foreground">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/40">
                  {filteredCuisines.map((c) => {
                    const isLinked = linkedCuisineIds.has(c.id);
                    const isBusy = togglingId === c.id;

                    return (
                      <TableRow key={c.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="py-4 px-6 font-bold text-xs text-foreground">
                          {c.name}
                        </TableCell>

                        <TableCell className="py-4 px-4">
                          {isLinked ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 text-[11px]">
                              <Check className="h-3 w-3" /> Active in Restaurant
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[11px]">
                              Not Linked
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="py-4 px-6 text-right">
                          <Button
                            variant={isLinked ? "outline" : "default"}
                            size="sm"
                            disabled={isBusy}
                            onClick={() => toggleCuisineForRestaurant(c.id, isLinked)}
                            className={cn(
                              "h-8 text-xs font-semibold rounded-xl",
                              !isLinked && "gradient-primary text-primary-foreground"
                            )}
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : null}
                            {isLinked ? "Remove from Restaurant" : "Add to Restaurant"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
