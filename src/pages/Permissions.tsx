import { Shield, ChefHat, UserCog, CalendarCheck, Crown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

const ROLES = [
  {
    key: "admin",
    name: "Admin",
    note: "All modules",
    icon: Crown,
    iconWrap: "bg-amber-100 text-amber-700",
    modules: [
      "Dashboard",
      "Staff",
      "Orders",
      "Menu",
      "Deals & Offers",
      "Coupon Code",
      "Cuisines",
      "Reports",
      "Kitchen",
      "Reservations",
      "Tables",
      "My Restaurant",
      "Branches",
      "Settings",
    ],
  },
  {
    key: "kitchen",
    name: "Kitchen",
    note: "Order fulfillment",
    icon: ChefHat,
    iconWrap: "bg-blue-100 text-blue-700",
    modules: ["Dashboard", "Orders", "Reports", "Settings"],
  },
  {
    key: "staff",
    name: "Staff",
    note: "Tables, orders, and deals (view menu only)",
    icon: UserCog,
    iconWrap: "bg-orange-100 text-orange-700",
    modules: ["Dashboard", "Tables", "Orders", "Menu", "Deals & Offers", "Settings"],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    note: "Reservations and check-in",
    icon: CalendarCheck,
    iconWrap: "bg-violet-100 text-violet-700",
    modules: ["Dashboard", "Reservations", "Tables", "Settings"],
  },
] as const;

const MODULES = [
  "Dashboard",
  "Staff",
  "Orders",
  "Kitchen",
  "Menu",
  "Deals & Offers",
  "Coupon Code",
  "Cuisines",
  "Reports",
  "Reservations",
  "Tables",
  "My Restaurant",
  "Branches",
  "Settings",
];

export default function Permissions() {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        icon={<Shield className="h-5 w-5" />}
        title="Permissions"
        description="Roles available when you add a team member, and the modules each one can open."
      />

      <div className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-border/80">
                <th className="text-left px-6 py-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-[220px]">
                  Module
                </th>
                {ROLES.map((role) => {
                  const Icon = role.icon;
                  return (
                    <th key={role.key} className="px-3 py-5 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <span className={cn("h-10 w-10 rounded-xl flex items-center justify-center", role.iconWrap)}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="text-sm font-semibold text-foreground">{role.name}</span>
                        <span className="text-[11px] text-muted-foreground leading-tight">{role.note}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((module, index) => (
                <tr
                  key={module}
                  className={cn(
                    "border-b border-border/50 last:border-0",
                    index % 2 === 0 ? "bg-muted/30" : "bg-card",
                  )}
                >
                  <td className="px-6 py-3.5 text-sm font-medium text-foreground">{module}</td>
                  {ROLES.map((role) => {
                    const allowed = (role.modules as readonly string[]).includes(module);
                    return (
                      <td key={role.key} className="px-3 py-3.5 text-center">
                        {allowed ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <Check className="h-4 w-4" strokeWidth={2.5} />
                          </span>
                        ) : (
                          <span className="inline-flex h-7 w-7 items-center justify-center text-zinc-300 text-lg leading-none">
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
