/** Searchable sidebar destinations — keep in sync with `Sidebar.tsx`. */
export type SidebarNavSearchItem = {
  label: string;
  href: string;
  section: string;
  keywords?: string[];
  superAdminOnly?: boolean;
  /** Omit from command palette / search when user is super admin */
  hideForSuperAdmin?: boolean;
  /** Omit from command palette / search when active restaurant is a branch */
  hideForBranch?: boolean;
};

export const SIDEBAR_NAV_SEARCH_ITEMS: SidebarNavSearchItem[] = [
  { label: "Dashboard", href: "/dashboard", section: "Main", keywords: ["home", "overview"] },
  {
    label: "Team members",
    href: "/users/team-members",
    section: "Users",
    keywords: ["users", "team", "staff", "employees", "members", "permissions"],
    /** Hidden via plan gate for Starter; still searchable for Growth+ */
  },
  { label: "Orders", href: "/orders", section: "Orders", keywords: ["all orders", "order list"] },
  { label: "New orders", href: "/orders/new", section: "Orders", keywords: ["new", "inbox", "pending"] },
  { label: "Confirmed orders", href: "/orders/confirmed", section: "Orders", keywords: ["confirmed"] },
  { label: "Preparing orders", href: "/orders/preparing", section: "Orders", keywords: ["preparing", "kitchen", "chef"] },
  { label: "Out for delivery", href: "/orders/out-for-delivery", section: "Orders", keywords: ["delivery", "on the way", "shipping"] },
  { label: "Delivered orders", href: "/orders/delivered", section: "Orders", keywords: ["delivered", "completed"] },
  { label: "Menu items", href: "/menu", section: "Menu", keywords: ["menu", "categories", "food"], hideForBranch: true },
  { label: "Menu add-ons", href: "/menu?tab=addons", section: "Menu", keywords: ["addons", "extras", "modifiers", "options"], hideForBranch: true },
  { label: "Menu categories", href: "/menu?tab=categories", section: "Menu", keywords: ["categories", "menu groups"], hideForBranch: true },
  { label: "Menu sub-categories", href: "/menu?tab=sub-categories", section: "Menu", keywords: ["sub categories", "subcategories"], hideForBranch: true },

  { label: "Max Order", href: "/menu?tab=max-order", section: "Menu", keywords: ["max order", "limit", "quantity limit", "per order"], hideForBranch: true },
  { label: "Deals & Offers", href: "/deals", section: "Marketing", keywords: ["deals", "offers", "discounts", "promotions"], hideForBranch: true },
  { label: "Coupon Code", href: "/coupons", section: "Marketing", keywords: ["coupons", "discounts", "promo code"], hideForBranch: true },
  { label: "Cuisines", href: "/cuisines", section: "Marketing", keywords: ["cuisine", "food type", "restaurant cuisine"], hideForBranch: true },
  {
    label: "Permissions",
    href: "/permissions",
    section: "Management",
    keywords: ["permissions", "roles", "admin", "kitchen", "staff", "receptionist"],
    hideForSuperAdmin: true,
  },
  {
    label: "Kitchen",
    href: "/kitchen",
    section: "Management",
    keywords: ["kitchen", "orders", "preparing"],
    hideForSuperAdmin: true,
  },
  {
    label: "My Restaurant",
    href: "/restaurant-settings",
    section: "Management",
    keywords: ["settings", "restaurant", "tenant"],
    hideForSuperAdmin: true,
  },
  {
    label: "Branches",
    href: "/branches",
    section: "Management",
    keywords: ["branch", "branches", "locations", "multi-branch", "branch portal", "add branch"],
    hideForSuperAdmin: true,
    hideForBranch: true,
  },
  {
    label: "Reservations",
    href: "/reservations",
    section: "Management",
    keywords: ["reservations", "booking", "table reservation"],
    hideForSuperAdmin: true,
  },
  {
    label: "Tables & Floor",
    href: "/reservations?tab=tables",
    section: "Management",
    keywords: ["tables", "floor", "floor plan", "qr", "dine-in tables"],
    hideForSuperAdmin: true,
  },
  { label: "Settings", href: "/settings", section: "Management", keywords: ["preferences", "account"] },
  { label: "Tables", href: "/tables", section: "Management", keywords: ["tables", "floor", "dine-in", "table orders"] },
  {
    label: "Restaurants",
    href: "/restaurants",
    section: "Management",
    keywords: ["tenants", "all restaurants", "super"],
    superAdminOnly: true,
  },
  {
    label: "Restaurant report",
    href: "/reports/restaurant",
    section: "Reports",
    keywords: ["reports", "restaurant report", "commission", "sales", "performance", "earnings"],
  },
  {
    label: "Order report",
    href: "/reports/orders",
    section: "Reports",
    keywords: ["reports", "order report", "branch", "transfer", "transferred orders"],
  },
  {
    label: "Item report",
    href: "/reports/items",
    section: "Reports",
    keywords: ["reports", "menu item", "sku", "items sold", "sales by item"],
  },
  {
    label: "Customer analytics",
    href: "/reports/customers",
    section: "Reports",
    keywords: ["reports", "customers", "repeat", "loyalty", "spend", "crm"],
  },
];

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function filterSidebarNavItems(
  query: string,
  options: { isSuperAdmin: boolean; isBranch?: boolean; isReceptionist?: boolean; isStaff?: boolean; isKitchen?: boolean },
): SidebarNavSearchItem[] {
  const base = SIDEBAR_NAV_SEARCH_ITEMS.filter((i) => {
    if (options.isKitchen) {
      return (
        i.href === "/dashboard" ||
        i.href === "/settings" ||
        i.href.startsWith("/orders") ||
        i.href.startsWith("/reports")
      );
    }
    if (options.isReceptionist) {
      return i.href === "/dashboard" || i.href === "/reservations" || i.href.startsWith("/reservations") || i.href === "/settings";
    }
    if (options.isStaff) {
      return (
        i.href === "/dashboard" ||
        i.href === "/settings" ||
        i.href === "/deals" ||
        i.href === "/tables" ||
        i.href === "/menu" ||
        i.href.startsWith("/menu") ||
        i.href.startsWith("/orders") ||
        i.href.startsWith("/reports")
      );
    }
    if (i.superAdminOnly && !options.isSuperAdmin) return false;
    if (i.hideForSuperAdmin && options.isSuperAdmin) return false;
    if (i.hideForBranch && options.isBranch) return false;
    return true;
  });
  const q = normalize(query);
  if (!q) return base;
  return base.filter((item) => {
    const blob = [item.label, item.href, item.section, ...(item.keywords ?? [])].join(" ").toLowerCase();
    return blob.includes(q);
  });
}
