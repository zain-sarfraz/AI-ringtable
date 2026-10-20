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
import { Boxes, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";

interface Supplier {
  id: string;
  name: string;
}

interface RawMaterial {
  id?: string;
  name: string;
  sku?: string | null;
  unit: string;
  cost_price: number;
  current_stock: number;
  minimum_stock: number;
  supplier_id?: string | null;
  notes?: string | null;
  status?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  material: RawMaterial | null;
  suppliers: Supplier[];
  onSaved: () => void;
}

const COMMON_UNITS = [
  { label: "Kilograms (kg)", value: "kg" },
  { label: "Grams (g)", value: "grams" },
  { label: "Liters (L)", value: "liters" },
  { label: "Milliliters (ml)", value: "ml" },
  { label: "Pieces / Units (pcs)", value: "pcs" },
  { label: "Packs / Boxes (packs)", value: "packs" },
  { label: "Slices (slices)", value: "slices" },
  { label: "Bottles / Cans (cans)", value: "cans" },
];

export function PosRawMaterialDialog({
  open,
  onOpenChange,
  restaurantId,
  material,
  suppliers,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("kg");
  const [costPrice, setCostPrice] = useState("0");
  const [currentStock, setCurrentStock] = useState("0");
  const [minimumStock, setMinimumStock] = useState("5");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (material) {
      setName(material.name || "");
      setSku(material.sku || "");
      setUnit(material.unit || "kg");
      setCostPrice(String(material.cost_price ?? 0));
      setCurrentStock(String(material.current_stock ?? 0));
      setMinimumStock(String(material.minimum_stock ?? 5));
      setSupplierId(material.supplier_id || "");
      setNotes(material.notes || "");
    } else {
      setName("");
      setSku("");
      setUnit("kg");
      setCostPrice("0");
      setCurrentStock("0");
      setMinimumStock("5");
      setSupplierId("");
      setNotes("");
    }
  }, [material, open]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name Required", description: "Enter raw material item name." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/raw-materials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          id: material?.id,
          restaurant_id: restaurantId,
          name: name.trim(),
          sku: sku.trim() || undefined,
          unit,
          cost_price: parseFloat(costPrice) || 0,
          current_stock: parseFloat(currentStock) || 0,
          minimum_stock: parseFloat(minimumStock) || 0,
          supplier_id: supplierId || null,
          notes: notes.trim() || null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save raw material");

      toast({
        title: "✅ Raw Material Saved",
        description: `${name} has been ${material?.id ? "updated" : "added to inventory"}.`,
      });

      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save raw material";
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
      <DialogContent className="max-w-md p-0 overflow-hidden bg-background">
        <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            {material?.id ? "Edit Raw Material" : "Add New Raw Material"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Raw ingredients used to prepare food items (e.g., Chicken, Flour, Buns, Oil, Packaging).
          </p>
        </DialogHeader>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Material Name *</Label>
            <Input
              placeholder="e.g. Chicken Breast, Brioche Bun, Mozzarella"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Unit of Measure *</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Cost Price (per unit)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {material?.id ? "Current Stock Level" : "Initial Stock Level"}
              </Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Low Stock Alert Level</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Optional supplier..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">SKU / Code (Optional)</Label>
              <Input
                placeholder="e.g. RAW-101"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes</Label>
            <Input
              placeholder="e.g. Keep frozen below -18C, preferred brand"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-8 text-xs"
            />
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
            disabled={submitting || !name.trim()}
            className="h-8 text-xs font-semibold gradient-primary"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {material?.id ? "Update Material" : "Save Material"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
