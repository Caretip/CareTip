import "./styles/caretip-inter-vite.css";
import "./lib/fonts/inter";
import "./app/lib/pwaInstallDeferred";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { GlobalErrorBoundary } from "./app/components/GlobalErrorBoundary";
import { dismissHtmlMarketingBootBridge } from "./app/lib/htmlMarketingBootBridge";
import { wakeRemoteApi, migrateLegacyAccessTokenFromStorage } from "./app/lib/api";
import { recoverStaleChunkOnce } from "./app/lib/chunkLoadRecovery";
import { scheduleMobileDeferredWork } from "./lib/mobilePerf";
import { ensureI18nReady } from "./i18n/i18n";
import { removeStaticCrawlerSummary } from "./app/lib/seo/documentSeo";
import "./styles/index.css";

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recoverStaleChunkOnce();
  });
}

function paintBootstrapFailure(): void {
  dismissHtmlMarketingBootBridge();
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.setAttribute("data-caretip-bootstrap-failure", "");
  wrap.style.minHeight = "100dvh";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.background = "#fcfbf8";
  wrap.style.padding = "24px";
  wrap.style.fontFamily = "system-ui,sans-serif";
  const card = document.createElement("div");
  card.style.textAlign = "center";
  card.style.maxWidth = "28rem";
  const title = document.createElement("h1");
  title.style.fontSize = "1.25rem";
  title.style.color = "#1a1a1a";
  title.textContent = "CareTip couldn’t start";
  const body = document.createElement("p");
  body.style.marginTop = "8px";
  body.style.color = "#5c5c5c";
  body.style.fontSize = "0.875rem";
  body.textContent = "Refresh the page. If this keeps happening, try again in a moment.";
  const button = document.createElement("button");
  button.type = "button";
  button.style.marginTop = "24px";
  button.style.padding = "10px 20px";
  button.style.borderRadius = "8px";
  button.style.background = "#c45c26";
  button.style.color = "#fff";
  button.style.border = "0";
  button.style.cursor = "pointer";
  button.textContent = "Refresh";
  button.addEventListener("click", () => window.location.reload());
  card.append(title, body, button);
  wrap.appendChild(card);
  root.appendChild(wrap);
}

/** Manrope display font — marketing headings only; skip on auth/admin shells. */
function scheduleHeroDisplayFont(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  const marketingDisplay =
    p === "/" ||
    p === "/pricing" ||
    p === "/features" ||
    p === "/contact" ||
    p === "/faq" ||
    p === "/terms" ||
    p === "/cookies" ||
    p === "/mobile-app" ||
    p === "/careers" ||
    p === "/blog" ||
    p.startsWith("/hero");
  if (marketingDisplay) {
    void import("./lib/fonts/heroDisplay");
  }
}

scheduleHeroDisplayFont();
migrateLegacyAccessTokenFromStorage();

/** Overlap high-traffic public page JS with i18n JSON (avoids cold chunk waterfalls). */
function prefetchPublicEntryGraph(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (p === "/") {
    void import("./app/pages/LandingPage");
    return;
  }
  if (p === "/pricing") {
    void import("./app/pages/PricingPage");
    return;
  }
  if (p === "/contact") {
    void import("./app/pages/ContactPage");
    return;
  }
  if (p === "/features") {
    void import("./app/pages/FeaturesPage");
  }
}
prefetchPublicEntryGraph();

scheduleMobileDeferredWork(() => wakeRemoteApi(), { mobileTimeoutMs: 3500, desktopTimeoutMs: 900 });

if (import.meta.env.PROD) {
  scheduleMobileDeferredWork(
    () => {
      void import("virtual:pwa-register").then(({ registerSW }) => {
        const updateSW = registerSW({
          immediate: true,
          onNeedRefresh() {
            updateSW(true);
          },
        });
      });
    },
    { mobileTimeoutMs: 4500, desktopTimeoutMs: 2000 },
  );
}

void ensureI18nReady()
  .then(() => {
    removeStaticCrawlerSummary();
    createRoot(document.getElementById("root")!).render(
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>,
    );
  })
  .catch((error) => {
    console.error("[CareTip] Bootstrap failed:", error);
    paintBootstrapFailure();
  });
