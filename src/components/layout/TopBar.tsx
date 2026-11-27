import { useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  LogOut,
  Menu,
  User,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { OrderNotificationBell } from "@/components/notifications/OrderNotificationBell";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";
import { PRODUCT_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

type TopBarProps = {
  onOpenMobileNav?: () => void;
  hideSidebarNav?: boolean;
};

export function TopBar({ onOpenMobileNav, hideSidebarNav }: TopBarProps) {
  const { t } = useTranslation(["sidebar", "common", "auth", "orders"]);
  const { user, profile, signOut, role } = useAuth();
  const { activeRestaurant } = useActiveRestaurant();
  const navigate = useNavigate();
  const location = useLocation();

  const isPosPage =
    location.pathname === "/pos" || location.pathname.startsWith("/pos");
  const isStaff = hideSidebarNav || role === "staff";

  useEffect(() => {
    if (
      location.pathname &&
      !location.pathname.startsWith("/pos") &&
      location.pathname !== "/login" &&
      location.pathname !== "/signup"
    ) {
      sessionStorage.setItem(
        "pos_last_action_page",
        location.pathname + location.search,
      );
    }
  }, [location.pathname, location.search]);

  const handleBackToLastAction = () => {
    const lastPage = sessionStorage.getItem("pos_last_action_page");
    if (lastPage && !lastPage.startsWith("/pos")) {
      navigate(lastPage);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/dashboard");
    }
  };

  const displayName = profile?.full_name || "Waiter";
  const restaurantLabel = activeRestaurant?.name || PRODUCT_NAME;

  if (isStaff) {
    return (
      <header className="sticky top-0 z-30 border-b border-[#E8E0D4] bg-[#FBF8F3]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-[1600px] items-center justify-between gap-2 px-4 sm:h-[68px] sm:gap-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              to="/dashboard"
              className="flex min-w-0 items-center gap-2 rounded-xl outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#C9A227]/40 sm:gap-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1B4332] text-sm font-bold tracking-tight text-[#F4E4A6] shadow-sm sm:h-10 sm:w-10">
                {(restaurantLabel || "R").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-[#1C1917] sm:text-[15px] md:text-base">
                  {restaurantLabel}
                </p>
                <p className="mt-0.5 truncate text-[10px] font-medium tracking-wide text-[#6B6358] sm:text-[11px]">
                  Waiter Portal · Floor Staff
                </p>
              </div>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#E8E0D4] bg-white/80 px-3 py-1.5 sm:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1B4332]">
                Live
              </span>
            </div>

            <div className="hidden sm:block [&_button]:border-[#E8E0D4] [&_button]:bg-white/80">
              <LanguageSwitcher />
            </div>

            <div className="[&_button]:h-9 [&_button]:w-9 [&_button]:rounded-xl [&_button]:border [&_button]:border-[#E8E0D4] [&_button]:bg-white [&_button]:p-0 [&_button]:shadow-none">
              <OrderNotificationBell />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex h-10 items-center gap-2 rounded-xl border border-[#E8E0D4] bg-white px-1.5 pr-2.5 hover:bg-[#F7F2E9]"
                >
                  <Avatar className="h-7 w-7 ring-2 ring-[#C9A227]/25">
                    <AvatarImage
                      key={profile?.avatar_url || "default"}
                      src={profile?.avatar_url || undefined}
                    />
                    <AvatarFallback className="bg-[#1B4332] text-xs font-bold text-[#F4E4A6]">
                      {displayName.charAt(0) ||
                        user?.email?.charAt(0)?.toUpperCase() ||
                        "W"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[9rem] truncate text-sm font-semibold text-[#1C1917] md:inline">
                    {displayName}
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-[#6B6358] md:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl border-[#E8E0D4]">
                <DropdownMenuLabel>
                  {t("sidebar:myAccount", "My Account")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <Link to="/profile">
                  <DropdownMenuItem className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    {t("sidebar:profile", "Profile")}
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut()}
                  className="cursor-pointer text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("sidebar:signOut", "Sign Out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border/70 bg-background/80 backdrop-blur-xl sm:h-16">
      <div className="flex h-full items-center justify-between gap-1.5 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 sm:gap-2">
          {onOpenMobileNav ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-lg border-border/80 bg-card/80 lg:hidden"
              onClick={onOpenMobileNav}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </Button>
          ) : null}
          {isPosPage ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleBackToLastAction}
              className="h-9 w-9 shrink-0 rounded-lg border-border/80 bg-card/80 shadow-xs sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3"
              title={t("common:backToLastAction", "Back to last action page")}
              aria-label={t(
                "common:backToLastAction",
                "Back to last action page",
              )}
            >
              <ArrowLeft className="h-4 w-4 text-primary" />
              <span className="hidden text-xs font-semibold sm:inline">
                {t("common:backToLastAction", "Back to last action page")}
              </span>
            </Button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher />

          <div className="[&_button]:h-9 [&_button]:w-9 [&_button]:rounded-lg [&_button]:border [&_button]:border-border/80 [&_button]:bg-card [&_button]:p-0 [&_button]:shadow-xs sm:[&_button]:h-10 sm:[&_button]:w-10">
            <OrderNotificationBell />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "flex h-9 items-center gap-0 rounded-lg border border-border/80 bg-card/80 px-1 hover:bg-card sm:h-10 sm:gap-2 sm:pl-1.5 sm:pr-2.5",
                )}
              >
                <Avatar className="h-7 w-7 ring-2 ring-primary/15 sm:h-8 sm:w-8">
                  <AvatarImage
                    key={profile?.avatar_url || "default"}
                    src={profile?.avatar_url || undefined}
                  />
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {displayName.charAt(0) ||
                      user?.email?.charAt(0)?.toUpperCase() ||
                      "U"}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-semibold text-foreground md:inline">
                  {displayName}
                </span>
                <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel>
                {t("sidebar:myAccount", "My Account")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <Link to="/profile">
                <DropdownMenuItem className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  {t("sidebar:profile", "Profile")}
                </DropdownMenuItem>
              </Link>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut()}
                className="cursor-pointer text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t("sidebar:signOut", "Sign Out")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
