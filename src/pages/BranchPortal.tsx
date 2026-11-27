import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant, RestaurantInfo } from "@/hooks/useActiveRestaurant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Store,
  Building2,
  MapPin,
  Phone,
  Navigation,
  CheckCircle2,
  ShoppingBag,
  UtensilsCrossed,
  RefreshCw,
  Loader2,
  Plus,
  BarChart3,
  DollarSign,
  Sliders,
  Check,
  Locate,
  LocateFixed,
  Edit,
  Trash2,
  Radio,
  TrendingUp,
  ExternalLink,
  Compass,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/restaurant";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { getDeviceGps } from "@/lib/deviceGps";
import { DeliveryRadiusControl } from "@/components/branches/DeliveryRadiusControl";
import { PageShell } from "@/components/layout/PageShell";

interface BranchItem extends RestaurantInfo {
  phone?: string | null;
  city?: string | null;
  area?: string | null;
  created_at?: string;
  parent_name?: string;
  total_orders?: number;
  total_revenue?: number;
  active_orders?: number;
  total_menu_items?: number;
  members?: any[];
}

interface BranchReportItem {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  service_radius_km: number;
  is_accepting_orders: boolean;
  total_orders: number;
  completed_orders: number;
  active_orders: number;
  total_revenue: number;
  avg_order_value: number;
}

export default function BranchPortal() {
  const { branchId: urlBranchId } = useParams<{ branchId?: string }>();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { restaurantId, setRestaurantId, restaurants, refreshRestaurants, activeRestaurant } = useActiveRestaurant();
  // Managers can view/manage existing branches but cannot create new ones
  const canCreateBranches = role === "admin" || role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [parentRestaurant, setParentRestaurant] = useState<{ id: string; name: string; slug?: string; phone?: string; address?: string } | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [branchReports, setBranchReports] = useState<BranchReportItem[]>([]);
  const [reportRollup, setReportRollup] = useState<any>(null);

  // Add Branch Dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [deviceGpsBusy, setDeviceGpsBusy] = useState(false);
  const [editDeviceGpsBusy, setEditDeviceGpsBusy] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    address: "",
    city: "",
    area: "",
    phone: "",
    latitude: "",
    longitude: "",
    service_radius_km: "8",
    copy_parent_menu: true,
    owner_email: "",
    owner_password: "",
    owner_full_name: "",
  });

  // Edit Branch Dialog
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editGeocoding, setEditGeocoding] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    city: "",
    area: "",
    phone: "",
    service_radius_km: "8",
    latitude: "",
    longitude: "",
    is_accepting_orders: true,
    owner_email: "",
    owner_password: "",
    owner_full_name: "",
  });

  // Delete Branch Dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<BranchItem | null>(null);
  const [deletingBranch, setDeletingBranch] = useState(false);

  const handleDeleteBranch = async () => {
    if (!branchToDelete) return;
    setDeletingBranch(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${getApiBase()}/api/branches/${branchToDelete.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete branch");

      toast.success(`Branch "${branchToDelete.name}" deleted successfully!`);
      setDeleteOpen(false);
      setBranchToDelete(null);
      await refreshRestaurants();
      await loadBranches();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete branch");
    } finally {
      setDeletingBranch(false);
    }
  };

  // Load Parent Restaurant and Branches
  const loadBranches = useCallback(async () => {
    try {
      setRefreshing(true);
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // 1. Resolve parent restaurant ID
      let rootParentId = restaurantId;
      if (activeRestaurant?.is_branch && activeRestaurant?.parent_restaurant_id) {
        rootParentId = activeRestaurant.parent_restaurant_id;
      } else if (!rootParentId && restaurants?.length) {
        const found = restaurants.find((r) => !r.is_branch) || restaurants[0];
        rootParentId = found.id;
      }

      if (!rootParentId) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 2. Fetch parent restaurant basic info
      const { data: parentData } = await supabase
        .from("restaurants")
        .select("id, name, slug, phone, address")
        .eq("id", rootParentId)
        .maybeSingle();

      if (parentData) {
        setParentRestaurant(parentData);
      }

      // 3. Fetch branches from API
      const res = await fetch(`${getApiBase()}/api/restaurants/${rootParentId}/branches`, {
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        const list = (data.branches || []) as BranchItem[];
        setBranches(list);
      }

      // 4. Fetch branches reports summary
      const repRes = await fetch(`${getApiBase()}/api/restaurants/${rootParentId}/branches-report`, {
        headers,
      });

      if (repRes.ok) {
        const repData = await repRes.json();
        setBranchReports(repData.branches || []);
        setReportRollup(repData.rollup || null);
      }
    } catch (err: any) {
      console.error("Failed to load branches data:", err);
      toast.error("Failed to load branches");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, activeRestaurant, restaurants]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const captureDeviceGps = async (mode: "add" | "edit") => {
    const setBusy = mode === "add" ? setDeviceGpsBusy : setEditDeviceGpsBusy;
    setBusy(true);
    try {
      const gps = await getDeviceGps();
      const lat = gps.latitude.toFixed(6);
      const lng = gps.longitude.toFixed(6);
      let address = "";
      let city = "";
      let area = "";
      try {
        const token = getToken();
        const revRes = await fetch(`${getApiBase()}/api/geo/reverse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            latitude: Number(lat),
            longitude: Number(lng),
          }),
        });
        const rev = await revRes.json().catch(() => ({}));
        if (revRes.ok) {
          address = rev.formattedAddress || "";
          city = rev.city || "";
          area = rev.area || "";
        }
      } catch {
        /* coords still usable */
      }
      if (mode === "add") {
        setAddForm((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          ...(address ? { address } : {}),
          ...(city ? { city } : {}),
          ...(area ? { area } : {}),
        }));
      } else {
        setEditForm((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          ...(address ? { address } : {}),
          ...(city ? { city } : {}),
          ...(area ? { area } : {}),
        }));
      }
      toast.success(
        address
          ? "GPS + address filled"
          : gps.accuracyMeters != null
            ? `GPS captured (±${Math.round(gps.accuracyMeters)} m)`
            : "GPS location captured",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not get GPS location");
    } finally {
      setBusy(false);
    }
  };

  // Geocode address helper for Add Modal
  const handleGeocodeAddress = async () => {
    if (!addForm.address.trim()) {
      toast.error("Please enter an address to geocode");
      return;
    }
    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addForm.address)}&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setAddForm((prev) => ({
          ...prev,
          latitude: parseFloat(data[0].lat).toFixed(6),
          longitude: parseFloat(data[0].lon).toFixed(6),
        }));
        toast.success("Coordinates resolved from address!");
      } else {
        toast.error("Could not find coordinates for this address. You can enter them manually.");
      }
    } catch {
      toast.error("Geocoding service unavailable. Please enter coordinates manually.");
    } finally {
      setGeocoding(false);
    }
  };

  // Geocode address helper for Edit Modal
  const handleGeocodeEditAddress = async () => {
    if (!editForm.address.trim()) {
      toast.error("Please enter an address to geocode");
      return;
    }
    setEditGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(editForm.address)}&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setEditForm((prev) => ({
          ...prev,
          latitude: parseFloat(data[0].lat).toFixed(6),
          longitude: parseFloat(data[0].lon).toFixed(6),
        }));
        toast.success("Coordinates resolved from address!");
      } else {
        toast.error("Could not find coordinates for this address. You can enter them manually.");
      }
    } catch {
      toast.error("Geocoding service unavailable. Please enter coordinates manually.");
    } finally {
      setEditGeocoding(false);
    }
  };

  // Create new branch
  const handleAddBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateBranches) {
      toast.error("Only restaurant owner or admin can create branches.");
      return;
    }
    if (!parentRestaurant?.id) {
      toast.error("Parent restaurant not identified");
      return;
    }
    if (!addForm.name.trim()) {
      toast.error("Branch name is required");
      return;
    }

    setAddingBranch(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${getApiBase()}/api/restaurants/${parentRestaurant.id}/branches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: addForm.name.trim(),
          address: addForm.address.trim() || null,
          city: addForm.city.trim() || null,
          area: addForm.area.trim() || null,
          phone: addForm.phone.trim() || null,
          latitude: addForm.latitude ? parseFloat(addForm.latitude) : null,
          longitude: addForm.longitude ? parseFloat(addForm.longitude) : null,
          service_radius_km: parseFloat(addForm.service_radius_km) || 8.0,
          copy_parent_menu: addForm.copy_parent_menu,
          owner_email: addForm.owner_email.trim() || null,
          owner_password: addForm.owner_password.trim() || null,
          owner_full_name: addForm.owner_full_name.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create branch");
      }

      toast.success(`Branch "${addForm.name}" created successfully!`);
      setAddOpen(false);
      setAddForm({
        name: "",
        address: "",
        city: "",
        area: "",
        phone: "",
        latitude: "",
        longitude: "",
        service_radius_km: "8",
        copy_parent_menu: true,
        owner_email: "",
        owner_password: "",
        owner_full_name: "",
      });

      await refreshRestaurants();
      await loadBranches();
    } catch (err: any) {
      toast.error(err.message || "Failed to create branch");
    } finally {
      setAddingBranch(false);
    }
  };

  // Toggle Order Acceptance for a branch
  const handleToggleAccepting = async (branch: BranchItem, checked: boolean) => {
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${getApiBase()}/api/branches/${branch.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_accepting_orders: checked }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to update order status");
      }

      setBranches((prev) =>
        prev.map((b) => (b.id === branch.id ? { ...b, is_accepting_orders: checked } : b))
      );
      toast.success(checked ? `${branch.name} is accepting orders` : `${branch.name} orders paused`);
      void refreshRestaurants();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle status");
    }
  };

  // Open Edit Modal
  const openEditDialog = (branch: BranchItem) => {
    setEditingBranch(branch);
    const primaryMember = branch.members?.find((m: any) => m.member_role === "manager" || m.member_role === "owner") || branch.members?.[0];
    setEditForm({
      name: branch.name || "",
      address: branch.address || "",
      city: branch.city || "",
      area: branch.area || "",
      phone: branch.phone || "",
      service_radius_km: String(branch.service_radius_km || 8),
      latitude: branch.latitude != null ? String(branch.latitude) : "",
      longitude: branch.longitude != null ? String(branch.longitude) : "",
      is_accepting_orders: branch.is_accepting_orders ?? true,
      owner_email: primaryMember?.email || "",
      owner_password: "",
      owner_full_name: primaryMember?.full_name || "",
    });
    setEditOpen(true);
  };

  // Save Edit Branch
  const handleSaveEdit = async () => {
    if (!editingBranch) return;
    if (editForm.owner_password && editForm.owner_password.trim().length > 0 && editForm.owner_password.trim().length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    setSavingEdit(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const payload: any = {
        name: editForm.name,
        address: editForm.address,
        city: editForm.city,
        area: editForm.area,
        phone: editForm.phone,
        service_radius_km: parseFloat(editForm.service_radius_km) || 8.0,
        latitude: editForm.latitude ? parseFloat(editForm.latitude) : null,
        longitude: editForm.longitude ? parseFloat(editForm.longitude) : null,
        is_accepting_orders: editForm.is_accepting_orders,
        owner_email: editForm.owner_email ? editForm.owner_email.trim() : null,
        owner_full_name: editForm.owner_full_name ? editForm.owner_full_name.trim() : null,
      };

      if (editForm.owner_password && editForm.owner_password.trim().length >= 6) {
        payload.owner_password = editForm.owner_password.trim();
      }

      const res = await fetch(`${getApiBase()}/api/branches/${editingBranch.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save branch");

      toast.success("Branch details updated successfully");
      setEditOpen(false);
      void refreshRestaurants();
      void loadBranches();
    } catch (err: any) {
      toast.error(err.message || "Failed to update branch");
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Loading Branch Management Hub...</p>
      </div>
    );
  }

  const parentName = parentRestaurant?.name || activeRestaurant?.name || "Your Restaurant";

  return (
    <PageShell maxWidth="lg" className="pb-10 text-foreground">
      {/* 1. Top Banner / Header */}
      <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/30 p-6 sm:p-7 shadow-xs overflow-hidden">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-primary/10 text-primary border border-primary/20 font-bold px-2.5 py-0.5 text-xs">
                Multi-Branch System
              </Badge>
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 bg-muted/60 px-2.5 py-0.5 rounded-md border border-border/40">
                <Store className="h-3.5 w-3.5 text-primary" /> Parent: {parentName}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Branches & Locations
            </h1>
            <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed sm:text-sm">
              Manage branches (e.g. Branch A, Branch B) for <strong className="text-foreground">{parentName}</strong>. 
              Orders from your shared AI phone number are automatically geocoded and assigned to the nearest branch.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadBranches()}
              disabled={refreshing}
              className="w-full gap-2 h-9 text-xs font-semibold sm:w-auto"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canCreateBranches && (
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                className="w-full gap-2 h-9 text-xs font-bold bg-primary text-primary-foreground shadow-sm px-4 sm:w-auto"
              >
                <Plus className="h-4 w-4" />
                Add New Branch
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Summary KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl border border-border/80 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total Branches</p>
              <p className="text-2xl font-extrabold text-foreground mt-0.5">{branches.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {branches.filter((b) => b.is_accepting_orders).length} accepting orders
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Branch Orders</p>
              <p className="text-2xl font-extrabold text-foreground mt-0.5">
                {reportRollup?.total_orders ?? branches.reduce((sum, b) => sum + (b.total_orders || 0), 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {reportRollup?.active_orders ?? 0} active now
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <ShoppingBag className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Branch Revenue</p>
              <p className="text-2xl font-extrabold text-foreground mt-0.5">
                {formatCurrency(reportRollup?.total_revenue ?? branches.reduce((sum, b) => sum + (b.total_revenue || 0), 0))}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Delivered orders</p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">AI Phone Ordering</p>
              <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Shared Line
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Auto nearest routing</p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <Phone className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Main Content: Empty State or Tabs */}
      {branches.length === 0 ? (
        <Card className="rounded-2xl border border-border/80 shadow-xs bg-card overflow-hidden">
          <CardContent className="py-16 px-6 text-center max-w-lg mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-inner">
              <Building2 className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                No Branches for {parentName} Yet
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Add branch locations (e.g. <strong>{parentName} – DHA</strong>, <strong>{parentName} – Gulberg</strong>) to expand your delivery reach. 
                Each branch will have its own staff, inventory, and menu pricing while sharing your AI phone number.
              </p>
            </div>
            {canCreateBranches ? (
              <div className="pt-2">
                <Button
                  size="default"
                  onClick={() => setAddOpen(true)}
                  className="gap-2 font-bold px-6 h-10 bg-primary text-primary-foreground shadow-sm"
                >
                  <Plus className="h-4 w-4" /> Create First Branch
                </Button>
              </div>
            ) : (
              <p className="pt-2 text-sm text-muted-foreground">
                Only restaurant owner or admin can create branches.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">All Branches</h2>
              <Badge variant="outline" className="text-xs font-bold bg-primary/10 text-primary border-primary/20">
                {branches.length}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {branches.map((branch) => {
              const isAccepting = branch.is_accepting_orders ?? true;

              return (
                <Card
                  key={branch.id}
                  className="group relative rounded-2xl border border-border/70 bg-gradient-to-b from-card via-card to-muted/20 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 flex flex-col justify-between overflow-hidden shadow-xs"
                >
                  <div>
                    {/* Top Status Accent Bar */}
                    <div
                      className={`h-1.5 w-full transition-all duration-300 ${
                        isAccepting
                          ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600"
                          : "bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600"
                      }`}
                    />

                    {/* Card Header */}
                    <div className="p-5 pb-3 border-b border-border/40 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <h3 className="font-bold text-base text-foreground truncate tracking-tight group-hover:text-primary transition-colors">
                            {branch.name}
                          </h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 text-primary shrink-0" />
                            <span className="truncate">{branch.address || "No address provided"}</span>
                          </p>
                        </div>
                      </div>

                      {/* Status Switch Badge */}
                      <div
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-background/90 shadow-xs shrink-0 ${
                          isAccepting
                            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                            : "border-amber-500/30 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {isAccepting ? (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0"></span>
                        )}
                        <span className="text-[11px] font-bold">{isAccepting ? "Accepting" : "Paused"}</span>
                        <Switch
                          checked={isAccepting}
                          onCheckedChange={(checked) => handleToggleAccepting(branch, checked)}
                          className="scale-75 origin-right ml-0.5 data-[state=checked]:bg-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Card Body Metrics */}
                    <CardContent className="p-5 space-y-4">
                      {/* 3-Column Metrics Dashboard */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2.5 rounded-xl bg-sky-500/5 border border-sky-500/15 flex flex-col items-center justify-center group-hover:border-sky-500/30 transition-colors">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                            <Radio className="h-3 w-3" /> Radius
                          </div>
                          <p className="text-sm font-extrabold text-foreground mt-0.5">
                            {branch.service_radius_km || 8} km
                          </p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-indigo-500/5 border border-indigo-500/15 flex flex-col items-center justify-center group-hover:border-indigo-500/30 transition-colors">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                            <ShoppingBag className="h-3 w-3" /> Orders
                          </div>
                          <p className="text-sm font-extrabold text-foreground mt-0.5">
                            {branch.total_orders || 0}
                          </p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15 flex flex-col items-center justify-center group-hover:border-emerald-500/30 transition-colors">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            <TrendingUp className="h-3 w-3" /> Sales
                          </div>
                          <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {formatCurrency(branch.total_revenue || 0)}
                          </p>
                        </div>
                      </div>

                      {/* Contact & GPS details */}
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40 text-muted-foreground">
                          <div className="flex items-center gap-2 truncate">
                            <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="font-medium text-foreground truncate">{branch.phone || "No phone added"}</span>
                          </div>
                          {branch.phone && (
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase shrink-0">
                              Contact
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40 text-muted-foreground font-mono text-[11px]">
                          <div className="flex items-center gap-2 truncate">
                            <Navigation className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate">
                              {branch.latitude != null && branch.longitude != null
                                ? `${branch.latitude}, ${branch.longitude}`
                                : "GPS Not configured"}
                            </span>
                          </div>
                          {branch.latitude != null && branch.longitude != null && (
                            <a
                              href={`https://www.google.com/maps?q=${branch.latitude},${branch.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 flex items-center gap-1 text-[10px] font-sans font-semibold text-primary hover:underline ml-2"
                            >
                              View Map <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="p-4 pt-3 border-t border-border/40 bg-muted/10 flex items-center justify-between gap-2.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs font-semibold flex-1 h-9 rounded-xl gap-1.5 border-primary/30 text-primary bg-primary/5 hover:bg-primary hover:text-primary-foreground transition-all duration-200 shadow-xs"
                      onClick={() => openEditDialog(branch)}
                    >
                      <Edit className="h-3.5 w-3.5" /> Edit Details
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs font-semibold flex-1 h-9 rounded-xl gap-1.5 border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground transition-all duration-200 shadow-xs"
                      onClick={() => {
                        setBranchToDelete(branch);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete Branch
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. ADD BRANCH MODAL DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Building2 className="h-5 w-5 text-primary" />
              Add Branch to {parentName}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Create a new branch location (e.g. {parentName} – DHA, {parentName} – Gulberg).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddBranchSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="branch_name" className="text-xs font-bold">
                Branch Name *
              </Label>
              <Input
                id="branch_name"
                placeholder={`e.g. ${parentName} – DHA Phase 5`}
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                required
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="branch_address" className="text-xs font-bold">
                  Physical Address *
                </Label>
                <button
                  type="button"
                  onClick={handleGeocodeAddress}
                  disabled={geocoding || !addForm.address.trim()}
                  className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  <Locate className="h-3 w-3" />
                  {geocoding ? "Detecting GPS..." : "Auto-Geocode GPS"}
                </button>
              </div>
              <Input
                id="branch_address"
                placeholder="e.g. Commercial Area, Sector C, DHA Phase 5, Lahore"
                value={addForm.address}
                onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
                required
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="branch_city" className="text-xs font-bold">City</Label>
                <Input
                  id="branch_city"
                  placeholder="e.g. Lahore"
                  value={addForm.city}
                  onChange={(e) => setAddForm({ ...addForm, city: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="branch_area" className="text-xs font-bold">Area</Label>
                <Input
                  id="branch_area"
                  placeholder="e.g. Iqbal Town"
                  value={addForm.area}
                  onChange={(e) => setAddForm({ ...addForm, area: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-bold">Coordinates</Label>
                <button
                  type="button"
                  onClick={() => void captureDeviceGps("add")}
                  disabled={deviceGpsBusy}
                  className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  <LocateFixed className={`h-3 w-3 ${deviceGpsBusy ? "animate-pulse" : ""}`} />
                  {deviceGpsBusy ? "Getting GPS..." : "Use Auto-GPS"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="branch_lat" className="text-[10px] text-muted-foreground">
                    Latitude
                  </Label>
                  <Input
                    id="branch_lat"
                    placeholder="e.g. 31.4705"
                    value={addForm.latitude}
                    onChange={(e) => setAddForm({ ...addForm, latitude: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="branch_lng" className="text-[10px] text-muted-foreground">
                    Longitude
                  </Label>
                  <Input
                    id="branch_lng"
                    placeholder="e.g. 74.4098"
                    value={addForm.longitude}
                    onChange={(e) => setAddForm({ ...addForm, longitude: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch_phone" className="text-xs font-bold">
                Branch phone (optional)
              </Label>
              <Input
                id="branch_phone"
                placeholder="e.g. +923001234567"
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
            <DeliveryRadiusControl
              id="branch_radius"
              dense
              value={addForm.service_radius_km}
              onChange={(km) => setAddForm({ ...addForm, service_radius_km: String(km) })}
            />

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/50">
              <div>
                <p className="text-xs font-bold text-foreground">Copy Parent Restaurant Menu</p>
                <p className="text-[11px] text-muted-foreground">Clone categories & food items into this branch</p>
              </div>
              <Switch
                checked={addForm.copy_parent_menu}
                onCheckedChange={(checked) => setAddForm({ ...addForm, copy_parent_menu: checked })}
              />
            </div>

            {/* Optional Branch Manager Provisioning */}
            <div className="border-t border-border/50 pt-3 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Branch Manager Login (Optional)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manager_email" className="text-xs font-semibold">
                    Manager Email
                  </Label>
                  <Input
                    id="manager_email"
                    type="email"
                    placeholder="manager.dha@restaurant.com"
                    value={addForm.owner_email}
                    onChange={(e) => setAddForm({ ...addForm, owner_email: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manager_password" className="text-xs font-semibold">
                    Password
                  </Label>
                  <Input
                    id="manager_password"
                    type="password"
                    placeholder="Min 6 characters"
                    value={addForm.owner_password}
                    onChange={(e) => setAddForm({ ...addForm, owner_password: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={addingBranch}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="font-bold bg-primary text-primary-foreground" disabled={addingBranch}>
                {addingBranch ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                Create Branch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. EDIT BRANCH MODAL DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-border/40 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Sliders className="h-5 w-5 text-primary" />
              Edit Branch Settings
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Update location, manager credentials, or order acceptance status.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[calc(90vh-140px)]">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Branch Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">Physical Address</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] font-semibold text-primary hover:text-primary/80 px-1.5 gap-1"
                  onClick={handleGeocodeEditAddress}
                  disabled={editGeocoding || !editForm.address.trim()}
                >
                  <Locate className={`h-3 w-3 ${editGeocoding ? "animate-spin" : ""}`} />
                  Auto-fill GPS
                </Button>
              </div>
              <Input
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                className="h-9 text-xs"
                placeholder="e.g. Phase 5 DHA, Lahore"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">City</Label>
                <Input
                  value={editForm.city}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                  className="h-9 text-xs"
                  placeholder="e.g. Lahore"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Area</Label>
                <Input
                  value={editForm.area}
                  onChange={(e) => setEditForm({ ...editForm, area: e.target.value })}
                  className="h-9 text-xs"
                  placeholder="e.g. Johar Town"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-bold">Coordinates</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] font-semibold text-primary hover:text-primary/80 px-1.5 gap-1"
                  onClick={() => void captureDeviceGps("edit")}
                  disabled={editDeviceGpsBusy}
                >
                  <LocateFixed className={`h-3 w-3 ${editDeviceGpsBusy ? "animate-pulse" : ""}`} />
                  {editDeviceGpsBusy ? "Getting GPS..." : "Use Auto-GPS"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Latitude</Label>
                  <Input
                    value={editForm.latitude}
                    onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Longitude</Label>
                  <Input
                    value={editForm.longitude}
                    onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
            <DeliveryRadiusControl
              id="edit_branch_radius"
              dense
              value={editForm.service_radius_km}
              onChange={(km) => setEditForm({ ...editForm, service_radius_km: String(km) })}
            />

            {/* Branch Manager Credentials */}
            <div className="border-t border-border/50 pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Branch Manager Account
                </p>
                <span className="text-[10px] text-muted-foreground">
                  Update login credentials
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit_manager_email" className="text-xs font-semibold">
                    Manager Email
                  </Label>
                  <Input
                    id="edit_manager_email"
                    type="email"
                    placeholder="manager@branch.com"
                    value={editForm.owner_email}
                    onChange={(e) => setEditForm({ ...editForm, owner_email: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit_manager_password" className="text-xs font-semibold">
                    New Password
                  </Label>
                  <Input
                    id="edit_manager_password"
                    type="password"
                    placeholder="Leave blank to keep same"
                    value={editForm.owner_password}
                    onChange={(e) => setEditForm({ ...editForm, owner_password: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              {editForm.owner_password && editForm.owner_password.length < 6 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Password must be at least 6 characters long to update.
                </p>
              )}
            </div>

            {/* Order Acceptance at the bottom / last */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <div>
                <p className="text-xs font-bold text-foreground">Order Acceptance</p>
                <p className="text-[11px] text-muted-foreground">Accept phone & web orders</p>
              </div>
              <Switch
                checked={editForm.is_accepting_orders}
                onCheckedChange={(checked) => setEditForm({ ...editForm, is_accepting_orders: checked })}
                className="data-[state=checked]:bg-emerald-500"
              />
            </div>
          </div>

          <DialogFooter className="p-4 border-t border-border/40 bg-muted/20 gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button size="sm" className="font-bold bg-primary text-primary-foreground" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Branch Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Branch
            </DialogTitle>
            <DialogDescription className="pt-2 text-foreground">
              Are you sure you want to delete branch <span className="font-bold text-foreground">"{branchToDelete?.name}"</span>?
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            This will deactivate the branch and stop it from receiving or managing orders.
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={deletingBranch}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="font-bold gap-1.5"
              onClick={handleDeleteBranch}
              disabled={deletingBranch}
            >
              {deletingBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
