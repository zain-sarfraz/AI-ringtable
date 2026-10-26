import { useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, LogOut, User, ChevronDown } from "lucide-react";
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

export function TopBar() {
  const { t } = useTranslation(["sidebar", "common", "auth"]);
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isPosPage = location.pathname === "/pos" || location.pathname.startsWith("/pos");
  const isDashboard = location.pathname === "/dashboard";

  // Track the last non-POS action page so user can navigate back
  useEffect(() => {
    if (
      location.pathname &&
      !location.pathname.startsWith("/pos") &&
      location.pathname !== "/login" &&
      location.pathname !== "/signup"
    ) {
      sessionStorage.setItem("pos_last_action_page", location.pathname + location.search);
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
    <header className="sticky top-0 z-30 h-16 border-b border-border/70 bg-background/75 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Top-Left: On POS pages, show 'Back to last action page' button */}
        <div className="flex items-center min-w-0">
          {isPosPage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBackToLastAction}
              className="flex items-center gap-2 h-9 px-3 text-xs sm:text-sm font-semibold rounded-lg border-border/80 bg-card/80 hover:bg-accent hover:text-accent-foreground shadow-xs transition-all"
            >
              <ArrowLeft className="h-4 w-4 text-primary" />
              <span>{t("common:backToLastAction", "Back to last action page")}</span>
            </Button>
          )}
        </div>

        {/* Top-Right: Language Switcher & Notification Bell (Every page) + Profile Dropdown */}
        <div className="flex items-center gap-2.5 shrink-0">
          <LanguageSwitcher />

          <div className="[&_button]:rounded-lg [&_button]:bg-card [&_button]:border [&_button]:border-border/80 [&_button]:text-foreground [&_button]:hover:bg-muted [&_button]:shadow-sm">
            <OrderNotificationBell />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2.5 h-10 rounded-lg border border-border/80 bg-card/80 pl-1.5 pr-2.5 hover:bg-card"
              >
                <Avatar className="h-8 w-8 ring-2 ring-primary/15">
                  <AvatarImage key={profile?.avatar_url || "default"} src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                    {displayName.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden md:inline text-sm font-semibold text-foreground">{displayName}</span>
                <ChevronDown className="hidden md:block h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel>{t("sidebar:myAccount", "My Account")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <Link to="/profile">
                <DropdownMenuItem className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  {t("sidebar:profile", "Profile")}
                </DropdownMenuItem>
              </Link>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} className="text-destructive cursor-pointer">
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


