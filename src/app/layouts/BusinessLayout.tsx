import { useEffect, useRef } from "react";
import { RouteOutletTransition } from "../components/RouteOutletTransition";
import { BusinessSidebar } from "../components/business/BusinessSidebar";
import { BusinessMobileSidebar } from "../components/business/BusinessMobileSidebar";
import { DashboardHeader } from "../components/DashboardHeader";
import { Footer } from "../components/Footer";
import { useAuth } from "../hooks/useAuth";
import { SidebarSkeleton } from "../components/ui/sidebar-skeleton";
import { BUSINESS_DASHBOARD_ROOT } from "../components/business/businessDashboardUi";
import { cn } from "@/lib/utils";
import { PushNotificationSync } from "../components/PushNotificationSync";
import { NotificationInboxSync } from "../components/NotificationInboxSync";
import { BusinessVerificationRealtimeSync } from "../components/BusinessVerificationRealtimeSync";
import { RouteChunkBoundary } from "../routing/RouteChunkBoundary";
import { DashboardReactProfiler } from "../hooks/useDashboardRuntimeProfile";
import { useDashboardLayoutPaintReady, useGlobalAppLoadingActive } from "../lib/globalAppLoading";
import { useWarmPrefetchAuthLoginRoute } from "../lib/useWarmPrefetchAuthLoginRoute";
import { useWarmPrefetchLandingRoute } from "../lib/useWarmPrefetchLandingRoute";
import { VerificationPendingBanner } from "../components/business/VerificationPendingBanner";
import { useMobileMenuState } from "../hooks/useMobileMenuState";
import { useCommercialPageTracking } from "../hooks/useCommercialPageTracking";
import { BusinessEntitlementsProvider } from "../contexts/BusinessEntitlementsContext";
import { BusinessGuidelinesProvider } from "../contexts/BusinessGuidelinesContext";
import { BusinessFeatureInfoDrawerProvider } from "../components/business/BusinessFeatureInfoDrawerProvider";
import { sessionHasActiveEntitlements } from "../lib/subscriptionEntitlementFastPath";
import { useMinWidthMedia } from "@/lib/motionPerf";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";
import { markPostLoginTrace } from "../lib/postLoginRuntimeTrace";
import {
  useDashboardHeaderProfile,
  useDashboardLayoutProfile,
  useDashboardRenderProbe,
  useDashboardSidebarProfile,
} from "../hooks/useDashboardRuntimeProfile";

/**
 * Approved business manager shell: admin-style sidebar + top bar + footer.
 * Child routes render page content only (no duplicate shells).
 */
export function BusinessLayout() {
  const { mobileMenuOpen, openMobileMenu, closeMobileMenu } = useMobileMenuState();
  const { user, authStatus } = useAuth();
  const isAppReady = authStatus === "authenticated" && user?.role === "business";
  const isLargeScreen = useMinWidthMedia(1024);
  const globalLoaderActive = useGlobalAppLoadingActive();
  const firstRenderLogged = useRef(false);
  const sidebarLogged = useRef(false);
  const headerLogged = useRef(false);

  if (import.meta.env.DEV && !firstRenderLogged.current) {
    firstRenderLogged.current = true;
    markPostLoginTrace("BusinessLayout_first_render", {
      isAppReady,
      authStatus,
      role: user?.role ?? null,
      globalLoaderActive,
      isLargeScreen,
    });
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    markPostLoginTrace("BusinessLayout_mounted", {
      isAppReady,
      authStatus,
      role: user?.role ?? null,
    });
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !isAppReady) return;
    markPostLoginTrace("BusinessLayout_shell_ready_state", {
      sidebar: isLargeScreen,
      header: true,
    });
  }, [isAppReady, isLargeScreen]);

  useDashboardLayoutProfile("business");
  useDashboardSidebarProfile("business", Boolean(isAppReady && isLargeScreen));
  useDashboardHeaderProfile("business");
  useDashboardRenderProbe("business:BusinessLayout");

  useDashboardLayoutPaintReady("business-layout-paint", isAppReady);
  useWarmPrefetchAuthLoginRoute("/login", isAppReady);
  useWarmPrefetchLandingRoute(isAppReady);
  useCommercialPageTracking(isAppReady && !user?.impersonation);

  useEffect(() => {
    if (!isAppReady || user?.impersonation) return;
    if (!sessionHasActiveEntitlements()) return;
    scheduleMobileDeferredWork(() => {
      void import("../lib/qrStudioWarmCache").then(({ preloadQrStudioDashboardData }) => {
        preloadQrStudioDashboardData();
      });
    });
  }, [isAppReady, user?.impersonation]);

  if (import.meta.env.DEV && isAppReady && isLargeScreen && !sidebarLogged.current) {
    sidebarLogged.current = true;
    markPostLoginTrace("Sidebar_rendered");
  }
  if (import.meta.env.DEV && !headerLogged.current) {
    headerLogged.current = true;
    markPostLoginTrace("Header_rendered");
  }

  return (
    <BusinessGuidelinesProvider>
      <div className="relative min-h-screen bg-background">
        <PushNotificationSync />
        <NotificationInboxSync />
        <BusinessVerificationRealtimeSync enabled={Boolean(isAppReady && !user?.impersonation)} />
        {/* Suppressed on /dashboard — inline card there; see businessVerificationNotice.ts */}
        <VerificationPendingBanner />
        <div className="relative z-10">
          {isAppReady ? (
            isLargeScreen ? <BusinessSidebar /> : null
          ) : isLargeScreen && !globalLoaderActive ? (
            <SidebarSkeleton />
          ) : null}
          <BusinessMobileSidebar isOpen={mobileMenuOpen} onClose={closeMobileMenu} />
          <div
            className={cn(
              "caretip-dashboard-shell dashboard-workspace font-sans flex min-h-screen min-w-0 flex-col overflow-x-hidden lg:pl-64",
              BUSINESS_DASHBOARD_ROOT,
            )}
          >
            <DashboardHeader onMenuClick={openMobileMenu} />
            <main className="caretip-dashboard-page-enter min-w-0 flex-1 overflow-x-clip">
              <RouteChunkBoundary variant="shell" registrationKey="business-outlet">
                <BusinessEntitlementsProvider>
                  <BusinessFeatureInfoDrawerProvider>
                    <DashboardReactProfiler id="business:Outlet">
                      <RouteOutletTransition />
                    </DashboardReactProfiler>
                  </BusinessFeatureInfoDrawerProvider>
                </BusinessEntitlementsProvider>
              </RouteChunkBoundary>
            </main>
            <Footer variant="minimal" />
          </div>
        </div>
      </div>
    </BusinessGuidelinesProvider>
  );
}
