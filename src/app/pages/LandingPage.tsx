import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAiAssistantEnabled } from "../lib/featureFlags";
import { useLandingShellReady } from "../lib/useLandingShellReady";
import { Navigation } from "../components/Navigation";
import { CareTipLandingHero } from "@/components/landing/CareTipLandingHero";
import { Footer } from "../components/Footer";
import { LandingPageBelowFold, prefetchLandingBelowFoldSections } from "./LandingPageBelowFold";
import { warmLandingHeroLcpImage } from "@/lib/landingHeroStoryAssets";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";
import {
  dispatchLandingMediaResume,
  refreshLandingDecodedImages,
  syncDocumentHiddenClass,
} from "@/lib/landingMediaResume";
import "@/styles/bundles/marketing-shell.css";
import "@/styles/bundles/landing.css";

/** Begin LCP warm as soon as the landing chunk evaluates (SPA + cold). */
void warmLandingHeroLcpImage().then(() => {
  scheduleMobileDeferredWork(() => prefetchLandingBelowFoldSections(), {
    desktopTimeoutMs: 280,
    mobileTimeoutMs: 900,
  });
});

/** Landing has no email/password forms; autofill mitigations live on `AuthPage` (login/signup). */
export function LandingPage() {
  const { t, i18n } = useTranslation();
  const [landingRoot, setLandingRoot] = useState<HTMLDivElement | null>(null);
  const isDe = i18n.language?.toLowerCase().startsWith("de");

  useLandingShellReady("about-section");

  useEffect(() => {
    syncDocumentHiddenClass();
    const onVisibility = () => {
      syncDocumentHiddenClass();
      if (document.visibilityState === "visible") {
        dispatchLandingMediaResume();
        requestAnimationFrame(() => refreshLandingDecodedImages());
      }
    };
    const onPageShow = () => {
      syncDocumentHiddenClass();
      dispatchLandingMediaResume();
      requestAnimationFrame(() => refreshLandingDecodedImages());
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
          <CareTipLandingHero
            id="about-section"
            imageAlt={t("landing.showcase.tabQrAlt")}
            isDe={isDe}
          />
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
