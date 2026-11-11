import { useEffect, useState } from "react";
import { Outlet, useMatch, useNavigation } from "react-router";
import "@/styles/bundles/marketing-shell.css";
import { Navigation } from "../components/Navigation";
import { MarketingShellProvider } from "../context/MarketingShellContext";
import { RouteChunkBoundary } from "../routing/RouteChunkBoundary";
import { RootSpaRouteHold } from "../routing/RootSpaRouteHold";
import { landingStylesLoaded, loadLandingStyles } from "../lib/landingStyles";
import { cn } from "@/lib/utils";

/**
 * Persistent marketing chrome — Navigation stays mounted across public marketing child routes.
 * Lazy page modules suspend inside the outlet only (not the root RR tree).
 */
export function MarketingShellLayout() {
  const onLanding = useMatch({ path: "/", end: true }) != null;
  const navigation = useNavigation();
  const outletBusy = navigation.state === "loading";
  const [stylesReady, setStylesReady] = useState(landingStylesLoaded);

  // Arriving from a dashboard or a guest page: these styles have not been needed until now.
  useEffect(() => {
    if (stylesReady) return;
    let active = true;
    const release = () => {
      if (active) setStylesReady(true);
    };
    void loadLandingStyles().then(release, release);
    return () => {
      active = false;
    };
  }, [stylesReady]);

  if (!stylesReady) return <RootSpaRouteHold />;

  return (
    <MarketingShellProvider>
      <div
        className={cn(
          "caretip-marketing-shell relative min-h-[100dvh] w-full min-w-0 font-sans",
          onLanding ? "caretip-marketing-shell--landing" : "caretip-marketing-page bg-background",
        )}
        data-caretip-marketing-shell=""
      >
        <div className={cn(onLanding ? "caretip-landing-nav-shell" : "relative z-20")}>
          <Navigation />
        </div>
        <RouteChunkBoundary variant="marketing" registrationKey="marketing-outlet">
          <div
            className={cn(
              "caretip-marketing-outlet relative z-10 min-w-0",
              outletBusy && "pointer-events-none",
            )}
            aria-busy={outletBusy}
          >
            <Outlet />
          </div>
        </RouteChunkBoundary>
      </div>
    </MarketingShellProvider>
  );
}
