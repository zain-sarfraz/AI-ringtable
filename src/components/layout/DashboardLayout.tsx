import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
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

  return (
    <div
      className={cn(
        "flex min-h-screen",
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
        className={`flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300 ease-in-out ${
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
              ? "flex-1 overflow-auto px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8"
              : "flex-1 overflow-auto px-4 pb-8 pt-3 sm:px-6 sm:pt-4 lg:px-8"
          }
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
