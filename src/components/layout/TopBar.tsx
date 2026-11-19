import { useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, LogOut, Menu, User, ChevronDown } from "lucide-react";
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
import { OrderNotificationBell } from "@/components/notifications/OrderNotificationBell";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

type TopBarProps = {
  onOpenMobileNav?: () => void;
};

export function TopBar({ onOpenMobileNav }: TopBarProps) {
  const { t } = useTranslation(["sidebar", "common", "auth"]);
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isPosPage =
    location.pathname === "/pos" || location.pathname.startsWith("/pos");

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

  const displayName = profile?.full_name || "User";

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border/70 bg-background/75 backdrop-blur-xl sm:h-16">
      <div className="flex h-full items-center justify-between gap-1.5 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
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

          {isPosPage ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleBackToLastAction}
              className="h-9 w-9 shrink-0 rounded-lg border-border/80 bg-card/80 shadow-xs sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3"
              title={t("common:backToLastAction", "Back to last action page")}
              aria-label={t("common:backToLastAction", "Back to last action page")}
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
                className="flex h-9 items-center gap-0 rounded-lg border border-border/80 bg-card/80 px-1 hover:bg-card sm:h-10 sm:gap-2 sm:pl-1.5 sm:pr-2.5"
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
