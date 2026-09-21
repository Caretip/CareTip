import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAiAssistantEnabled } from "../lib/featureFlags";
import { Navigation } from "../components/Navigation";
import { LANDING_HERO_SLOT_ID } from "@/app/components/landing/LandingHeroPersistenceLayer";
import { Footer } from "../components/Footer";
import { LandingPageBelowFold, prefetchLandingBelowFoldSections } from "./LandingPageBelowFold";
import { warmLandingHeroLcpImage } from "@/lib/landingHeroStoryAssets";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";
import {
  consumeLandingPaintRecovery,
  dispatchLandingMediaResume,
  noteLandingDocumentHidden,
  refreshLandingDecodedImages,
  syncDocumentHiddenClass,
} from "@/lib/landingMediaResume";
import "@/styles/bundles/marketing-shell.css";
import "@/styles/bundles/landing.css";

/** Begin LCP warm as soon as the landing chunk evaluates (SPA + cold). */
void warmLandingHeroLcpImage().then(() => {
  scheduleMobileDeferredWork(() => prefetchLandingBelowFoldSections(), {
    desktopTimeoutMs: 120,
    mobileTimeoutMs: 420,
  });
});

/** Landing has no email/password forms; autofill mitigations live on `AuthPage` (login/signup). */
export function LandingPage() {
  const { t } = useTranslation();
  const [landingRoot, setLandingRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    syncDocumentHiddenClass();

    const recoverPaintIfNeeded = () => {
      if (!consumeLandingPaintRecovery()) return;
      dispatchLandingMediaResume();
      requestAnimationFrame(() => refreshLandingDecodedImages());
    };

    const onVisibility = () => {
      syncDocumentHiddenClass();
      if (document.visibilityState === "hidden") {
        noteLandingDocumentHidden();
        return;
      }
      recoverPaintIfNeeded();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      syncDocumentHiddenClass();
      if (event.persisted) noteLandingDocumentHidden();
      recoverPaintIfNeeded();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      document.documentElement.classList.remove("caretip-document-hidden");
    };
  }, []);

  return (
    <div
      ref={setLandingRoot}
      data-caretip-route-ready=""
      className="caretip-landing caretip-landing--premium caretip-marketing-page relative min-h-screen w-full min-w-0 bg-background font-sans"
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 bottom-0 z-0 min-h-[100dvh]"
      />
      <div className="relative z-10 w-full min-w-0">
        <div className="caretip-landing-nav-shell">
          <Navigation />
        </div>
        <main className="caretip-landing-main w-full min-w-0 overflow-x-hidden">
          <div id={LANDING_HERO_SLOT_ID} />
          <LandingPageBelowFold />
        </main>
        <Footer className="caretip-landing-footer" />
      </div>
      <LandingAiAssistantHost rootEl={landingRoot} />
    </div>
  );
}

function LandingAiAssistantHost({ rootEl }: { rootEl: HTMLDivElement | null }) {
  const [Host, setHost] = useState<typeof import("../components/landing/LandingOnboardingAssistantHost").LandingOnboardingAssistantHost | null>(null);

  useEffect(() => {
    if (!isAiAssistantEnabled()) return;
    let cancelled = false;
    void import("../components/landing/LandingOnboardingAssistantHost").then((mod) => {
      if (!cancelled) setHost(() => mod.LandingOnboardingAssistantHost);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Host) return null;
  return <Host rootEl={rootEl} />;
}
