/**
 * Pre-React boot locale — runs immediately after `#caretip-html-boot` (CSP-safe external file).
 * Visibility of `#caretip-html-boot` is CSS (`html.caretip-html-boot-active`), not this script.
 * Must stay in sync with:
 *   - `I18N_STORAGE_KEY` / `readStoredLanguage` (src/i18n)
 *   - `resolveCustomerJourneyBootContext` (src/app/lib/appLoadingContexts.ts)
 *   - `RESERVED_TOP_LEVEL_SEGMENTS` (src/app/lib/publicRoutes.ts)
 *   - `common.gettingReady` / guest-journey keys in locale JSON
 * One sentence only — never pair a tagline with a second boot line.
 */
(function (global) {
  var STORAGE_KEY = "caretip_i18n_language";

  /** Keep in sync with `RESERVED_TOP_LEVEL_SEGMENTS` in publicRoutes.ts */
  var RESERVED_TOP = {
    admin: 1,
    auth: 1,
    activate: 1,
    blog: 1,
    business: 1,
    "business-dashboard": 1,
    careers: 1,
    "check-email": 1,
    contact: 1,
    cookies: 1,
    "create-rule": 1,
    "create-skill": 1,
    dashboard: 1,
    employee: 1,
    "employee-dashboard": 1,
    faq: 1,
    features: 1,
    "forgot-password": 1,
    "get-started": 1,
    help: 1,
    "hero-animation-demo": 1,
    "hero-demo": 1,
    "how-it-works": 1,
    imprint: 1,
    join: 1,
    login: 1,
    "mobile-app": 1,
    onboarding: 1,
    payment: 1,
    "platform-admin": 1,
    pricing: 1,
    privacy: 1,
    qr: 1,
    "qr-landing": 1,
    rating: 1,
    "reset-password": 1,
    "saas-3d-hero": 1,
    "select-employee": 1,
    signup: 1,
    staff: 1,
    success: 1,
    table: 1,
    terms: 1,
    "tip-amount": 1,
    "tip-complete": 1,
    unauthorized: 1,
    "verification-pending": 1,
    verify: 1,
    "verify-email": 1,
  };

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

  function isGuestSlugPath(path) {
    var parts = String(path || "/")
      .split("/")
      .filter(Boolean);
    if (parts.length !== 1 && parts.length !== 2) return false;
    var head = (parts[0] || "").toLowerCase();
    if (!head || RESERVED_TOP[head]) return false;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i].indexOf(".") !== -1) return false;
    }
    return true;
  }

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
      path.indexOf("/table/") === 0 ||
      isGuestSlugPath(path)
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
    isGuestSlugPath: isGuestSlugPath,
  };

  /**
   * Locale/tagline only. Visibility is CSS (`display: none` unless `caretip-html-boot-active`).
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
    if (global.document.getElementById("caretip-html-boot-tagline")) {
      applyHtmlBootCopy();
    } else if (global.document.readyState === "loading") {
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
