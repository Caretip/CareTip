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
  wrap.innerHTML =
    '<div style="text-align:center;max-width:28rem"><h1 style="font-size:1.25rem;color:#1a1a1a">CareTip couldn’t start</h1><p style="margin-top:8px;color:#5c5c5c;font-size:0.875rem">Refresh the page. If this keeps happening, try again in a moment.</p><button type="button" style="margin-top:24px;padding:10px 20px;border-radius:8px;background:#c45c26;color:#fff;border:0;cursor:pointer">Refresh</button></div>';
  wrap.querySelector("button")?.addEventListener("click", () => window.location.reload());
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
    p === "/how-it-works" ||
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

/** Overlap landing JS with i18n JSON so `/` is not a waterfall. */
function prefetchPublicEntryGraph(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (p === "/") {
    void import("./app/pages/LandingPage");
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
