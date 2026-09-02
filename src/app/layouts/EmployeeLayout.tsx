import { RouteOutletTransition } from "../components/RouteOutletTransition";
import { useEffect, useState } from "react";
import { useMobileMenuState } from "../hooks/useMobileMenuState";
import { DashboardHeader } from "../components/DashboardHeader";
import { Footer } from "../components/Footer";
import { useAuth } from "../hooks/useAuth";
import { SidebarSkeleton } from "../components/ui/sidebar-skeleton";
import { EmployeeSidebar } from "../components/employee/EmployeeSidebar";
import { EmployeeMobileSidebar } from "../components/employee/EmployeeMobileSidebar";
import { getEmployeeProfile } from "../lib/api";
import { EMPLOYEE_DASHBOARD_ROOT } from "../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";
import { PushNotificationSync } from "../components/PushNotificationSync";
import { NotificationInboxSync } from "../components/NotificationInboxSync";
import { RouteChunkBoundary } from "../routing/RouteChunkBoundary";
import { useDashboardLayoutPaintReady, useGlobalAppLoadingActive } from "../lib/globalAppLoading";
import { useWarmPrefetchAuthLoginRoute } from "../lib/useWarmPrefetchAuthLoginRoute";
import { useWarmPrefetchLandingRoute } from "../lib/useWarmPrefetchLandingRoute";
import { EmployeeEntitlementsProvider } from "../contexts/EmployeeEntitlementsContext";
import { useMinWidthMedia } from "@/lib/motionPerf";
import {
  useDashboardHeaderProfile,
  useDashboardLayoutProfile,
  useDashboardRenderProbe,
  useDashboardSidebarProfile,
  DashboardReactProfiler,
} from "../hooks/useDashboardRuntimeProfile";

type EmployeeBusinessBranding = {
  businessLogo: string | null;
  businessName: string;
};

/**
 * Staff shell: child routes render each employee page.
 */
export function EmployeeLayout() {
  const { mobileMenuOpen, openMobileMenu, closeMobileMenu } = useMobileMenuState();
  const { user, authStatus } = useAuth();
  const isAppReady = authStatus === "authenticated" && user?.role === "employee";
  const isLargeScreen = useMinWidthMedia(1024);
  const globalLoaderActive = useGlobalAppLoadingActive();
  const [branding, setBranding] = useState<EmployeeBusinessBranding | null>(null);

  useDashboardLayoutProfile("employee");
  useDashboardSidebarProfile("employee", Boolean(isAppReady && isLargeScreen));
  useDashboardHeaderProfile("employee");
  useDashboardRenderProbe("employee:EmployeeLayout");

  useEffect(() => {
    if (authStatus !== "authenticated" || user?.role !== "employee") return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getEmployeeProfile();
        if (cancelled) return;
        setBranding({
          businessLogo: p.businessLogo ?? null,
          businessName: p.businessName ?? "Business",
        });
      } catch {
        if (cancelled) return;
        setBranding(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, user?.role]);

  useDashboardLayoutPaintReady("employee-layout-paint", isAppReady);
  useWarmPrefetchAuthLoginRoute("/login", isAppReady);
  useWarmPrefetchLandingRoute(isAppReady);

  return (
    <EmployeeEntitlementsProvider>
      <div className="relative min-h-screen bg-background">
        <PushNotificationSync />
        <NotificationInboxSync />
        <div className="relative z-10">
          {isAppReady ? (
            isLargeScreen ? <EmployeeSidebar businessBranding={branding} /> : null
          ) : isLargeScreen && !globalLoaderActive ? (
            <SidebarSkeleton />
          ) : null}
          <EmployeeMobileSidebar
            isOpen={mobileMenuOpen}
            onClose={closeMobileMenu}
            businessBranding={branding}
          />

          <div
            className={cn(
              "caretip-dashboard-shell dashboard-workspace font-sans flex min-h-screen min-w-0 flex-col overflow-x-hidden lg:pl-64",
              EMPLOYEE_DASHBOARD_ROOT,
            )}
          >
            <DashboardHeader onMenuClick={openMobileMenu} />
            <main className="caretip-dashboard-page-enter min-w-0 flex-1 overflow-x-clip">
              <RouteChunkBoundary variant="shell" registrationKey="employee-outlet">
                <DashboardReactProfiler id="employee:Outlet">
                  <RouteOutletTransition />
                </DashboardReactProfiler>
              </RouteChunkBoundary>
            </main>
            <Footer variant="minimal" />
          </div>
        </div>
      </div>
    </EmployeeEntitlementsProvider>
  );
}
