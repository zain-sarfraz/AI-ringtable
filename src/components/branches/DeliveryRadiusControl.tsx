import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const MIN_KM = 1;
const MAX_KM = 20;

function clampRadius(value: number | string | null | undefined, fallback = 5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_KM, Math.max(MIN_KM, Math.round(n)));
}

type DeliveryRadiusControlProps = {
  id?: string;
  label?: string;
  value: string | number;
  onChange: (km: number) => void;
  className?: string;
  dense?: boolean;
};

/**
 * Synced slider + number input for branch delivery radius (1–20 KM).
 */
export function DeliveryRadiusControl({
  id = "delivery-radius",
  label = "Delivery radius",
  value,
  onChange,
  className,
  dense = false,
}: DeliveryRadiusControlProps) {
  const km = clampRadius(value, 5);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className={cn(dense ? "text-xs font-bold" : "text-sm")}>
          {label}
        </Label>
        <span className={cn("font-mono tabular-nums text-primary", dense ? "text-xs font-bold" : "text-sm font-semibold")}>
          {km} KM
        </span>
      </div>
      <div className={cn("flex items-center gap-3", dense ? "gap-2" : "gap-3")}>
        <Slider
          id={id}
          min={MIN_KM}
          max={MAX_KM}
          step={1}
          value={[km]}
          onValueChange={(vals) => onChange(clampRadius(vals[0], km))}
          className="flex-1"
        />
        <Input
          type="number"
          min={MIN_KM}
          max={MAX_KM}
          step={1}
          value={km}
          onChange={(e) => onChange(clampRadius(e.target.value, km))}
          className={cn("font-mono tabular-nums", dense ? "h-9 w-16 text-xs" : "h-9 w-[4.5rem]")}
          aria-label={`${label} in kilometers`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">Choose how far this location can deliver (1–20 KM).</p>
    </div>
  );
}

export { MIN_KM as DELIVERY_RADIUS_MIN_KM, MAX_KM as DELIVERY_RADIUS_MAX_KM, clampRadius as clampDeliveryRadiusUi };
