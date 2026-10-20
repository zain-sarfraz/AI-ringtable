import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  ShoppingCart,
  Boxes,
  History,
  TrendingUp,
  ChefHat,
  Sparkles,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { supabase } from "@/integrations/supabase/client";

// POS Modular Components
import { PosTerminal } from "@/components/pos/PosTerminal";
import { PosOverview } from "@/components/pos/PosOverview";
import { PosPurchases } from "@/components/pos/PosPurchases";
import { PosRawMaterials, RawMaterialItem } from "@/components/pos/PosRawMaterials";
import { PosUsageTraceability } from "@/components/pos/PosUsageTraceability";
import { PosRecipes, RecipeItem } from "@/components/pos/PosRecipes";

// Dialogs
import { PosNewPurchaseDialog } from "@/components/pos/PosNewPurchaseDialog";
import { PosRawMaterialDialog } from "@/components/pos/PosRawMaterialDialog";
import { PosStockAdjustDialog } from "@/components/pos/PosStockAdjustDialog";
import { PosSupplierDialog } from "@/components/pos/PosSupplierDialog";
import { PosRecipeDialog } from "@/components/pos/PosRecipeDialog";

export default function Pos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "terminal";
  const { restaurantId, activeRestaurant } = useActiveRestaurant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Period for Overview tab
  const [period, setPeriod] = useState<string>("all");

  // Selected material for Usage tab
  const [selectedUsageMaterialId, setSelectedUsageMaterialId] = useState<string>("all");

  // Dialog States
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const [showMaterialDialog, setShowMaterialDialog] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterialItem | null>(null);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [adjustingMaterial, setAdjustingMaterial] = useState<RawMaterialItem | null>(null);
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<RecipeItem | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Tab switcher
  const handleTabChange = (tab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  };

  // 1. Fetch POS Summary
  const {
    data: summaryData,
    isLoading: loadingSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["pos-summary", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return null;
      const res = await fetch(
        `${getApiBase()}/api/pos/summary?restaurant_id=${restaurantId}&period=${period}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 2. Fetch Raw Materials
  const {
    data: rawMaterialsData,
    isLoading: loadingRawMaterials,
    refetch: refetchRawMaterials,
  } = useQuery({
    queryKey: ["pos-raw-materials", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { raw_materials: [] };
      const res = await fetch(
        `${getApiBase()}/api/pos/raw-materials?restaurant_id=${restaurantId}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load raw materials");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 3. Fetch Suppliers
  const { data: suppliersData, refetch: refetchSuppliers } = useQuery({
    queryKey: ["pos-suppliers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { suppliers: [] };
      const res = await fetch(
        `${getApiBase()}/api/pos/suppliers?restaurant_id=${restaurantId}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 4. Fetch Purchases
  const {
    data: purchasesData,
    isLoading: loadingPurchases,
    refetch: refetchPurchases,
  } = useQuery({
    queryKey: ["pos-purchases", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { purchases: [] };
      const res = await fetch(
        `${getApiBase()}/api/pos/purchases?restaurant_id=${restaurantId}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load purchases");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 5. Fetch Recipes
  const {
    data: recipesData,
    isLoading: loadingRecipes,
    refetch: refetchRecipes,
  } = useQuery({
    queryKey: ["pos-recipes", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { recipes: [] };
      const res = await fetch(
        `${getApiBase()}/api/pos/recipes?restaurant_id=${restaurantId}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load recipes");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 6. Fetch Usage & Traceability
  const {
    data: usageData,
    isLoading: loadingUsage,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ["pos-usage", restaurantId, selectedUsageMaterialId],
    queryFn: async () => {
      if (!restaurantId) return { summary: {}, history: [] };
      const matParam =
        selectedUsageMaterialId && selectedUsageMaterialId !== "all"
          ? `&inventory_item_id=${selectedUsageMaterialId}`
          : "";
      const res = await fetch(
        `${getApiBase()}/api/pos/usage?restaurant_id=${restaurantId}${matParam}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error("Failed to load usage history");
      return res.json();
    },
    enabled: Boolean(restaurantId),
  });

  // 7. Fetch Menu Items & Categories for POS Register
  const { data: menuItems = [] } = useQuery({
    queryKey: ["pos-menu-items", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, name, price, image_url, category_id, is_available")
        .eq("restaurant_id", restaurantId)
        .eq("is_available", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    },
    enabled: Boolean(restaurantId),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["pos-categories", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("menu_categories")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    },
    enabled: Boolean(restaurantId),
  });

  // 8. Fetch Tables
  const { data: tables = [] } = useQuery({
    queryKey: ["pos-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("restaurant_tables")
        .select("id, table_number")
        .eq("restaurant_id", restaurantId)
        .order("table_number", { ascending: true });
      if (error) return [];
      return (data || []) as Array<Record<string, unknown>>;
    },
    enabled: Boolean(restaurantId),
  });

  // Refresh all queries helper
  const refetchAll = () => {
    refetchSummary();
    refetchRawMaterials();
    refetchPurchases();
    refetchRecipes();
    refetchUsage();
    refetchSuppliers();
    queryClient.invalidateQueries({ queryKey: ["inventory-report"] });
  };

  // Seed Demo Data helper
  const handleSeedDemoData = async () => {
    if (!restaurantId) return;
    setSeeding(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/seed-sample-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to seed demo data");

      toast({
        title: "⚡ Demo Data Generated!",
        description: "Sample raw materials, suppliers, recipes, and purchases are now ready for testing.",
      });
      refetchAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to seed demo data";
      toast({
        variant: "destructive",
        title: "Seed Failed",
        description: msg,
      });
    } finally {
      setSeeding(false);
    }
  };

  // Delete raw material
  const handleDeleteMaterial = async (id: string) => {
    if (!confirm("Are you sure you want to remove this raw material?")) return;
    try {
      const res = await fetch(
        `${getApiBase()}/api/pos/raw-materials/${id}?restaurant_id=${restaurantId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${getToken()}` },
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to delete item");

      toast({ title: "Deleted", description: body.message || "Raw material removed." });
      refetchRawMaterials();
      refetchSummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      toast({ variant: "destructive", title: "Error", description: msg });
    }
  };

  const rawMaterialsList = rawMaterialsData?.raw_materials || [];
  const suppliersList = suppliersData?.suppliers || [];
  const purchasesList = purchasesData?.purchases || [];
  const recipesList = recipesData?.recipes || [];
  const usageHistory = usageData?.history || [];
  const usageSummary = usageData?.summary || {
    total_purchased_qty: 0,
    total_used_qty: 0,
    total_adjusted_qty: 0,
  };

  const hasNoMaterialsYet = rawMaterialsList.length === 0;

  if (!restaurantId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
        <h3 className="text-base font-bold">No Restaurant Selected</h3>
        <p className="text-xs text-muted-foreground mt-1">Please select an active restaurant to manage POS & inventory.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12 animate-fade-in">
      {/* ── Page Header & Quick Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5">
              <Calculator className="h-7 w-7 text-primary" />
              Point of Sale (POS) & Inventory
            </h1>
            <Badge variant="outline" className="font-semibold text-xs px-2.5 py-0.5 border-primary/30 text-primary">
              {activeRestaurant?.name || "Restaurant"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time cashier terminal, sales vs purchasing comparison, raw materials stock, and ingredient consumption ("wo kaha use hua").
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasNoMaterialsYet && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSeedDemoData}
              disabled={seeding}
              className="h-9 text-xs font-semibold gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shadow-xs"
            >
              {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {seeding ? "Seeding..." : "⚡ Seed Demo POS Data"}
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingRecipe(null);
              setShowRecipeDialog(true);
            }}
            className="h-9 text-xs font-semibold gap-1.5"
          >
            <ChefHat className="h-3.5 w-3.5 text-primary" />
            + Add Recipe
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingMaterial(null);
              setShowMaterialDialog(true);
            }}
            className="h-9 text-xs font-semibold gap-1.5"
          >
            <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
            + Raw Material
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => setShowPurchaseDialog(true)}
            className="h-9 text-xs font-semibold gap-1.5 gradient-primary shadow-sm"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            + Record Purchase
          </Button>
        </div>
      </div>

      {/* ── Main Tab Navigation Bar ── */}
      <div className="flex items-center gap-1.5 bg-muted/40 p-1.5 rounded-2xl border border-border overflow-x-auto scrollbar-none">
        {[
          { id: "terminal", label: "POS Terminal", icon: Calculator },
          { id: "overview", label: "Sales vs Purchasing", icon: TrendingUp },
          { id: "purchases", label: "Purchases & Invoices", icon: ShoppingCart },
          { id: "raw-materials", label: "Raw Materials", icon: Boxes },
          { id: "usage", label: "Where Used (Wo Kaha Use Hua)", icon: History },
          { id: "recipes", label: "Recipes & Costing", icon: ChefHat },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all duration-150 ${
                isActive
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/80"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab Views ── */}
      {currentTab === "terminal" && (
        <PosTerminal
          restaurantId={restaurantId}
          restaurantName={activeRestaurant?.name || "Restaurant"}
          menuItems={menuItems}
          categories={categories}
          tables={tables}
          onOrderCompleted={refetchAll}
        />
      )}

      {currentTab === "overview" && (
        <PosOverview
          data={summaryData}
          period={period}
          onPeriodChange={setPeriod}
          onNavigateTab={handleTabChange}
        />
      )}

      {currentTab === "purchases" && (
        <PosPurchases
          purchases={purchasesList}
          onOpenNewPurchase={() => setShowPurchaseDialog(true)}
          onOpenSupplierDialog={() => setShowSupplierDialog(true)}
        />
      )}

      {currentTab === "raw-materials" && (
        <PosRawMaterials
          materials={rawMaterialsList}
          onOpenAddMaterial={() => {
            setEditingMaterial(null);
            setShowMaterialDialog(true);
          }}
          onOpenEditMaterial={(m) => {
            setEditingMaterial(m);
            setShowMaterialDialog(true);
          }}
          onOpenAdjustStock={(m) => {
            setAdjustingMaterial(m);
            setShowAdjustDialog(true);
          }}
          onDeleteMaterial={handleDeleteMaterial}
        />
      )}

      {currentTab === "usage" && (
        <PosUsageTraceability
          rawMaterials={rawMaterialsList}
          history={usageHistory}
          selectedMaterialId={selectedUsageMaterialId}
          onSelectMaterialId={setSelectedUsageMaterialId}
          summary={usageSummary}
        />
      )}

      {currentTab === "recipes" && (
        <PosRecipes
          recipes={recipesList}
          onOpenRecipeDialog={(rec) => {
            setEditingRecipe(rec);
            setShowRecipeDialog(true);
          }}
          onOpenNewRecipe={() => {
            setEditingRecipe(null);
            setShowRecipeDialog(true);
          }}
        />
      )}

      {/* ── Shared Dialogs ── */}
      {/* 1. New Purchase Dialog */}
      <PosNewPurchaseDialog
        open={showPurchaseDialog}
        onOpenChange={setShowPurchaseDialog}
        restaurantId={restaurantId}
        rawMaterials={rawMaterialsList}
        suppliers={suppliersList}
        onPurchaseCreated={refetchAll}
        onOpenAddSupplier={() => setShowSupplierDialog(true)}
        onOpenAddMaterial={() => {
          setEditingMaterial(null);
          setShowMaterialDialog(true);
        }}
      />

      {/* 2. Add / Edit Raw Material Dialog */}
      <PosRawMaterialDialog
        open={showMaterialDialog}
        onOpenChange={setShowMaterialDialog}
        restaurantId={restaurantId}
        material={editingMaterial}
        suppliers={suppliersList}
        onSaved={refetchAll}
      />

      {/* 3. Adjust Stock Dialog */}
      <PosStockAdjustDialog
        open={showAdjustDialog}
        onOpenChange={setShowAdjustDialog}
        restaurantId={restaurantId}
        item={adjustingMaterial}
        onAdjusted={refetchAll}
      />

      {/* 4. Add Supplier Dialog */}
      <PosSupplierDialog
        open={showSupplierDialog}
        onOpenChange={setShowSupplierDialog}
        restaurantId={restaurantId}
        onSaved={refetchSuppliers}
      />

      {/* 5. Recipe Dialog */}
      <PosRecipeDialog
        open={showRecipeDialog}
        onOpenChange={setShowRecipeDialog}
        restaurantId={restaurantId}
        recipe={editingRecipe}
        allRecipes={recipesList}
        rawMaterials={rawMaterialsList}
        onSaved={refetchAll}
      />
    </div>
  );
}
