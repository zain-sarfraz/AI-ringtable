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
import { Truck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  onSaved: () => void;
}

export function PosSupplierDialog({ open, onOpenChange, restaurantId, onSaved }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name Required", description: "Enter supplier contact or name." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/pos/suppliers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          name: name.trim(),
          company_name: companyName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save supplier");

      toast({
        title: "✅ Supplier Added",
        description: `${name} has been added to suppliers list.`,
      });

      onOpenChange(false);
      setName("");
      setCompanyName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setNotes("");
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add supplier";
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
            <Truck className="h-4 w-4 text-primary" />
            Add New Supplier
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Vendor / distributor supplying raw materials, packaging, or produce.
          </p>
        </DialogHeader>

        <div className="p-5 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Contact Name *</Label>
              <Input
                placeholder="e.g. John Miller"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Company / Business</Label>
              <Input
                placeholder="e.g. Metro Wholesalers Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Phone Number</Label>
              <Input
                placeholder="e.g. +1 234 567 8900"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Address</Label>
              <Input
                type="email"
                placeholder="orders@supplier.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Address / Warehouse</Label>
            <Input
              placeholder="e.g. Warehouse #4, Industrial Area"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes / Terms</Label>
            <Input
              placeholder="e.g. Delivers every Monday, Net 30 payment"
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
            Save Supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
