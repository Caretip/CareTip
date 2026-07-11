import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAiAssistantEnabled } from "../lib/featureFlags";
import { useLandingShellReady } from "../lib/useLandingShellReady";
import { Navigation } from "../components/Navigation";
import { CareTipLandingHero } from "@/components/landing/CareTipLandingHero";
import { Footer } from "../components/Footer";
import { LandingPageBelowFold } from "./LandingPageBelowFold";
import "@/styles/bundles/marketing-shell.css";
import "@/styles/bundles/landing.css";

/** Landing has no email/password forms; autofill mitigations live on `AuthPage` (login/signup). */
export function LandingPage() {
  const { t, i18n } = useTranslation();
  const [landingRoot, setLandingRoot] = useState<HTMLDivElement | null>(null);
  const isDe = i18n.language?.toLowerCase().startsWith("de");

  useLandingShellReady("about-section");

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
        <div className="fixed top-0 left-0 right-0 z-50 w-full max-w-[100vw] overflow-x-clip">
          <Navigation />
        </div>
        <main className="caretip-landing-main caretip-page-enter w-full min-w-0 overflow-x-hidden">
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
