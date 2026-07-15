/**
 * Pre-React boot locale — runs before `#caretip-html-boot` is revealed.
 * Must stay in sync with:
 *   - `I18N_STORAGE_KEY` / `readStoredLanguage` (src/i18n)
 *   - `resolveInitialBootLoadingMessage` (src/app/lib/appLoadingContexts.ts)
 *   - `common.loading.*` / `common.onlyAMoment` locale JSON
 */
(function (global) {
  var STORAGE_KEY = "caretip_i18n_language";

  /** Default for the German product surface when no preference is stored. */
  function readBootLanguage() {
    try {
      var v = global.localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "de") return v;
    } catch (_) {
      /* ignore */
    }
    return "de";
  }

  var COPY = {
    de: {
      onlyAMoment: "Das dauert nur einen Moment.",
      starting: "CareTip wird gestartet …",
      landing: "Ihr Erlebnis wird vorbereitet …",
      sessionCheck: "Sitzung wird geprüft …",
      tipPage: "Ihre Trinkgeldseite wird geöffnet …",
      checkout: "Sicherer Checkout wird vorbereitet …",
      stripeReturn: "Ihr Trinkgeld wird bestätigt …",
      finishing: "Wird abgeschlossen …",
    },
    en: {
      onlyAMoment: "This will only take a moment.",
      starting: "Starting CareTip...",
      landing: "Preparing your experience...",
      sessionCheck: "Checking your session...",
      tipPage: "Opening your tip page...",
      checkout: "Preparing secure checkout...",
      stripeReturn: "Confirming your tip...",
      finishing: "Finishing up...",
    },
  };

  global.CareTipBootLocale = {
    STORAGE_KEY: STORAGE_KEY,
    readBootLanguage: readBootLanguage,
    getCopy: function (lng) {
      return COPY[lng === "en" ? "en" : "de"];
    },
  };
})(typeof window !== "undefined" ? window : this);
