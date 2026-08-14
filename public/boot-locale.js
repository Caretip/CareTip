/**
 * Pre-React boot locale — runs before `#caretip-html-boot` is revealed.
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
})(
  typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined"
    ? globalThis.window
    : globalThis,
);
