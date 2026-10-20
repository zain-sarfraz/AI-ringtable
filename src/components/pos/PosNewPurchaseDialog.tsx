import { useState } from "react";
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
import { Plus, Trash2, Loader2, ShoppingCart } from "lucide-react";
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

interface Supplier {
  id: string;
  name: string;
  company_name?: string | null;
}

interface PurchaseLine {
  inventory_item_id: string;
  quantity: number;
  unit_price: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  rawMaterials: RawMaterial[];
  suppliers: Supplier[];
  onPurchaseCreated: () => void;
  onOpenAddSupplier?: () => void;
  onOpenAddMaterial?: () => void;
}

export function PosNewPurchaseDialog({
  open,
  onOpenChange,
  restaurantId,
  rawMaterials,
  suppliers,
  onPurchaseCreated,
  onOpenAddSupplier,
  onOpenAddMaterial,
}: Props) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [status, setStatus] = useState<"received" | "pending">("received");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([
    { inventory_item_id: "", quantity: 1, unit_price: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const addLine = () => {
    setLines([...lines, { inventory_item_id: "", quantity: 1, unit_price: 0 }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length === 1) {
      setLines([{ inventory_item_id: "", quantity: 1, unit_price: 0 }]);
      return;
    }
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, patch: Partial<PurchaseLine>) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        const updated = { ...line, ...patch };
        if (patch.inventory_item_id) {
          const mat = rawMaterials.find((m) => m.id === patch.inventory_item_id);
          if (mat && (!line.unit_price || line.unit_price === 0)) {
            updated.unit_price = Number(mat.cost_price || 0);
          }
        }
        return updated;
      })
    );
  };

  const totalAmount = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
    0
  );

  const handleSubmit = async () => {
    if (!supplierId) {
      toast({ variant: "destructive", title: "Supplier Required", description: "Please select a supplier." });
      return;
    }
    const validLines = lines.filter((l) => l.inventory_item_id && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      toast({ variant: "destructive", title: "No Items", description: "Please add at least one raw material." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/purchases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          supplier_id: supplierId,
          purchase_date: purchaseDate,
          status,
          notes,
          items: validLines,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to record purchase");

      toast({
        title: "✅ Purchase Recorded",
        description: `Successfully added purchase of ${formatCurrency(totalAmount)}. Raw material stock updated!`,
      });

      onOpenChange(false);
      onPurchaseCreated();
      // Reset form
      setLines([{ inventory_item_id: "", quantity: 1, unit_price: 0 }]);
      setNotes("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save purchase";
      toast({
        variant: "destructive",
        title: "Error Recording Purchase",
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
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Record Raw Material Purchase
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Enter incoming raw materials from suppliers. Stock will automatically be replenished upon receipt.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Top row: Supplier & Date & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Supplier *</Label>
                {onOpenAddSupplier && (
                  <button
                    type="button"
                    onClick={onOpenAddSupplier}
                    className="text-[10px] text-primary hover:underline font-medium"
                  >
                    + New Supplier
                  </button>
                )}
              </div>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} {s.company_name ? `(${s.company_name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Purchase Date</Label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Stock Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "received" | "pending")}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Received (Add to Stock)</SelectItem>
                  <SelectItem value="pending">Pending Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Line items section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Raw Materials Line Items
              </Label>
              {onOpenAddMaterial && (
                <button
                  type="button"
                  onClick={onOpenAddMaterial}
                  className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add New Material Item
                </button>
              )}
            </div>

            <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-card">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                <div className="col-span-5">Raw Material</div>
                <div className="col-span-2 text-center">Qty & Unit</div>
                <div className="col-span-2 text-right">Cost Price</div>
                <div className="col-span-2 text-right">Line Total</div>
                <div className="col-span-1 text-center"></div>
              </div>

              {lines.map((line, idx) => {
                const selectedMaterial = rawMaterials.find((m) => m.id === line.inventory_item_id);
                const lineTotal = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);

                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center text-xs">
                    <div className="col-span-5">
                      <Select
                        value={line.inventory_item_id}
                        onValueChange={(val) => updateLine(idx, { inventory_item_id: val })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Pick raw material..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {rawMaterials.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name} ({m.unit}) · Stock: {m.current_stock}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-2 flex items-center gap-1">
                      <Input
                        type="number"
                        min="0.01"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs text-center"
                      />
                      <span className="text-[10px] text-muted-foreground w-6 truncate">
                        {selectedMaterial?.unit || ""}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) => updateLine(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs text-right"
                      />
                    </div>

                    <div className="col-span-2 text-right font-bold text-foreground">
                      {formatCurrency(lineTotal)}
                    </div>

                    <div className="col-span-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(idx)}
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
                  onClick={addLine}
                  className="h-7 text-xs gap-1 border-dashed"
                >
                  <Plus className="h-3 w-3" /> Add Another Item
                </Button>

                <div className="flex items-center gap-2 text-sm font-bold">
                  <span className="text-muted-foreground text-xs uppercase font-semibold">Total Cost:</span>
                  <span className="text-primary text-base font-extrabold">{formatCurrency(totalAmount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes / Invoice Ref #</Label>
            <Input
              placeholder="e.g. Inv #9812, weekly meat delivery, checked by Chef"
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
            className="h-9 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || totalAmount <= 0}
            className="h-9 text-xs font-semibold gap-1.5 gradient-primary"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {submitting ? "Saving Purchase..." : "Confirm & Record Purchase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
