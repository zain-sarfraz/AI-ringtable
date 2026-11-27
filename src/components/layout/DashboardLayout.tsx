import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { cn } from "@/lib/utils";

export function DashboardLayout() {
  const { role } = useAuth();
  const hideSidebar = role === "staff";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const staffOffDashboard =
    hideSidebar &&
    location.pathname !== "/dashboard" &&
    location.pathname !== "/";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen || hideSidebar) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, hideSidebar]);

  useEffect(() => {
    if (!mobileNavOpen || hideSidebar) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen, hideSidebar]);

  return (
    <div
      className={cn(
        "flex h-screen max-h-screen overflow-hidden h-dvh max-h-dvh",
        hideSidebar ? "bg-[#F7F3EB]" : "canvas-atmosphere",
      )}
    >
      {!hideSidebar && mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {!hideSidebar ? (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div
        className={`flex min-h-0 min-w-0 max-w-full flex-1 flex-col transition-[margin-left] duration-300 ease-in-out ${
          hideSidebar ? "ml-0" : sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"
        }`}
      >
        <TopBar
          hideSidebarNav={hideSidebar}
          onOpenMobileNav={hideSidebar ? undefined : () => setMobileNavOpen(true)}
        />
        <main
          className={
            hideSidebar
              ? "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8"
              : "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-8 pt-3 sm:px-6 sm:pt-4 lg:px-8"
          }
        >
          {staffOffDashboard ? (
            <div className="mb-4">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8E0D4] bg-white px-3 py-2 text-xs font-semibold text-[#1B4332] shadow-sm transition-colors hover:border-[#C9A227]/45 hover:bg-[#F7F2E9]"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                Back to Dashboard
              </Link>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
