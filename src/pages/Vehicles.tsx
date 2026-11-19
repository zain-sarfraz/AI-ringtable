import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Car, Pencil, Plus, Trash2, Truck, Bike, Info, Search, Upload, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

interface Vehicle {
  id: string;
  plate_number: string;
  model: string | null;
  vehicle_type: string;
  capacity_kg: number | null;
  status: string;
  notes: string | null;
  image_url: string | null;
}

export default function Vehicles() {
  const { t } = useTranslation(["vehicles", "common"]);
  const { toast } = useToast();
  const { restaurantId } = useActiveRestaurant();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Vehicle | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const load = async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      setVehicles(data as any || []);
    } catch (error: any) {
      toast({ variant: "destructive", title: t("common:error", "Error"), description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [restaurantId]);

  const save = async (form: Partial<Vehicle>) => {
    if (!restaurantId) return;
    const payload = {
      plate_number: form.plate_number || "",
      model: form.model || null,
      vehicle_type: form.vehicle_type || "bike",
      capacity_kg: form.capacity_kg ? Number(form.capacity_kg) : null,
      status: form.status || "available",
      notes: form.notes || null,
      image_url: form.image_url || null,
      restaurant_id: restaurantId,
    };

    const res = edit 
      ? await supabase.from("vehicles").update(payload).eq("id", edit.id) 
      : await supabase.from("vehicles").insert(payload);

    if (res.error) {
      toast({ variant: "destructive", title: t("common:error", "Failed"), description: (res.error as any).message });
    } else {
      toast({ title: t("vehicles:vehicleSaved", "Vehicle saved successfully") });
      setOpen(false);
      setEdit(null);
      load();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'available': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'in_use': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'maintenance': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
  };

  const filteredVehicles = vehicles.filter(v => 
    v.plate_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title={t("vehicles:title", "Vehicles Management")}
        description={t("vehicles:subtitle", "Manage your delivery fleet and vehicle status.")}
        actions={
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto gap-2">
              <Plus className="h-4 w-4" /> {t("vehicles:addVehicle", "Add Vehicle")}
            </Button>
          </DialogTrigger>
          <Form initial={edit} onSubmit={save} />
        </Dialog>
        }
      />

      <div className="flex items-center gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={t("vehicles:searchPlaceholder", "Search by plate number or model...")} 
            className="rounded-xl pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left bg-muted/50">
              <tr>
                <th className="p-3 w-16">{t("vehicles:colImage", "Image")}</th>
                <th className="p-3">{t("vehicles:colPlate", "Plate")}</th>
                <th className="p-3">{t("vehicles:colModel", "Model")}</th>
                <th className="p-3">{t("vehicles:colType", "Type")}</th>
                <th className="p-3 whitespace-nowrap">{t("vehicles:colCapacity", "Capacity (kg)")}</th>
                <th className="p-3">{t("common:status", "Status")}</th>
                <th className="p-3 max-w-[200px]">{t("vehicles:colNotes", "Notes")}</th>
                <th className="p-3 w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-muted-foreground">
                    {t("common:loading", "Loading…")}
                  </td>
                </tr>
              )}
              {!loading &&
                filteredVehicles.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="p-3 align-middle">
                      {v.image_url ? (
                        <img 
                          src={resolveMediaUrl(v.image_url)} 
                          alt={v.plate_number} 
                          className="w-12 h-10 object-cover rounded border bg-muted"
                        />
                      ) : (
                        <div className="w-12 h-10 rounded border bg-muted/50 flex items-center justify-center text-muted-foreground">
                          <Car className="h-5 w-5 opacity-20" />
                        </div>
                      )}
                    </td>
                    <td className="p-3 align-middle font-mono font-medium">{v.plate_number}</td>
                    <td className="p-3 align-middle text-muted-foreground">{v.model || "—"}</td>
                    <td className="p-3 align-middle">
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {v.vehicle_type}
                      </span>
                    </td>
                    <td className="p-3 align-middle tabular-nums">{v.capacity_kg != null ? v.capacity_kg : "—"}</td>
                    <td className="p-3 align-middle">
                      <Badge variant="outline" className={getStatusColor(v.status)}>
                        {v.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-3 align-middle text-muted-foreground max-w-[220px] truncate" title={v.notes || undefined}>
                      {v.notes || "—"}
                    </td>
                    <td className="p-2 align-middle">
                      <Button size="sm" variant="ghost" onClick={() => { setEdit(v); setOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={async () => {
                          if (confirm(t("vehicles:deleteConfirm", "Are you sure you want to delete this vehicle?"))) {
                            await supabase.from("vehicles").delete().eq("id", v.id);
                            load();
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              {!loading && filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted-foreground">
                    <Car className="h-8 w-8 mx-auto mb-3 opacity-50" />
                    <p className="font-medium text-foreground">{t("vehicles:noVehiclesFound", "No vehicles found")}</p>
                    <p className="text-sm mt-1">{t("vehicles:noVehiclesSub", "Add your first delivery vehicle to get started.")}</p>
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

function Form({ initial, onSubmit }: { initial: Vehicle | null; onSubmit: (f: Partial<Vehicle>) => void }) {
  const { t } = useTranslation(["vehicles", "common"]);
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Vehicle>>(initial || { plate_number: "", vehicle_type: "bike", status: "available" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { 
    setForm(initial || { plate_number: "", vehicle_type: "bike", status: "available" }); 
    setImageFile(null);
    setPreview(null);
  }, [initial]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ variant: "destructive", title: t("common:error", "File too large"), description: "Maximum size is 5MB." });
        return;
      }
      setImageFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    setUploading(true);
    try {
      let image_url = form.image_url || null;
      if (imageFile) {
        const formData = new FormData();
        formData.append("file", imageFile);
        const token = getToken();
        const res = await fetch(`${getApiBase()}/api/media/upload`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        });
        if (!res.ok) throw new Error("Image upload failed");
        const json = await res.json();
        image_url = json.url;
      }
      onSubmit({ ...form, image_url });
    } catch (e: any) {
      toast({ variant: "destructive", title: t("common:error", "Upload error"), description: e.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? t("vehicles:editVehicle", "Edit Vehicle") : t("vehicles:addVehicle", "Add Vehicle")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>{t("vehicles:colImage", "Vehicle Image")}</Label>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-16 rounded border bg-muted/30 overflow-hidden flex items-center justify-center">
              {preview ? (
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              ) : form.image_url ? (
                <img src={resolveMediaUrl(form.image_url)} alt="Vehicle" className="w-full h-full object-cover" />
              ) : (
                <Car className="h-6 w-6 text-muted-foreground opacity-40" />
              )}
              {(preview || form.image_url) && (
                <button
                  type="button"
                  onClick={() => { setImageFile(null); setPreview(null); setForm(f => ({ ...f, image_url: null })); }}
                  className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <label className="cursor-pointer border border-dashed hover:border-primary/50 text-xs px-3 py-2 rounded flex items-center gap-1.5 transition-colors">
              <Upload className="h-3.5 w-3.5" />
              <span>{preview || form.image_url ? t("common:change", "Change") : t("common:upload", "Upload")}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t("vehicles:colPlate", "Plate Number")} *</Label>
            <Input 
              placeholder="e.g. ABC-123" 
              value={form.plate_number || ""} 
              onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} 
            />
          </div>
          <div className="space-y-1">
            <Label>{t("vehicles:colModel", "Model")}</Label>
            <Input 
              placeholder="e.g. Honda Civic" 
              value={form.model || ""} 
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))} 
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t("vehicles:colType", "Vehicle Type")}</Label>
            <Select 
              value={form.vehicle_type || "bike"} 
              onValueChange={v => setForm(f => ({ ...f, vehicle_type: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bike">{t("vehicles:bike", "Bike / Scooter")}</SelectItem>
                <SelectItem value="car">{t("vehicles:car", "Car")}</SelectItem>
                <SelectItem value="van">{t("vehicles:van", "Van")}</SelectItem>
                <SelectItem value="truck">{t("vehicles:truck", "Truck")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("vehicles:colCapacity", "Capacity (kg)")}</Label>
            <Input 
              type="number" 
              placeholder="e.g. 50" 
              value={form.capacity_kg || ""} 
              onChange={e => setForm(f => ({ ...f, capacity_kg: parseFloat(e.target.value) || null }))} 
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>{t("common:status", "Status")}</Label>
          <Select 
            value={form.status || "available"} 
            onValueChange={v => setForm(f => ({ ...f, status: v }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">{t("common:available", "Available")}</SelectItem>
              <SelectItem value="in_use">{t("common:inUse", "In Use")}</SelectItem>
              <SelectItem value="maintenance">{t("vehicles:maintenance", "Maintenance")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>{t("vehicles:colNotes", "Notes")}</Label>
          <Input 
            placeholder="e.g. Needs oil change soon" 
            value={form.notes || ""} 
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} 
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={handleSave} disabled={uploading || !form.plate_number?.trim()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {initial ? t("common:saveChanges", "Save Changes") : t("vehicles:addVehicle", "Add Vehicle")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}