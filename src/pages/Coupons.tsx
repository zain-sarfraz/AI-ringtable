import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogBody } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Ticket, Trash2, Search, Calendar, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/restaurant";
import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { DealsImportButton } from "@/components/deals/DealsImportButton";
import { syncRestaurantMenuToVoiceAgent } from "@/lib/syncRestaurantMenuToVoiceAgent";
import { cn } from "@/lib/utils";

interface Discount { 
  id: string; 
  code: string; 
  description: string | null; 
  discount_type: string; 
  discount_value: number; 
  min_order_amount: number; 
  max_uses: number | null; 
  used_count: number; 
  starts_at: string | null; 
  ends_at: string | null; 
  is_active: boolean;
  restaurant_id: string;
}

export default function Coupons() {
  const { t } = useTranslation(["coupons", "common"]);
  const { toast } = useToast();
  const { restaurantId, loading: activeRestaurantLoading } = useActiveRestaurant();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [discDialog, setDiscDialog] = useState(false);
  const [editDisc, setEditDisc] = useState<Discount | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(async () => {
    if (!restaurantId) return;
    const { data, error } = await supabase
      .from("discounts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ variant: "destructive", title: t("common:error", "Failed to load"), description: error.message });
      return;
    }
    setDiscounts(data as Discount[]);
  }, [restaurantId, t, toast]);

  useEffect(() => {
    if (activeRestaurantLoading) return;
    if (!restaurantId) {
      setDiscounts([]);
      return;
    }
    void load();
  }, [restaurantId, activeRestaurantLoading, load]);

  const saveDiscount = async (form: Partial<Discount>) => {
    if (!restaurantId) return;
    const payload = {
      code: (form.code || "").toUpperCase(),
      description: form.description || null,
      discount_type: form.discount_type || "percentage",
      discount_value: Number(form.discount_value) || 0,
      min_order_amount: Number(form.min_order_amount) || 0,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      is_active: form.is_active ?? true,
      restaurant_id: restaurantId,
    };

    const res = editDisc 
      ? await supabase.from("discounts").update(payload).eq("id", editDisc.id) 
      : await supabase.from("discounts").insert(payload);

    if (res.error) {
      toast({ variant: "destructive", title: t("common:error", "Failed to save"), description: res.error.message });
    } else {
      toast({ title: t("coupons:couponSaved", "Discount code saved successfully") });
      setDiscDialog(false);
      setEditDisc(null);
      load();
      if (restaurantId) void syncRestaurantMenuToVoiceAgent(restaurantId);
    }
  };

  const deleteDiscount = async (id: string) => {
    if (!confirm(t("coupons:deleteConfirm", "Are you sure you want to delete this coupon?"))) return;
    const { error } = await supabase.from("discounts").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: t("common:error", "Delete failed"), description: error.message });
    } else {
      toast({ title: t("coupons:couponDeleted", "Coupon deleted") });
      load();
      if (restaurantId) void syncRestaurantMenuToVoiceAgent(restaurantId);
    }
  };

  const filteredDiscounts = discounts.filter(d => 
    d.code.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (activeRestaurantLoading) {
    return <p className="text-muted-foreground p-8">Loading coupons...</p>;
  }

  if (!restaurantId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-muted-foreground m-6">
        <p className="font-medium text-foreground">No restaurant selected</p>
        <p className="text-sm mt-1">Select a restaurant to manage coupon codes.</p>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("coupons:title", "Coupon Codes")}
        description={t("coupons:subtitle", "Manage promotional discounts and vouchers")}
        icon={<Ticket className="h-5 w-5" />}
        actions={
          <>
            <DealsImportButton restaurantId={restaurantId} type="discounts" onImported={() => void load()} />
            <Dialog open={discDialog} onOpenChange={(o) => { setDiscDialog(o); if (!o) setEditDisc(null); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditDisc(null)} className="gradient-primary w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-1" /> {t("coupons:newCoupon", "New Coupon")}
                </Button>
              </DialogTrigger>
              <DiscountForm initial={editDisc} onSubmit={saveDiscount} />
            </Dialog>
          </>
        }
      />

      <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder={t("coupons:searchCouponsPlaceholder", "Search coupons...")}
              className="pl-10" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-y">
                <tr>
                  <th className="px-6 py-4">{t("coupons:colCode", "Code")}</th>
                  <th className="px-6 py-4">{t("coupons:colType", "Type")}</th>
                  <th className="px-6 py-4 text-right">{t("coupons:colValue", "Value")}</th>
                  <th className="px-6 py-4 text-right">{t("coupons:colMinOrder", "Min Order")}</th>
                  <th className="px-6 py-4 text-center">{t("coupons:colUsage", "Usage")}</th>
                  <th className="px-6 py-4">{t("common:status", "Status")}</th>
                  <th className="px-6 py-4 text-right">{t("common:actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredDiscounts.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          <Ticket className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground tracking-wider font-mono">{d.code}</p>
                          {d.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{d.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 capitalize">{d.discount_type === "percentage" ? t("coupons:percentage", "Percentage") : t("coupons:fixedAmount", "Fixed Amount")}</td>
                    <td className="px-6 py-4 text-right font-bold">
                      {d.discount_type === "percentage" ? `${d.discount_value}%` : formatCurrency(d.discount_value)}
                    </td>
                    <td className="px-6 py-4 text-right text-muted-foreground">
                      {formatCurrency(d.min_order_amount)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium">
                        {d.used_count} {d.max_uses ? `/ ${d.max_uses}` : t("coupons:uses", "uses")}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {d.is_active ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">{t("common:active", "Active")}</Badge>
                      ) : (
                        <Badge variant="secondary" className="opacity-60">{t("common:disabled", "Disabled")}</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                          onClick={() => { 
                            setEditDisc(d); 
                            setDiscDialog(true); 
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={() => deleteDiscount(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDiscounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <Ticket className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-20" />
                      <p className="text-lg font-medium text-foreground">{t("coupons:noCouponsFound", "No coupons found")}</p>
                      <p className="text-sm text-muted-foreground mt-1">{t("coupons:noCouponsSub", "Create your first discount code to boost sales.")}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function DiscountForm({ initial, onSubmit }: { initial: Discount | null; onSubmit: (f: Partial<Discount>) => void }) {
  const { t } = useTranslation(["coupons", "common"]);
  const [form, setForm] = useState<Partial<Discount>>(
    initial || { code: "", discount_type: "percentage", discount_value: 0, min_order_amount: 0, is_active: true }
  );

  useEffect(() => {
    setForm(initial || { code: "", discount_type: "percentage", discount_value: 0, min_order_amount: 0, is_active: true });
  }, [initial]);

  return (
    <DialogContent className="max-w-lg sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{initial ? t("coupons:editCoupon", "Edit Coupon") : t("coupons:createCoupon", "Create Coupon")}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code" className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" /> {t("coupons:couponCode", "Coupon Code")}
          </Label>
          <Input 
            id="code" 
            placeholder="e.g. WELCOME50" 
            className="font-mono font-bold uppercase tracking-widest"
            value={form.code || ""} 
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} 
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="desc">{t("common:description", "Description")} ({t("common:optional", "Optional")})</Label>
          <Textarea 
            id="desc" 
            placeholder={t("coupons:descriptionPlaceholder", "e.g. 50% off on first order")} 
            value={form.description || ""} 
            onChange={(e) => setForm({ ...form, description: e.target.value })} 
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("coupons:discountType", "Discount Type")}</Label>
            <Select value={form.discount_type || "percentage"} onValueChange={(v) => setForm({ ...form, discount_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">{t("coupons:percentage", "Percentage (%)")}</SelectItem>
                <SelectItem value="fixed">{t("coupons:fixedAmount", "Fixed Amount ($)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("coupons:value", "Value")}</Label>
            <Input 
              type="number" 
              value={form.discount_value || ""} 
              onChange={(e) => setForm({ ...form, discount_value: parseFloat(e.target.value) || 0 })} 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("coupons:minOrderAmount", "Min. Order Amount")}</Label>
            <Input 
              type="number" 
              value={form.min_order_amount || ""} 
              onChange={(e) => setForm({ ...form, min_order_amount: parseFloat(e.target.value) || 0 })} 
            />
          </div>
          <div className="space-y-2">
            <Label>{t("coupons:maxUses", "Max Uses")} ({t("common:optional", "Optional")})</Label>
            <Input 
              type="number" 
              placeholder={t("coupons:noLimit", "No limit")}
              value={form.max_uses || ""} 
              onChange={(e) => setForm({ ...form, max_uses: parseInt(e.target.value) || null })} 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {t("coupons:startsAt", "Starts At")}</Label>
            <Input 
              type="datetime-local" 
              value={form.starts_at ? form.starts_at.slice(0, 16) : ""} 
              onChange={(e) => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} 
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {t("coupons:endsAt", "Ends At")}</Label>
            <Input 
              type="datetime-local" 
              value={form.ends_at ? form.ends_at.slice(0, 16) : ""} 
              onChange={(e) => setForm({ ...form, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} 
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
          <Label htmlFor="active" className="cursor-pointer">{t("coupons:activeAndRedeemable", "Active and Redeemable")}</Label>
          <Switch 
            id="active" 
            checked={form.is_active ?? true} 
            onCheckedChange={(c) => setForm({ ...form, is_active: c })} 
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onSubmit(form)} className="w-full sm:w-auto">
          {initial ? t("common:saveChanges", "Save Changes") : t("coupons:createCoupon", "Create Coupon")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
