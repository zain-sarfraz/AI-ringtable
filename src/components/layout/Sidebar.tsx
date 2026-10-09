import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  UtensilsCrossed,
  Tag,
  ClipboardList,
  ChefHat,
  Store,
  Inbox,
  CheckCircle2,
  Truck,
  PackageCheck,
  Boxes,
  Gauge,
  Layers,
  LayoutGrid,
  ListTree,
  PlusSquare,
  Wallet,
  Ticket,
  FileBarChart,
  Package,
  ShoppingBag,
  Users,
  Award,
  BarChart3,
  UserCircle,
  Crown,
  Building2,
  CalendarCheck,
  UserCog,
  TableProperties,
  Shield,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { usePlanFeatures } from "@/hooks/usePlanFeatures";
import { BRAND_ASSETS, PRODUCT_NAME } from "@/lib/brand";
import { supabase } from "@/integrations/supabase/client";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const location = useLocation();
  const { role, profile, user } = useAuth();
  const { restaurantId, activeRestaurant } = useActiveRestaurant();
  const planFeatures = usePlanFeatures();
  const [restaurantName, setRestaurantName] = useState("");
  const [ordersOpen, setOrdersOpen] = useState(
    location.pathname === "/orders" || location.pathname.startsWith("/orders/")
  );
  const [menuOpen, setMenuOpen] = useState(location.pathname === "/menu");
  const [reportsOpen, setReportsOpen] = useState(location.pathname.startsWith("/reports"));
  const [usersOpen, setUsersOpen] = useState(location.pathname.startsWith("/users"));

  const isBranch = Boolean(
    activeRestaurant?.is_branch ||
    (activeRestaurant?.parent_restaurant_id != null && activeRestaurant.parent_restaurant_id !== "")
  );

  const ordersChildren = useMemo(
    () => [
      { icon: Inbox, label: t("sidebar:newOrders", "New"), href: "/orders/new" },
      { icon: CheckCircle2, label: t("sidebar:confirmed", "Confirmed"), href: "/orders/confirmed" },
      { icon: ChefHat, label: t("sidebar:preparing", "Preparing"), href: "/orders/preparing" },
      { icon: Truck, label: t("sidebar:outForDelivery", "Out for delivery"), href: "/orders/out-for-delivery" },
      { icon: PackageCheck, label: t("sidebar:delivered", "Delivered"), href: "/orders/delivered" },
    ],
    [t]
  );

  const navigationItems = useMemo(
    () => [
      { icon: LayoutDashboard, label: t("sidebar:dashboard", "Dashboard"), href: "/dashboard" },
      ...(!isBranch
        ? [
          { icon: Tag, label: t("sidebar:dealsAndOffers", "Deals & Offers"), href: "/deals" },
          { icon: Ticket, label: t("sidebar:couponCode", "Coupon Code"), href: "/coupons" },
          { icon: Layers, label: t("sidebar:cuisines", "Cuisines"), href: "/cuisines" },
        ]
        : []),
    ],
    [t, isBranch]
  );

  const menuChildren = useMemo(
    () => [
      { icon: UtensilsCrossed, label: t("sidebar:items", "Items"), href: "/menu" },
      { icon: LayoutGrid, label: t("sidebar:categories", "Categories"), href: "/menu?tab=categories" },
      { icon: ListTree, label: t("sidebar:subCategories", "Sub-categories"), href: "/menu?tab=sub-categories" },
      { icon: PlusSquare, label: t("sidebar:addOns", "Add-ons"), href: "/menu?tab=addons" },
      { icon: Gauge, label: t("sidebar:maxOrder", "Max Order"), href: "/menu?tab=max-order" },
    ],
    [t]
  );

  const reportsChildren = useMemo(
    () => [
      { icon: ShoppingBag, label: t("sidebar:orderReport", "Order report"), href: "/reports/orders" },
      { icon: Package, label: t("sidebar:itemReport", "Item report"), href: "/reports/items" },
      { icon: BarChart3, label: t("sidebar:customerAnalytics", "Customer analytics"), href: "/reports/customers" },
    ],
    [t]
  );

  const usersChildren = useMemo(
    () =>
      planFeatures.staff_management
        ? [{ icon: Users, label: t("sidebar:teamMembers", "Team Members"), href: "/users/team-members" }]
        : [],
    [t, planFeatures.staff_management]
  );

  const managementItems = useMemo(
    () => [
      ...(planFeatures.staff_management
        ? [{ icon: Shield, label: t("sidebar:permissions", "Permissions"), href: "/permissions" }]
        : []),
      { icon: TableProperties, label: t("sidebar:tables", "Tables"), href: "/reservations?tab=tables" },
      { icon: ChefHat, label: t("sidebar:kitchen", "Kitchen"), href: "/kitchen" },
      { icon: CalendarCheck, label: t("sidebar:reservations", "Reservations"), href: "/reservations" },
      {
        icon: Store,
        label: isBranch ? t("sidebar:myBranch", "My Branch") : t("sidebar:myRestaurant", "My Restaurant"),
        href: "/restaurant-settings",
      },
      ...(!isBranch && planFeatures.branches
        ? [{ icon: Building2, label: t("sidebar:branches", "Branches"), href: "/branches" }]
        : []),
      { icon: Settings, label: t("sidebar:settings", "Settings"), href: "/settings" },
    ],
    [t, isBranch, planFeatures.branches, planFeatures.staff_management]
  );

  useEffect(() => {
    if (location.pathname === "/menu") setMenuOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith("/reports")) setReportsOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith("/users")) setUsersOpen(true);
  }, [location.pathname]);

  const menuGroupActive = location.pathname === "/menu";

  useEffect(() => {
    if (activeRestaurant?.name) {
      setRestaurantName(activeRestaurant.name);
    } else if (restaurantId) {
      supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.name) setRestaurantName(data.name);
        });
    } else {
      setRestaurantName("");
    }
  }, [restaurantId, activeRestaurant]);

  const finalManagement =
    role === "super_admin"
      ? [
        { icon: Store, label: t("sidebar:restaurants", "Restaurants"), href: "/restaurants" },
        { icon: Wallet, label: t("sidebar:earnings", "Earnings"), href: "/earnings" },
        { icon: Settings, label: t("sidebar:settings", "Settings"), href: "/settings" },
      ]
      : managementItems;

  function hrefIsActive(href: string) {
    const [path, qs] = href.split("?");
    if (location.pathname !== path) return false;
    if (!qs) {
      if (path === "/menu") {
        const tab = new URLSearchParams(location.search).get("tab");
        return !tab || tab === "items";
      }
      if (path === "/reservations") {
        const tab = new URLSearchParams(location.search).get("tab");
        return !tab || tab === "reservations" || tab === "bookings";
      }
      return true;
    }
    const want = new URLSearchParams(qs);
    const have = new URLSearchParams(location.search);
    for (const [k, v] of want.entries()) {
      if (have.get(k) !== v) return false;
    }
    return true;
  }

  const NavItem = ({
    icon: Icon,
    label,
    href,
    indent,
    activeOverride,
  }: {
    icon: any;
    label: string;
    href: string;
    indent?: boolean;
    activeOverride?: boolean;
  }) => {
    const isActive = activeOverride !== undefined ? activeOverride : hrefIsActive(href);
    const content = (
      <Link
        to={href}
        className={cn(
          "group relative flex items-center rounded-lg transition-colors duration-150 overflow-hidden",
          "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed
            ? "h-10 w-10 mx-auto justify-center p-0"
            : cn("gap-3 px-3 py-2.5 w-full", indent && "pl-9 py-2"),
          isActive &&
          (collapsed
            ? "bg-sidebar-primary/20 text-sidebar-primary ring-1 ring-sidebar-primary/40 font-semibold"
            : "bg-sidebar-primary/15 text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_hsl(var(--sidebar-primary))]")
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] flex-shrink-0 transition-colors",
            isActive ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground"
          )}
        />
        {!collapsed && (
          <span className={cn("text-sm font-medium tracking-tight truncate whitespace-nowrap flex-1 text-left", isActive && "text-sidebar-accent-foreground")}>
            {label}
          </span>
        )}
      </Link>
    );
    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="ml-2 font-medium text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return content;
  };

  const GroupButton = ({
    open,
    onToggleOpen,
    active,
    icon: Icon,
    label,
  }: {
    open: boolean;
    onToggleOpen: () => void;
    active: boolean;
    icon: any;
    label: string;
  }) => (
    <button
      type="button"
      onClick={onToggleOpen}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 overflow-hidden",
        "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && !open && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] flex-shrink-0",
          active ? "text-sidebar-primary" : "text-sidebar-foreground/55"
        )}
      />
      <span className="text-sm font-medium tracking-tight flex-1 text-left truncate whitespace-nowrap">{label}</span>
      <ChevronDown
        className={cn(
          "h-4 w-4 text-sidebar-foreground/40 transition-transform duration-200 flex-shrink-0",
          open && "rotate-180"
        )}
      />
    </button>
  );

  const ordersGroupActive =
    location.pathname === "/orders" || location.pathname.startsWith("/orders/");
  const reportsGroupActive = location.pathname.startsWith("/reports");
  const usersGroupActive = location.pathname.startsWith("/users");

  const displayName = profile?.full_name || user?.email || "User";
  const roleLabel =
    role === "super_admin"
      ? "Super Admin"
      : role === "kitchen" || role === "chef"
      ? "Kitchen Staff"
      : role === "receptionist"
      ? "Receptionist"
      : role === "staff"
      ? "Staff"
      : role
      ? role.replace("_", " ")
      : "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-300 ease-in-out z-40 overflow-hidden",
        "border-r border-sidebar-border select-none",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 80% 120% at 0% 0%, hsl(168 65% 48% / 0.22), transparent 55%)",
          }}
        />
        <div className="relative h-16 flex items-center px-3.5 overflow-hidden">
          <div className="flex items-center gap-2.5 overflow-hidden min-w-0 flex-1">
            <button
              type="button"
              onClick={collapsed ? onToggle : undefined}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg shadow-black/20 focus:outline-none",
                collapsed ? "cursor-pointer hover:opacity-90 focus-visible:ring-2 focus-visible:ring-sidebar-primary" : "cursor-default"
              )}
              title={collapsed ? t("sidebar:expand", "Click to expand") : PRODUCT_NAME}
              aria-label={collapsed ? "Expand sidebar" : PRODUCT_NAME}
            >
              <img src={BRAND_ASSETS.appIcon} alt="" className="h-9 w-9" />
            </button>
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <span
                className={cn(
                  "font-bold text-[15px] tracking-tight text-sidebar-accent-foreground truncate whitespace-nowrap transition-opacity duration-200",
                  collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
                )}
              >
                {role === "super_admin" ? PRODUCT_NAME : restaurantName || PRODUCT_NAME}
              </span>
              {role === "super_admin" && !collapsed && (
                <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider leading-none flex items-center gap-1 mt-0.5">
                  <Shield className="h-2.5 w-2.5" /> Super Admin
                </span>
              )}
              {(role === "kitchen" || role === "chef") && !collapsed && (
                <span className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider leading-none flex items-center gap-1 mt-0.5">
                  <ChefHat className="h-2.5 w-2.5" /> {t("users:roleKitchen", "Kitchen Staff")}
                </span>
              )}
              {role === "receptionist" && !collapsed && (
                <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider leading-none flex items-center gap-1 mt-0.5">
                  <CalendarCheck className="h-2.5 w-2.5" /> {t("users:roleReceptionist", "Receptionist")}
                </span>
              )}
              {role === "staff" && !collapsed && (
                <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider leading-none flex items-center gap-1 mt-0.5">
                  <UserCog className="h-2.5 w-2.5" /> {t("users:roleStaff", "Staff")}
                </span>
              )}
              {isBranch && !collapsed && role !== "kitchen" && role !== "chef" && role !== "receptionist" && role !== "staff" && (
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider leading-none">
                  Branch
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn(
              "h-8 w-8 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex-shrink-0 rounded-lg transition-opacity duration-200",
              collapsed ? "opacity-0 pointer-events-none hidden" : "opacity-100"
            )}
            title={t("sidebar:collapse", "Collapse sidebar")}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <nav
        className={cn(
          "flex-1 py-3 space-y-1 overflow-y-auto overflow-x-hidden",
          collapsed
            ? "px-2 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "px-2.5 custom-scrollbar"
        )}
      >
        {/* ── RECEPTIONIST: Dashboard, Reservations & Settings ────── */}
        {role === "staff" ? (
          <div className="space-y-0.5">
            <NavItem icon={LayoutDashboard} label={t("sidebar:dashboard", "Dashboard")} href="/dashboard" />
            <NavItem icon={TableProperties} label={t("sidebar:tables", "Tables")} href="/tables" />

            {collapsed ? (
              <NavItem
                icon={ClipboardList}
                label={t("sidebar:orders", "Orders")}
                href="/orders"
                activeOverride={ordersGroupActive}
              />
            ) : (
              <>
                <GroupButton
                  open={ordersOpen}
                  onToggleOpen={() => setOrdersOpen((v) => !v)}
                  active={ordersGroupActive}
                  icon={ClipboardList}
                  label={t("sidebar:orders", "Orders")}
                />
                {ordersOpen && (
                  <div className="space-y-0.5">
                    <NavItem icon={ClipboardList} label={t("sidebar:allOrders", "All orders")} href="/orders" indent />
                    {ordersChildren.map((c) => (
                      <NavItem key={c.href} {...c} indent />
                    ))}
                  </div>
                )}
              </>
            )}

            {collapsed ? (
              <NavItem
                icon={UtensilsCrossed}
                label={t("sidebar:menu", "Menu")}
                href="/menu"
                activeOverride={menuGroupActive}
              />
            ) : (
              <>
                <GroupButton
                  open={menuOpen}
                  onToggleOpen={() => setMenuOpen((v) => !v)}
                  active={menuGroupActive}
                  icon={UtensilsCrossed}
                  label={t("sidebar:menu", "Menu")}
                />
                {menuOpen && (
                  <div className="space-y-0.5">
                    {menuChildren.map((item) => (
                      <NavItem key={item.href} {...item} indent />
                    ))}
                  </div>
                )}
              </>
            )}

            <NavItem icon={Tag} label={t("sidebar:dealsAndOffers", "Deals & Offers")} href="/deals" />

            {collapsed ? (
              <div className="pt-2 mt-2 border-t border-sidebar-border space-y-0.5">
                <NavItem
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                  href="/reports/items"
                  activeOverride={reportsGroupActive}
                />
              </div>
            ) : (
              <div className="pt-2 mt-2 border-t border-sidebar-border">
                <GroupButton
                  open={reportsOpen}
                  onToggleOpen={() => setReportsOpen((v) => !v)}
                  active={reportsGroupActive}
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                />
                {reportsOpen && (
                  <div className="space-y-0.5 mt-0.5">
                    {reportsChildren.map((item) => (
                      <NavItem key={item.href} {...item} indent />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={cn("border-t border-sidebar-border space-y-0.5", collapsed ? "pt-2 mt-2" : "pt-4 mt-3")}>
              <NavItem icon={Settings} label={t("sidebar:settings", "Settings")} href="/settings" />
            </div>
          </div>
        ) : role === "receptionist" ? (
          <div className="space-y-0.5">
            <NavItem
              icon={LayoutDashboard}
              label={t("sidebar:dashboard", "Dashboard")}
              href="/dashboard"
            />
            <NavItem
              icon={CalendarCheck}
              label={t("sidebar:reservations", "Reservations")}
              href="/reservations"
            />
            <NavItem
              icon={TableProperties}
              label={t("sidebar:tablesAndFloor", "Tables & Floor")}
              href="/reservations?tab=tables"
            />
            <div className={cn("border-t border-sidebar-border space-y-0.5", collapsed ? "pt-2 mt-2" : "pt-4 mt-3")}>
              <NavItem icon={Settings} label={t("sidebar:settings", "Settings")} href="/settings" />
            </div>
          </div>
        ) : role === "kitchen" || role === "chef" ? (
          <div className="space-y-0.5">
            {/* 1. Dashboard */}
            <NavItem icon={LayoutDashboard} label={t("sidebar:dashboard", "Dashboard")} href="/dashboard" />

            {/* 2. Orders */}
            {collapsed ? (
              <NavItem
                icon={ClipboardList}
                label={t("sidebar:orders", "Orders")}
                href="/orders"
                activeOverride={ordersGroupActive}
              />
            ) : (
              <>
                <GroupButton
                  open={ordersOpen}
                  onToggleOpen={() => setOrdersOpen((v) => !v)}
                  active={ordersGroupActive}
                  icon={ClipboardList}
                  label={t("sidebar:orders", "Kitchen Orders")}
                />
                {ordersOpen && (
                  <div className="space-y-0.5">
                    <NavItem icon={ClipboardList} label={t("sidebar:allOrders", "All orders")} href="/orders" indent />
                    {ordersChildren.map((c) => (
                      <NavItem key={c.href} {...c} indent />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* 3. Reports */}
            {collapsed ? (
              <div className="pt-2 mt-2 border-t border-sidebar-border space-y-0.5">
                <NavItem
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                  href="/reports/items"
                  activeOverride={reportsGroupActive}
                />
              </div>
            ) : (
              <div className="pt-2 mt-2 border-t border-sidebar-border">
                <GroupButton
                  open={reportsOpen}
                  onToggleOpen={() => setReportsOpen((v) => !v)}
                  active={reportsGroupActive}
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                />
                {reportsOpen && (
                  <div className="space-y-0.5 mt-0.5">
                    {reportsChildren.map((item) => (
                      <NavItem key={item.href} {...item} indent />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. Settings */}
            <div className={cn("border-t border-sidebar-border space-y-0.5", collapsed ? "pt-2 mt-2" : "pt-4 mt-3")}>
              <NavItem icon={Settings} label={t("sidebar:settings", "Settings")} href="/settings" />
            </div>
          </div>
        ) : role === "super_admin" ? (
          <div className="space-y-0.5">
            <NavItem icon={LayoutDashboard} label={t("sidebar:dashboard", "Dashboard")} href="/dashboard" />
            <NavItem icon={Store} label={t("sidebar:restaurants", "Restaurants")} href="/restaurants" />
            <NavItem icon={Wallet} label={t("sidebar:earnings", "Earnings")} href="/earnings" />

            <div className={cn("border-t border-sidebar-border space-y-0.5", collapsed ? "pt-2 mt-2" : "pt-4 mt-3")}>
              {!collapsed && (
                <p className="px-3 text-[10px] font-bold text-sidebar-foreground/35 uppercase tracking-[0.16em] mb-2">
                  {t("sidebar:management", "Management")}
                </p>
              )}
              <NavItem icon={Settings} label={t("sidebar:settings", "Settings")} href="/settings" />
            </div>
          </div>
        ) : (
          /* ── RESTAURANT USERS: full nav (customized for branch vs parent) ── */
          <div className="space-y-0.5">
            <NavItem icon={LayoutDashboard} label={t("sidebar:dashboard", "Dashboard")} href="/dashboard" />

            {planFeatures.staff_management && (
              collapsed ? (
                <NavItem
                  icon={Users}
                  label={t("sidebar:users", "Users")}
                  href="/users/team-members"
                  activeOverride={usersGroupActive}
                />
              ) : (
                <div className="space-y-0.5">
                  <GroupButton
                    open={usersOpen}
                    onToggleOpen={() => setUsersOpen((v) => !v)}
                    active={usersGroupActive}
                    icon={Users}
                    label={t("sidebar:users", "Users")}
                  />
                  {usersOpen && (
                    <div className="space-y-0.5">
                      {usersChildren.map((item) => (
                        <NavItem key={item.href} {...item} indent />
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {collapsed ? (
              <NavItem
                icon={ClipboardList}
                label={t("sidebar:orders", "Orders")}
                href="/orders"
                activeOverride={ordersGroupActive}
              />
            ) : (
              <>
                <GroupButton
                  open={ordersOpen}
                  onToggleOpen={() => setOrdersOpen((v) => !v)}
                  active={ordersGroupActive}
                  icon={ClipboardList}
                  label={t("sidebar:orders", "Orders")}
                />
                {ordersOpen && (
                  <div className="space-y-0.5">
                    <NavItem icon={ClipboardList} label={t("sidebar:allOrders", "All orders")} href="/orders" indent />
                    {ordersChildren.map((c) => (
                      <NavItem key={c.href} {...c} indent />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Menu is only visible to Parent Restaurant admins, hidden for Branches */}
            {!isBranch && (
              collapsed ? (
                <NavItem
                  icon={UtensilsCrossed}
                  label={t("sidebar:menu", "Menu")}
                  href="/menu"
                  activeOverride={menuGroupActive}
                />
              ) : (
                <>
                  <GroupButton
                    open={menuOpen}
                    onToggleOpen={() => setMenuOpen((v) => !v)}
                    active={menuGroupActive}
                    icon={UtensilsCrossed}
                    label={t("sidebar:menu", "Menu")}
                  />
                  {menuOpen && (
                    <div className="space-y-0.5">
                      {menuChildren.map((item) => (
                        <NavItem key={item.href} {...item} indent />
                      ))}
                    </div>
                  )}
                </>
              )
            )}

            {navigationItems
              .filter((i) => i.href !== "/dashboard")
              .map((item) => (
                <NavItem key={item.href} {...item} />
              ))}

            {collapsed ? (
              <div className="pt-2 mt-2 border-t border-sidebar-border space-y-0.5">
                <NavItem
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                  href="/reports/items"
                  activeOverride={reportsGroupActive}
                />
              </div>
            ) : (
              <div className="pt-4 mt-3 border-t border-sidebar-border">
                <GroupButton
                  open={reportsOpen}
                  onToggleOpen={() => setReportsOpen((v) => !v)}
                  active={reportsGroupActive}
                  icon={FileBarChart}
                  label={t("sidebar:reports", "Reports")}
                />
                {reportsOpen && (
                  <div className="space-y-0.5 mt-0.5">
                    {reportsChildren.map((item) => (
                      <NavItem key={item.href} {...item} indent />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={cn("border-t border-sidebar-border space-y-0.5", collapsed ? "pt-2 mt-2" : "pt-4 mt-3")}>
              {!collapsed && (
                <p className="px-3 text-[10px] font-bold text-sidebar-foreground/35 uppercase tracking-[0.16em] mb-2">
                  {t("sidebar:management", "Management")}
                </p>
              )}
              {managementItems.map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
            </div>
          </div>
        )}

      </nav>

      {!collapsed && (
        <div className="p-3 border-t border-sidebar-border overflow-hidden">
          <div className="rounded-xl bg-sidebar-accent/80 border border-sidebar-border p-3 overflow-hidden">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-10 w-10 ring-2 ring-sidebar-primary/30 flex-shrink-0">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-sm font-semibold text-sidebar-accent-foreground truncate whitespace-nowrap leading-tight">
                  {displayName}
                </p>
                <p className="text-xs text-sidebar-foreground/50 capitalize truncate whitespace-nowrap">({roleLabel})</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {collapsed && (
        <div className="p-2 border-t border-sidebar-border flex justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-9 w-9 cursor-pointer ring-1 ring-sidebar-border">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="right" className="ml-2">
              <p className="font-semibold">{displayName}</p>
              <p className="text-xs text-muted-foreground capitalize">({roleLabel})</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </aside>
  );
}

