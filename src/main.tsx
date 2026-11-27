import "./styles/caretip-inter-vite.css";
import "./lib/fonts/inter";
import "./app/lib/pwaInstallDeferred";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { GlobalErrorBoundary } from "./app/components/GlobalErrorBoundary";
import { dismissHtmlMarketingBootBridge } from "./app/lib/htmlMarketingBootBridge";
import { wakeRemoteApi, migrateLegacyAccessTokenFromStorage } from "./app/lib/api";
import { handleVitePreloadError, startDeployUpdateRuntime } from "./app/lib/deployUpdate/runtime";
import { registerCaretipServiceWorker } from "./app/lib/deployUpdate/serviceWorkerRegistration";
import { scheduleMobileDeferredWork } from "./lib/mobilePerf";
import { landingI18nPreload } from "./i18n/preloadLocale";
import { ensureFullLocale } from "./i18n/i18n";
import { registerRouteModulePrerequisite } from "./app/lib/chunkLoadRecovery";
import { loadLandingStyles } from "./app/lib/landingStyles";
import { prefetchCustomerEntryGraph } from "./app/lib/prefetchCustomerEntryGraph";
import { markLandingColdLoad } from "./app/lib/landingColdLoadMarks";
import { removeStaticCrawlerSummary } from "./app/lib/seo/documentSeo";
import "./styles/index.css";
import "./styles/caretip-signature.css";
import "./styles/caretip-mobile-menu.css";

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", handleVitePreloadError);
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
prefetchCustomerEntryGraph();

scheduleMobileDeferredWork(() => wakeRemoteApi(), { mobileTimeoutMs: 3500, desktopTimeoutMs: 900 });

if (import.meta.env.PROD) {
  scheduleMobileDeferredWork(
    () => {
      registerCaretipServiceWorker();
      startDeployUpdateRuntime();
    },
    { mobileTimeoutMs: 4500, desktopTimeoutMs: 2000 },
  );
}

markLandingColdLoad("react-start");

/**
 * The entry stylesheet is not render-blocking (vite.config.ts `nonBlockingMainStylesheetPlugin`):
 * theme-init.js inserts it from script so the inline-styled boot cover paints at once. React mounts
 * only once it has loaded. A failed download mounts anyway, as a failed render-blocking link did.
 */
function mainStylesheetReady(): Promise<void> {
  let sheet = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][data-caretip-main-css]');
  if (!sheet) {
    const preload = document.querySelector<HTMLLinkElement>('link[rel="preload"][data-caretip-main-css]');
    if (!preload) return Promise.resolve(); // dev server: Vite injects CSS from JavaScript
    // theme-init.js did not run: insert it here, in the preload's place in <head>.
    sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.crossOrigin = "anonymous";
    sheet.href = preload.href;
    sheet.setAttribute("data-caretip-main-css", "");
    preload.after(sheet);
  }
  if (sheet.sheet || sheet.hasAttribute("data-caretip-settled")) return Promise.resolve();
  const link = sheet;
  return new Promise((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });
}

const isHomePage = window.location.pathname === "/";
const mainStyles = mainStylesheetReady();
// The home page must not paint unstyled, and its boot handoff waits for the real hero.
const firstPaintStyles = isHomePage ? loadLandingStyles() : Promise.resolve();
// The homepage needs only the core translations; every other entry gets them all before it paints.
const localeReady = isHomePage ? landingI18nPreload : Promise.all([landingI18nPreload, ensureFullLocale()]);
// Lazy routes (navigation from the homepage included) wait for the full translations with their code.
registerRouteModulePrerequisite(() => ensureFullLocale());

void Promise.all([localeReady, firstPaintStyles, mainStyles])
  .then(() => {
    markLandingColdLoad("i18n-ready");
    removeStaticCrawlerSummary();
    createRoot(document.getElementById("root")!).render(
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>,
    );
    if (isHomePage) {
      // After the hero: fetch the rest of the translations so the next page does not wait for them.
      scheduleMobileDeferredWork(() => void ensureFullLocale().catch(() => {}), {
        mobileTimeoutMs: 2500,
        desktopTimeoutMs: 800,
      });
    }
  })
  .catch((error) => {
    console.error("[CareTip] Bootstrap failed:", error);
    paintBootstrapFailure();
  });
