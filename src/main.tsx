import "./styles/caretip-inter-vite.css";
import "./lib/fonts/inter";
import "./app/lib/pwaInstallDeferred";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { GlobalErrorBoundary } from "./app/components/GlobalErrorBoundary";
import { dismissHtmlMarketingBootBridge } from "./app/lib/htmlMarketingBootBridge";
import { wakeRemoteApi, migrateLegacyAccessTokenFromStorage } from "./app/lib/api";
import { scheduleMobileDeferredWork } from "./lib/mobilePerf";
import { ensureI18nReady } from "./i18n/i18n";
import { initSentry } from "./app/lib/sentry";
import { initGoogleAdsConversion } from "./app/lib/googleAdsConversion";
import "./styles/index.css";

/** Manrope display font — marketing headings only; skip on auth/admin shells. */
function scheduleHeroDisplayFont(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  const marketingDisplay =
    p === "/" ||
    p === "/pricing" ||
    p === "/features" ||
    p === "/how-it-works" ||
    p === "/contact" ||
    p === "/faq" ||
    p === "/mobile-app" ||
    p === "/careers" ||
    p === "/blog" ||
    p.startsWith("/hero");
  if (marketingDisplay) {
    void import("./lib/fonts/heroDisplay");
  }
}

scheduleHeroDisplayFont();
initGoogleAdsConversion();

initSentry();
migrateLegacyAccessTokenFromStorage();
scheduleMobileDeferredWork(() => wakeRemoteApi(), { mobileTimeoutMs: 3500, desktopTimeoutMs: 900 });

if (import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateSW(true);
      },
    });
  });
}

void ensureI18nReady()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>,
    );
  })
  .catch((error) => {
    console.error("[CareTip] Bootstrap failed:", error);
    dismissHtmlMarketingBootBridge();
  });
