/**
 * Pre-React boot locale — runs in <head> (CSP-safe external file).
 * Visibility of `#caretip-html-boot` is CSS, not this script.
 * Must stay in sync with:
 *   - `I18N_STORAGE_KEY` / `readStoredLanguage` (src/i18n)
 *   - `resolveInitialBootLoadingMessage` (src/app/lib/appLoadingContexts.ts)
 *   - `common.gettingReady` / guest-journey keys in locale JSON
 * One sentence only — never pair a tagline with a second boot line.
 */
(function (global) {
  var STORAGE_KEY = "caretip_i18n_language";

  /** Default for the German product surface when no preference is stored. */
  function readBootLanguage() {
    try {
      var v = global.localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "de") return v;
    } catch {
      /* ignore */
    }
    return "de";
  }

  var COPY = {
    de: {
      gettingReady: "Wird eingerichtet…",
      settingUpWorkspace: "Ihr Bereich wird eingerichtet…",
      sessionCheck: "Ihr Konto wird vorbereitet…",
      tipPage: "Ihre Trinkgeldseite wird geöffnet…",
      checkout: "Sicherer Checkout wird vorbereitet…",
      stripeReturn: "Ihr Trinkgeld wird bestätigt…",
      finishing: "Gleich geschafft…",
    },
    en: {
      gettingReady: "Getting things ready…",
      settingUpWorkspace: "Setting up your workspace…",
      sessionCheck: "Getting your account ready…",
      tipPage: "Opening your tip page…",
      checkout: "Preparing secure checkout…",
      stripeReturn: "Confirming your tip…",
      finishing: "Almost there…",
    },
  };

  function resolveBootTagline(copy, pathname) {
    var path = String(pathname || "/").split("?")[0].split("#")[0];
    if (path === "/payment") return copy.checkout;
    if (path === "/success" || path === "/rating") return copy.stripeReturn;
    if (path === "/tip-complete") return copy.finishing;
    if (path.indexOf("/onboarding") === 0) return copy.settingUpWorkspace;
    if (
      path === "/tip-amount" ||
      path === "/select-employee" ||
      path.indexOf("/staff/") === 0 ||
      path.indexOf("/qr/") === 0 ||
      path.indexOf("/qr-landing/") === 0 ||
      path.indexOf("/table/") === 0
    ) {
      return copy.tipPage;
    }
    return copy.gettingReady;
  }

  global.CareTipBootLocale = {
    STORAGE_KEY: STORAGE_KEY,
    readBootLanguage: readBootLanguage,
    getCopy: function (lng) {
      return COPY[lng === "en" ? "en" : "de"];
    },
    resolveBootTagline: resolveBootTagline,
  };

  /**
   * Locale/tagline only. Visibility is CSS (`display: flex` + `caretip-html-boot-active` on <html>).
   * Must not live in an inline <script>: production CSP is script-src 'self' (no 'unsafe-inline').
   */
  function applyHtmlBootCopy() {
    try {
      var lng = readBootLanguage();
      var copy = COPY[lng === "en" ? "en" : "de"];
      var tagline = resolveBootTagline(copy, global.location && global.location.pathname);
      var doc = global.document;
      if (!doc) return;
      doc.documentElement.setAttribute("lang", lng);
      doc.documentElement.classList.add("caretip-html-boot-active");
      var taglineEl = doc.getElementById("caretip-html-boot-tagline");
      if (taglineEl) taglineEl.textContent = tagline;
      var el = doc.getElementById("caretip-html-boot");
      if (el) {
        el.setAttribute("aria-label", "CareTip — " + tagline);
        el.removeAttribute("hidden");
      }
    } catch (_) {
      /* ignore */
    }
  }

  try {
    var docEl = global.document && global.document.documentElement;
    if (docEl) {
      var bootLng = readBootLanguage();
      docEl.setAttribute("lang", bootLng);
      docEl.classList.add("caretip-html-boot-active");
    }
  } catch (_) {
    /* ignore */
  }

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", applyHtmlBootCopy);
    } else {
      applyHtmlBootCopy();
    }
  }
})(
  typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined"
    ? globalThis.window
    : globalThis,
);
