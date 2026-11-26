import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Phone,
  MapPin,
  Clock,
  Loader2,
  CheckCircle2,
  Save,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

interface BranchDetails {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  area: string | null;
  is_accepting_orders: boolean;
  is_active: boolean;
}

export default function MyBranch() {
  const { t } = useTranslation(["common", "restaurants", "settings"]);
  const { activeRestaurant, refreshRestaurants } = useActiveRestaurant();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branch, setBranch] = useState<BranchDetails | null>(null);

  // Editable fields: name, phone, address, city, area, is_accepting_orders
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [isAcceptingOrders, setIsAcceptingOrders] = useState(true);

  const branchId = activeRestaurant?.id;

  const loadBranch = useCallback(async () => {
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/branches/${branchId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to load branch details");
      }
      const data = (await res.json()) as { branch: BranchDetails };
      const b = data.branch;
      setBranch(b);
      setName(b.name || "");
      setPhone(b.phone || "");
      setAddress(b.address || "");
      setCity(b.city || "");
      setArea(b.area || "");
      setIsAcceptingOrders(Boolean(b.is_accepting_orders));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load branch details";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    loadBranch();
  }, [loadBranch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) return;
    if (!name.trim()) {
      toast.error("Branch name is required");
      return;
    }

    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/branches/${branchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          area: area.trim() || null,
          is_accepting_orders: isAcceptingOrders,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to update branch");
      }

      toast.success("Branch details updated successfully!");
      await refreshRestaurants();
      await loadBranch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update branch";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageShell maxWidth="lg">
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-2" />
          <p className="text-sm">Loading branch details...</p>
        </div>
      </PageShell>
    );
  }

  if (!branchId) {
    return (
      <PageShell maxWidth="lg">
        <Card className="rounded-2xl border border-border/80">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Store className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-semibold text-foreground">No Active Branch Selected</p>
            <p className="text-sm mt-1">Please select your branch from the restaurant switcher.</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title={t("restaurants:myBranch", "My Branch")}
        description="Manage your branch details, contact information, and operating status"
        actions={
          <Badge
            variant="outline"
            className={
              isAcceptingOrders
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 py-1 px-3"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 gap-1.5 py-1 px-3"
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isAcceptingOrders ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
            {isAcceptingOrders ? "Open / Accepting Orders" : "Closed / Paused"}
          </Badge>
        }
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core Branch Details */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-4 border-b border-border/40">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Branch Information
            </CardTitle>
            <CardDescription className="text-xs">
              Basic identification and contact details for your assigned branch
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="branch-name" className="text-xs font-semibold">
                  Branch Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="branch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Downtown Branch"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch-phone" className="text-xs font-semibold">
                  Contact Phone
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="branch-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555-0199"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-address" className="text-xs font-semibold">
                Street Address
              </Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="branch-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, Suite 100"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="branch-city" className="text-xs font-semibold">
                  City
                </Label>
                <Input
                  id="branch-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. New York"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch-area" className="text-xs font-semibold">
                  Area / Neighborhood
                </Label>
                <Input
                  id="branch-area"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Manhattan / Soho"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Operating Hours / Order Status */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-4 border-b border-border/40">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Opening & Order Status
            </CardTitle>
            <CardDescription className="text-xs">
              Control whether this branch is actively accepting orders from customers
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/70 bg-muted/20">
              <div className="space-y-0.5">
                <Label htmlFor="accept-orders-switch" className="text-sm font-semibold cursor-pointer">
                  Accept Incoming Orders
                </Label>
                <p className="text-xs text-muted-foreground">
                  When toggled off, customers and phone agent cannot place new orders for this branch.
                </p>
              </div>
              <Switch
                id="accept-orders-switch"
                checked={isAcceptingOrders}
                onCheckedChange={setIsAcceptingOrders}
              />
            </div>
          </CardContent>
        </Card>

        {/* Action Button */}
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={saving} className="gap-2 px-6">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
