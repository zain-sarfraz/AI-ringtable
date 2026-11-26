import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Building2,
  CalendarClock,
  ChefHat,
  Clock,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  Ticket,
  Trash2,
  Truck,
  User,
  Users,
  Wallet,
  Navigation,
  GitBranch,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getToken } from "@/lib/authStorage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { resolveMediaUrl, getApiBase } from "@/lib/apiBase";
import { formatCurrency, ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/layout/PageShell";

type Restaurant = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  twilio_phone_number: string | null;
  elevenlabs_agent_id: string | null;
  elevenlabs_connected_at: string | null;
  twilio_connected_at: string | null;
  telnyx_phone_number: string | null;
  synthflow_agent_id: string | null;
  synthflow_synced_at: string | null;
  voice_provider: string | null;
  agent_language: string | null;
  agent_voice_id: string | null;
  agent_first_message: string | null;
  agent_system_prompt: string | null;
  agent_menu_synced_at: string | null;
  commission_rate: number;
  allows_delivery: boolean;
  allows_pickup: boolean;
  logo_url: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
};

type Settings = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  tax_rate: number;
  delivery_fee: number;
  min_order_amount: number;
  is_open: boolean;
};

type WorkingHour = {
  id?: string;
  restaurant_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

type Member = {
  email: string;
  full_name: string | null;
  member_role: string;
  created_at: string;
};

type RecentOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  status: string;
  created_at: string;
};

type CatalogStats = {
  categories: number;
  items: number;
  addons: number;
  deals: number;
  coupons: number;
  orders: number;
  revenue: number;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ar: "Arabic",
  hi: "Hindi",
  multi: "Multilingual (Auto-detect)",
};

function formatTime(t: string) {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return t;
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m ?? "00"} ${ampm}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function truncateId(id: string, len = 8) {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function normalizeTime(t: string) {
  if (!t) return "09:00";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function normalizeHours(rows: WorkingHour[], restaurantId: string): WorkingHour[] {
  return rows.map((h) => ({
    ...h,
    restaurant_id: h.restaurant_id || restaurantId,
    open_time: normalizeTime(h.open_time),
    close_time: normalizeTime(h.close_time),
  }));
}

export default function RestaurantDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [hoursSnapshot, setHoursSnapshot] = useState<WorkingHour[]>([]);
  const [editingHours, setEditingHours] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  // Branches state
  const [branches, setBranches] = useState<any[]>([]);
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchForm, setBranchForm] = useState({
    name: "",
    address: "",
    service_radius_km: "5",
    latitude: "",
    longitude: "",
    owner_email: "",
    owner_password: "",
    owner_full_name: "",
    phone: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setLoading(true);

      const { data, error } = await supabase.from("restaurants").select("*").eq("id", id).maybeSingle();
      if (error || !data) {
        if (!cancelled) {
          setRestaurant(null);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setRestaurant(data as Restaurant);

      const [
        settingsRes,
        hoursRes,
        membersRes,
        cuisineLinksRes,
        catRes,
        itemRes,
        addonRes,
        dealRes,
        couponRes,
        orderCountRes,
        revenueRes,
        recentRes,
      ] = await Promise.all([
        supabase.from("restaurant_settings").select("*").eq("restaurant_id", id).maybeSingle(),
        supabase.from("restaurant_hours").select("*").eq("restaurant_id", id).order("day_of_week"),
        supabase.from("restaurant_members").select("user_id, member_role, created_at").eq("restaurant_id", id),
        supabase.from("restaurant_cuisines").select("cuisine_id").eq("restaurant_id", id),
        supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("menu_addons").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("discounts").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", id),
        supabase.from("orders").select("total_amount").eq("restaurant_id", id).eq("status", "delivered"),
        supabase
          .from("orders")
          .select("id, order_number, customer_name, total_amount, status, created_at")
          .eq("restaurant_id", id)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      if (cancelled) return;

      setSettings((settingsRes.data as Settings | null) ?? null);
      setHours(normalizeHours((hoursRes.data as WorkingHour[]) ?? [], id));
      setEditingHours(false);

      const memberRows = (membersRes.data as { user_id: string; member_role: string; created_at: string }[]) ?? [];
      const userIds = [...new Set(memberRows.map((m) => m.user_id))];
      if (userIds.length) {
        const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", userIds);
        const profileMap = new Map(
          ((profiles as { id: string; email: string; full_name: string | null }[]) ?? []).map((p) => [p.id, p]),
        );
        setMembers(
          memberRows.map((m) => {
            const p = profileMap.get(m.user_id);
            return {
              email: p?.email ?? "—",
              full_name: p?.full_name ?? null,
              member_role: m.member_role,
              created_at: m.created_at,
            };
          }),
        );
      } else {
        setMembers([]);
      }

      const cuisineIds = [...new Set(((cuisineLinksRes.data as { cuisine_id: string }[]) ?? []).map((l) => l.cuisine_id))];
      if (cuisineIds.length) {
        const { data: cs } = await supabase.from("cuisines").select("name").in("id", cuisineIds);
        setCuisines(((cs as { name: string }[]) ?? []).map((c) => c.name).sort());
      } else {
        setCuisines([]);
      }

      const revenue = ((revenueRes.data as { total_amount: number }[]) ?? []).reduce(
        (sum, row) => sum + Number(row.total_amount || 0),
        0,
      );

      setStats({
        categories: catRes.count ?? 0,
        items: itemRes.count ?? 0,
        addons: addonRes.count ?? 0,
        deals: dealRes.count ?? 0,
        coupons: couponRes.count ?? 0,
        orders: orderCountRes.count ?? 0,
        revenue,
      });

      setRecentOrders((recentRes.data as RecentOrder[]) ?? []);

      // Load branches
      try {
        const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
        const bRes = await fetch(`${getApiBase()}/api/restaurants/${id}/branches`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (bRes.ok) {
          const bData = await bRes.json();
          if (!cancelled && bData?.branches) setBranches(bData.branches);
        }
      } catch (bErr) {
        console.warn("Failed to load branches:", bErr);
      }

      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !branchForm.name.trim()) {
      toast({ variant: "destructive", title: "Branch name required", description: "Please enter a name for the branch." });
      return;
    }
    setCreatingBranch(true);
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${getApiBase()}/api/restaurants/${id}/branches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(branchForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create branch");

      toast({ title: "Branch Created", description: `Branch "${branchForm.name}" was created successfully.` });
      setAddBranchOpen(false);
      setBranchForm({
        name: "",
        address: "",
        service_radius_km: "5",
        latitude: "",
        longitude: "",
        owner_email: "",
        owner_password: "",
        owner_full_name: "",
        phone: "",
      });

      // Reload branches
      const bRes = await fetch(`${getApiBase()}/api/restaurants/${id}/branches`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (bRes.ok) {
        const bData = await bRes.json();
        if (bData?.branches) setBranches(bData.branches);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to create branch", description: err.message });
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleToggleBranchOrders = async (branchId: string, checked: boolean) => {
    try {
      const token = getToken() || (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${getApiBase()}/api/branches/${branchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_accepting_orders: checked }),
      });
      if (!res.ok) throw new Error("Failed to update branch");
      setBranches((prev) =>
        prev.map((b) => (b.id === branchId ? { ...b, is_accepting_orders: checked } : b))
      );
      toast({ title: checked ? "Branch accepting orders" : "Branch orders paused" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    }
  };

  const currency = settings?.currency ?? "USD";
  const coverSrc = resolveMediaUrl(restaurant?.cover_image_url);
  const logoSrc = resolveMediaUrl(restaurant?.logo_url);

  const hoursByDay = useMemo(() => {
    const map = new Map<number, WorkingHour[]>();
    for (const h of hours) {
      if (!map.has(h.day_of_week)) map.set(h.day_of_week, []);
      map.get(h.day_of_week)!.push(h);
    }
    return map;
  }, [hours]);

  const beginEditHours = () => {
    setHoursSnapshot(hours.map((h) => ({ ...h })));
    setEditingHours(true);
  };

  const cancelEditHours = () => {
    setHours(hoursSnapshot);
    setEditingHours(false);
  };

  const addHourSlot = (day: number) => {
    if (!id) return;
    setHours([
      ...hours,
      {
        restaurant_id: id,
        day_of_week: day,
        open_time: "09:00",
        close_time: "22:00",
        is_closed: false,
      },
    ]);
  };

  const removeHourSlot = (index: number) => {
    setHours(hours.filter((_, i) => i !== index));
  };

  const updateHourSlot = (index: number, updates: Partial<WorkingHour>) => {
    setHours(hours.map((h, i) => (i === index ? { ...h, ...updates } : h)));
  };

  const saveHours = async () => {
    if (!id) return;
    setSavingHours(true);
    await supabase.from("restaurant_hours").delete().eq("restaurant_id", id);
    const payload = hours.map(({ restaurant_id, day_of_week, open_time, close_time, is_closed }) => ({
      restaurant_id,
      day_of_week,
      open_time,
      close_time,
      is_closed,
    }));
    const { error } = await supabase.from("restaurant_hours").insert(payload);
    setSavingHours(false);
    if (error) {
      toast({ variant: "destructive", title: "Failed to save hours", description: error.message });
      return;
    }
    toast({ title: "Opening hours saved" });
    setEditingHours(false);
    const { data } = await supabase.from("restaurant_hours").select("*").eq("restaurant_id", id).order("day_of_week");
    setHours(normalizeHours((data as WorkingHour[]) ?? [], id));
  };

  if (loading) {
    return (
      <div className="space-y-6 pb-10 animate-fade-in">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Skeleton className="h-80 xl:col-span-2 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Store className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Restaurant not found</h2>
        <p className="text-muted-foreground mt-1 mb-6">This restaurant may have been removed.</p>
        <Button variant="outline" onClick={() => navigate("/restaurants")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to restaurants
        </Button>
      </div>
    );
  }

  const agentConnected = Boolean(restaurant.elevenlabs_agent_id || restaurant.elevenlabs_connected_at);
  const twilioConnected = Boolean(restaurant.twilio_phone_number || restaurant.twilio_connected_at);

  return (
    <PageShell maxWidth="lg" className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <div className="h-40 sm:h-52 relative">
          {coverSrc ? (
            <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/5 to-muted" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </div>

        <div className="relative px-6 pb-6 -mt-14 sm:-mt-16">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl border-4 border-background bg-muted shadow-md overflow-hidden flex-shrink-0">
                {logoSrc ? (
                  <img src={logoSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-primary/10">
                    <Store className="h-10 w-10 text-primary" />
                  </div>
                )}
              </div>
              <div className="pb-1 min-w-0">
                <h1 className="text-xl font-bold tracking-tight truncate sm:text-2xl">{restaurant.name}</h1>
                <p className="text-xs text-muted-foreground mt-0.5 sm:text-sm">/{restaurant.slug}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={restaurant.is_active ? "default" : "secondary"}>
                    {restaurant.is_active ? "Active" : "Inactive"}
                  </Badge>
                  {settings?.is_open != null && (
                    <Badge variant="outline" className={settings.is_open ? "border-green-500/40 text-green-700" : ""}>
                      {settings.is_open ? "Open now" : "Closed"}
                    </Badge>
                  )}
                  {restaurant.allows_delivery && <Badge variant="outline">Delivery</Badge>}
                  {restaurant.allows_pickup && <Badge variant="outline">Pickup</Badge>}
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:pb-1">
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => navigate("/restaurants")}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                All restaurants
              </Button>
              <Button size="sm" className="w-full sm:w-auto" asChild>
                <Link to={`/restaurants/${restaurant.id}/configuration`}>
                  <Settings className="h-4 w-4 mr-1.5" />
                  Configure
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard icon={ShoppingBag} label="Orders" value={String(stats?.orders ?? 0)} />
        <StatCard icon={ChefHat} label="Menu items" value={String(stats?.items ?? 0)} />
        <StatCard icon={Package} label="Categories" value={String(stats?.categories ?? 0)} />
        <StatCard icon={Tag} label="Deals" value={String(stats?.deals ?? 0)} />
        <StatCard icon={Ticket} label="Coupons" value={String(stats?.coupons ?? 0)} />
        <StatCard icon={Wallet} label="Commission" value={`${restaurant.commission_rate ?? 0}%`} />
        <StatCard
          icon={Wallet}
          label="Revenue"
          value={formatCurrency(stats?.revenue ?? 0, currency)}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="xl:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Contact & location
              </CardTitle>
              <CardDescription>Public-facing business information</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={Mail} label="Contact email" value={restaurant.contact_email || settings?.email || "—"} />
              <InfoRow icon={Phone} label="Phone" value={restaurant.phone || settings?.phone || "—"} />
              <InfoRow
                icon={MapPin}
                label="Address"
                value={restaurant.address || settings?.address || "—"}
                className="sm:col-span-2"
              />
              <InfoRow icon={Link2} label="Restaurant ID" value={restaurant.id} mono />
              <InfoRow icon={CalendarClock} label="Created" value={formatDate(restaurant.created_at)} />
            </CardContent>
          </Card>

          {/* Multi-Branch Management Section */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Branches & Locations
                  <Badge variant="secondary" className="ml-2 font-semibold">
                    {branches.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Sub-locations with independent menus, staff, and nearest-branch AI phone routing
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setAddBranchOpen(true)} className="gap-1.5 flex-shrink-0">
                <Plus className="h-4 w-4" />
                Add Branch
              </Button>
            </CardHeader>
            <CardContent>
              {branches.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center space-y-3 bg-muted/20">
                  <Building2 className="h-10 w-10 text-muted-foreground/60 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No branches created yet</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Create branches for this restaurant (e.g. DHA, Downtown). Voice orders will automatically route to the nearest branch based on customer location.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setAddBranchOpen(true)} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add First Branch
                  </Button>
                </div>
              ) : (
                <div className="divide-y border rounded-xl overflow-hidden">
                  {branches.map((b) => (
                    <div
                      key={b.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate">{b.name}</span>
                          <Badge variant="outline" className="text-xs gap-1 bg-primary/5 text-primary border-primary/20">
                            <Navigation className="h-3 w-3" />
                            {b.service_radius_km || 5.0} km radius
                          </Badge>
                          {b.is_accepting_orders ? (
                            <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600 bg-emerald-500/10">
                              Accepting orders
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 bg-amber-500/10">
                              Paused
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
                          {b.address || "Address not specified"}
                        </p>
                        {b.members && b.members.length > 0 && (
                          <p className="text-xs text-muted-foreground/80">
                            Manager: <span className="font-medium text-foreground">{b.members[0].full_name || b.members[0].email}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="flex items-center gap-2 mr-1">
                          <Label htmlFor={`order-toggle-${b.id}`} className="text-xs text-muted-foreground hidden sm:inline">
                            Accept Orders
                          </Label>
                          <Switch
                            id={`order-toggle-${b.id}`}
                            checked={b.is_accepting_orders ?? true}
                            onCheckedChange={(checked) => handleToggleBranchOrders(b.id, checked)}
                          />
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/branch-portal/${b.id}`}>
                            Branch Portal
                            <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Pricing & ordering
              </CardTitle>
              <CardDescription>From restaurant settings</CardDescription>
            </CardHeader>
            <CardContent>
              {settings ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Metric label="Currency" value={settings.currency} />
                  <Metric label="Tax rate" value={`${settings.tax_rate}%`} />
                  <Metric label="Delivery fee" value={formatCurrency(settings.delivery_fee, currency)} />
                  <Metric label="Minimum order" value={formatCurrency(settings.min_order_amount, currency)} />
                  <Metric label="Store status" value={settings.is_open ? "Open" : "Closed"} />
                  <Metric label="Add-ons" value={String(stats?.addons ?? 0)} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No settings record yet. Configure pricing in restaurant settings.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Opening hours
                </CardTitle>
                <CardDescription>
                  {editingHours ? "Add time slots per day. Leave a day empty to mark it closed." : "Weekly schedule for this restaurant"}
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {editingHours ? (
                  <>
                    <Button variant="outline" size="sm" onClick={cancelEditHours} disabled={savingHours}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveHours()} disabled={savingHours}>
                      {savingHours ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save hours"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={beginEditHours}>
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit hours
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className={editingHours ? "space-y-6" : "p-0"}>
              {editingHours ? (
                DAYS.map((dayName, dayIdx) => {
                  const daySlots = hours.filter((h) => h.day_of_week === dayIdx);
                  return (
                    <div key={dayIdx} className="space-y-3 pb-4 border-b last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">{dayName}</Label>
                        <Button variant="outline" size="sm" onClick={() => addHourSlot(dayIdx)} className="h-8">
                          <Plus className="h-4 w-4 mr-1" />
                          Add slot
                        </Button>
                      </div>
                      {daySlots.length === 0 ? (
                        <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center">
                          <p className="text-xs text-muted-foreground">Closed all day — click Add slot to set hours</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {hours.map((h, globalIdx) => {
                            if (h.day_of_week !== dayIdx) return null;
                            return (
                              <div
                                key={`${dayIdx}-${globalIdx}`}
                                className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                              >
                                <div className="flex-1 grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <span className="text-[10px] uppercase font-semibold text-muted-foreground ml-0.5">
                                      Open
                                    </span>
                                    <Input
                                      type="time"
                                      value={h.open_time}
                                      onChange={(e) => updateHourSlot(globalIdx, { open_time: e.target.value })}
                                      className="h-9"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-[10px] uppercase font-semibold text-muted-foreground ml-0.5">
                                      Close
                                    </span>
                                    <Input
                                      type="time"
                                      value={h.close_time}
                                      onChange={(e) => updateHourSlot(globalIdx, { close_time: e.target.value })}
                                      className="h-9"
                                    />
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-destructive hover:bg-destructive/10 flex-shrink-0"
                                  onClick={() => removeHourSlot(globalIdx)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : hours.length === 0 ? (
                <div className="px-6 pb-6 space-y-3">
                  <p className="text-sm text-muted-foreground">No hours configured yet.</p>
                  <Button variant="outline" size="sm" onClick={beginEditHours}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Set opening hours
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DAYS.map((dayName, dayIndex) => {
                      const slots = hoursByDay.get(dayIndex) ?? [];
                      const allClosed = slots.length > 0 && slots.every((s) => s.is_closed);
                      const hoursLabel = !slots.length
                        ? "—"
                        : allClosed
                          ? "Closed"
                          : slots
                              .filter((s) => !s.is_closed)
                              .map((s) => `${formatTime(s.open_time)} – ${formatTime(s.close_time)}`)
                              .join(", ") || "Closed";

                      return (
                        <TableRow key={dayName}>
                          <TableCell className="font-medium">{dayName}</TableCell>
                          <TableCell className={!slots.length ? "text-muted-foreground" : ""}>{hoursLabel}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={!slots.length ? "secondary" : allClosed ? "secondary" : "outline"}
                              className={slots.length && !allClosed ? "border-green-500/40 text-green-700" : ""}
                            >
                              {!slots.length ? "Not set" : allClosed ? "Closed" : "Open"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Voice & AI agent
              </CardTitle>
              <CardDescription>Telnyx/Synthflow (recommended) or Twilio/ElevenLabs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <IntegrationStatus
                  label="Telnyx"
                  connected={Boolean(restaurant.telnyx_phone_number)}
                  detail={restaurant.telnyx_phone_number || "Not assigned"}
                  connectedAt={null}
                />
                <IntegrationStatus
                  label="Synthflow"
                  connected={Boolean(restaurant.synthflow_agent_id)}
                  detail={restaurant.synthflow_agent_id ? truncateId(restaurant.synthflow_agent_id, 16) : "No agent"}
                  connectedAt={restaurant.synthflow_synced_at}
                />
                <IntegrationStatus
                  label="Twilio"
                  connected={twilioConnected}
                  detail={restaurant.twilio_phone_number || "Not connected"}
                  connectedAt={restaurant.twilio_connected_at}
                />
                <IntegrationStatus
                  label="ElevenLabs"
                  connected={agentConnected}
                  detail={restaurant.elevenlabs_agent_id ? truncateId(restaurant.elevenlabs_agent_id, 16) : "No agent"}
                  connectedAt={restaurant.elevenlabs_connected_at}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <InfoRow
                  icon={Bot}
                  label="Agent language"
                  value={LANGUAGE_LABELS[restaurant.agent_language ?? ""] ?? restaurant.agent_language ?? "—"}
                />
                <InfoRow icon={Bot} label="Voice ID" value={restaurant.agent_voice_id || "—"} mono />
                <InfoRow
                  icon={CalendarClock}
                  label="Menu last synced"
                  value={formatDate(restaurant.agent_menu_synced_at)}
                  className="sm:col-span-2"
                />
              </div>
              {restaurant.agent_first_message && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-1">First message</p>
                  <p className="text-foreground">{restaurant.agent_first_message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-primary" />
                  Recent orders
                </CardTitle>
                <CardDescription>Latest orders for this restaurant</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/orders">
                  View all
                  <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 pb-6">No orders yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((o) => {
                      const status = o.status as OrderStatus;
                      return (
                        <TableRow key={o.id}>
                          <TableCell>
                            <div className="font-medium">{o.order_number}</div>
                            <div className="text-xs text-muted-foreground">{formatDate(o.created_at)}</div>
                          </TableCell>
                          <TableCell>{o.customer_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ORDER_STATUS_COLORS[status] ?? ""}>
                              {ORDER_STATUS_LABELS[status] ?? o.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(o.total_amount, currency)}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                              <Link to={`/orders/${o.id}`}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                Fulfillment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FulfillmentRow label="Delivery" enabled={restaurant.allows_delivery} />
              <FulfillmentRow label="Self pickup" enabled={restaurant.allows_pickup} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ChefHat className="h-5 w-5 text-primary" />
                Cuisines
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cuisines.length ? (
                <div className="flex flex-wrap gap-2">
                  {cuisines.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No cuisines linked.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Team
              </CardTitle>
              <CardDescription>Restaurant members & owners</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 pb-6">No members assigned.</p>
              ) : (
                <div className="divide-y">
                  {members.map((m) => (
                    <div key={m.email} className="px-6 py-3 flex items-start gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{m.full_name || m.email}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                        <Badge variant="outline" className="mt-1.5 text-[10px] capitalize">
                          {m.member_role}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Catalog summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <SummaryRow label="Menu categories" value={stats?.categories ?? 0} />
              <SummaryRow label="Menu items" value={stats?.items ?? 0} />
              <SummaryRow label="Add-ons" value={stats?.addons ?? 0} />
              <SummaryRow label="Deals" value={stats?.deals ?? 0} />
              <SummaryRow label="Coupon codes" value={stats?.coupons ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" className="justify-start" asChild>
                <Link to={`/restaurants/${restaurant.id}/configuration`}>
                  <Settings className="h-4 w-4 mr-2" />
                  Agent & telephony config
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link to="/orders">
                  <ShoppingBag className="h-4 w-4 mr-2" />
                  All orders
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link to="/menu">
                  <ChefHat className="h-4 w-4 mr-2" />
                  Menu management
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link to="/deals">
                  <Tag className="h-4 w-4 mr-2" />
                  Deals & offers
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Branch Modal Dialog */}
      <Dialog open={addBranchOpen} onOpenChange={setAddBranchOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Add New Branch
            </DialogTitle>
            <DialogDescription>
              Create a new physical branch location under {restaurant.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBranch} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Branch Name *</Label>
              <Input
                id="branch-name"
                placeholder="e.g. DHA Phase 5 or Downtown Branch"
                value={branchForm.name}
                onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-address">Physical Address</Label>
              <Input
                id="branch-address"
                placeholder="e.g. Commercial Area, Sector C, DHA"
                value={branchForm.address}
                onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch-radius">Service Radius (km)</Label>
                <Input
                  id="branch-radius"
                  type="number"
                  step="0.5"
                  value={branchForm.service_radius_km}
                  onChange={(e) => setBranchForm({ ...branchForm, service_radius_km: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-phone">Branch Phone</Label>
                <Input
                  id="branch-phone"
                  placeholder="Optional contact phone"
                  value={branchForm.phone}
                  onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch-lat">Latitude (optional)</Label>
                <Input
                  id="branch-lat"
                  placeholder="Auto-geocoded if empty"
                  value={branchForm.latitude}
                  onChange={(e) => setBranchForm({ ...branchForm, latitude: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-lng">Longitude (optional)</Label>
                <Input
                  id="branch-lng"
                  placeholder="Auto-geocoded if empty"
                  value={branchForm.longitude}
                  onChange={(e) => setBranchForm({ ...branchForm, longitude: e.target.value })}
                />
              </div>
            </div>

            <Separator className="my-2" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Branch Manager Account (Optional)
            </p>

            <div className="space-y-2">
              <Label htmlFor="branch-manager-name">Manager Full Name</Label>
              <Input
                id="branch-manager-name"
                placeholder="e.g. John Doe"
                value={branchForm.owner_full_name}
                onChange={(e) => setBranchForm({ ...branchForm, owner_full_name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch-manager-email">Manager Email</Label>
                <Input
                  id="branch-manager-email"
                  type="email"
                  placeholder="manager@branch.com"
                  value={branchForm.owner_email}
                  onChange={(e) => setBranchForm({ ...branchForm, owner_email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-manager-pwd">Temporary Password</Label>
                <Input
                  id="branch-manager-pwd"
                  type="password"
                  placeholder="Min 6 characters"
                  value={branchForm.owner_password}
                  onChange={(e) => setBranchForm({ ...branchForm, owner_password: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setAddBranchOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingBranch} className="gap-2">
                {creatingBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Branch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-xl border border-border/80 shadow-xs overflow-hidden", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-lg font-bold mt-0.5 truncate">{value}</p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3 rounded-lg border bg-muted/20 p-3", className)}>
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-medium break-all", mono && "font-mono text-xs")}>{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3 bg-muted/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function IntegrationStatus({
  label,
  connected,
  detail,
  connectedAt,
}: {
  label: string;
  connected: boolean;
  detail: string;
  connectedAt: string | null;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{label}</p>
        <Badge variant={connected ? "default" : "secondary"}>{connected ? "Connected" : "Not set up"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground font-mono break-all">{detail}</p>
      {connectedAt && (
        <p className="text-xs text-muted-foreground">Since {formatDate(connectedAt)}</p>
      )}
    </div>
  );
}

function FulfillmentRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
      <span className="text-sm font-medium">{label}</span>
      <Badge variant={enabled ? "outline" : "secondary"} className={enabled ? "border-green-500/40 text-green-700" : ""}>
        {enabled ? "Enabled" : "Disabled"}
      </Badge>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
