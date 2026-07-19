import { RouteOutletTransition } from "../components/RouteOutletTransition";
import { AdminSidebar } from "../components/AdminSidebar";
import { AdminMobileSidebar } from "../components/AdminMobileSidebar";
import { DashboardHeader } from "../components/DashboardHeader";
import { Footer } from "../components/Footer";
import { useAuth } from "../hooks/useAuth";
import { SidebarSkeleton } from "../components/ui/sidebar-skeleton";
import { PLATFORM_DASHBOARD_ROOT } from "../components/platform/platformDashboardUi";
import { PushNotificationSync } from "../components/PushNotificationSync";
import { NotificationInboxSync } from "../components/NotificationInboxSync";
import { RouteChunkBoundary } from "../routing/RouteChunkBoundary";
import { cn } from "@/lib/utils";
import { useDashboardLayoutPaintReady, useGlobalAppLoadingActive } from "../lib/globalAppLoading";
import { useWarmPrefetchAuthLoginRoute } from "../lib/useWarmPrefetchAuthLoginRoute";
import { useWarmPrefetchLandingRoute } from "../lib/useWarmPrefetchLandingRoute";
import { useMobileMenuState } from "../hooks/useMobileMenuState";
import { useMinWidthMedia } from "@/lib/motionPerf";
import {
  useDashboardHeaderProfile,
  useDashboardLayoutProfile,
  useDashboardRenderProbe,
  useDashboardSidebarProfile,
  DashboardReactProfiler,
} from "../hooks/useDashboardRuntimeProfile";

/**
 * Platform / Super Admin shell only: sidebar, platform header, footer.
 * Child routes render page content (no shared "Dashboard" with business).
 */
export function SuperAdminLayout() {
  const { mobileMenuOpen, openMobileMenu, closeMobileMenu } = useMobileMenuState();
  const { user, authStatus } = useAuth();
  const isAppReady = authStatus === "authenticated" && user?.role === "platform_admin";
  const isLargeScreen = useMinWidthMedia(1024);
  const globalLoaderActive = useGlobalAppLoadingActive();

  useDashboardLayoutPaintReady("platform-admin-layout-paint", isAppReady);
  useWarmPrefetchAuthLoginRoute("/platform-admin/login", isAppReady);
  useWarmPrefetchLandingRoute(isAppReady);
  useDashboardLayoutProfile("platform_admin");
  useDashboardSidebarProfile("platform_admin", Boolean(isAppReady && isLargeScreen));
  useDashboardHeaderProfile("platform_admin");
  useDashboardRenderProbe("platform_admin:SuperAdminLayout");

  return (
    <div className="relative min-h-screen bg-background">
      <PushNotificationSync />
      <NotificationInboxSync />
      <div className="relative z-10">
        {isAppReady ? (
          isLargeScreen ? <AdminSidebar /> : null
        ) : isLargeScreen && !globalLoaderActive ? (
          <SidebarSkeleton />
        ) : null}
        <AdminMobileSidebar isOpen={mobileMenuOpen} onClose={closeMobileMenu} />
        <div
          className={cn(
            "caretip-dashboard-shell dashboard-workspace font-sans flex min-h-screen min-w-0 flex-col overflow-x-hidden lg:pl-64",
            PLATFORM_DASHBOARD_ROOT,
          )}
        >
          <DashboardHeader onMenuClick={openMobileMenu} />
          <main className="caretip-dashboard-page-enter min-w-0 flex-1 overflow-x-clip">
            <RouteChunkBoundary variant="shell">
              <DashboardReactProfiler id="platform_admin:Outlet">
                <RouteOutletTransition />
              </DashboardReactProfiler>
            </RouteChunkBoundary>
          </main>
          <Footer variant="minimal" />
        </div>
      </div>
    </div>
  );
}
