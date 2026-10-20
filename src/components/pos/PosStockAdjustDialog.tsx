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
import { ArrowDownUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  item: {
    id: string;
    name: string;
    unit: string;
    current_stock: number;
  } | null;
  onAdjusted: () => void;
}

export function PosStockAdjustDialog({ open, onOpenChange, restaurantId, item, onAdjusted }: Props) {
  const { toast } = useToast();
  const [adjustmentType, setAdjustmentType] = useState<"increase" | "decrease">("decrease");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Spoilage / Waste");
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!item) return null;

  const handleSubmit = async () => {
    const qtyNum = parseFloat(quantity) || 0;
    if (qtyNum <= 0) {
      toast({ variant: "destructive", title: "Invalid Quantity", description: "Enter quantity greater than 0." });
      return;
    }

    const effectiveReason = reason === "Other" ? (customReason.trim() || "Manual adjustment") : reason;

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/raw-materials/${item.id}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          adjustment_type: adjustmentType,
          quantity: qtyNum,
          reason: effectiveReason,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to adjust stock");

      toast({
        title: "✅ Stock Adjusted",
        description: `${item.name} stock updated. New stock: ${body.new_stock} ${item.unit}.`,
      });

      onOpenChange(false);
      onAdjusted();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to adjust stock";
      toast({
        variant: "destructive",
        title: "Adjustment Failed",
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden bg-background">
        <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <ArrowDownUp className="h-4 w-4 text-primary" />
            Adjust Stock: {item.name}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Current Stock: <strong className="text-foreground">{item.current_stock} {item.unit}</strong>
          </p>
        </DialogHeader>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Adjustment Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={adjustmentType === "decrease" ? "destructive" : "outline"}
                size="sm"
                className="h-8 text-xs font-semibold"
                onClick={() => setAdjustmentType("decrease")}
              >
                − Deduct / Waste
              </Button>
              <Button
                type="button"
                variant={adjustmentType === "increase" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-semibold"
                onClick={() => setAdjustmentType("increase")}
              >
                + Add / Refill
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Quantity ({item.unit})</Label>
            <Input
              type="number"
              step="any"
              min="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Spoilage / Waste">Spoilage / Kitchen Waste</SelectItem>
                <SelectItem value="Damaged / Expired">Damaged / Expired Goods</SelectItem>
                <SelectItem value="Inventory Count Correction">Physical Audit / Recount</SelectItem>
                <SelectItem value="Staff Meal / Internal Use">Staff Meal / Internal Use</SelectItem>
                <SelectItem value="Other">Other Reason</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reason === "Other" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Specify Reason</Label>
              <Input
                placeholder="Enter explanation..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}
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
            disabled={submitting || parseFloat(quantity) <= 0}
            className="h-8 text-xs font-semibold gradient-primary"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Confirm Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
