import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Headphones } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: Array<"super_admin" | "admin" | "manager" | "agent" | "driver">;
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, role, loading, isDriver, isReceptionist, isStaff, isKitchen } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-xl gradient-primary flex items-center justify-center">
            <Headphones className="h-9 w-9 text-primary-foreground" />
          </div>
          <span className="text-lg font-medium text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Drivers are confined to /driver portal
  if (isDriver && location.pathname !== "/driver") {
    return <Navigate to="/driver" replace />;
  }

  // Kitchen is confined to dashboard, orders, reports, settings
  if (isKitchen) {
    const path = location.pathname;
    const kitchenAllowed =
      path === "/dashboard" ||
      path === "/settings" ||
      path === "/profile" ||
      path.startsWith("/orders") ||
      path.startsWith("/reports");
    if (!kitchenAllowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Receptionist is confined strictly to /dashboard, /reservations, /settings, /profile
  if (isReceptionist && !["/dashboard", "/reservations", "/settings", "/profile"].includes(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Staff: dashboard, orders, menu, deals, tables, settings (no POS / reports)
  if (isStaff) {
    const path = location.pathname;
    const staffAllowed =
      path === "/dashboard" ||
      path === "/settings" ||
      path === "/profile" ||
      path === "/deals" ||
      path === "/tables" ||
      path === "/menu" ||
      path.startsWith("/menu/") ||
      path.startsWith("/orders");
    if (!staffAllowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Managers cannot access the Branches module
  if (role === "manager") {
    const path = location.pathname;
    if (path === "/branches" || path.startsWith("/branches/") || path === "/branch-portal" || path.startsWith("/branch-portal/")) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  if (requiredRoles && role && !requiredRoles.includes(role as any)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
