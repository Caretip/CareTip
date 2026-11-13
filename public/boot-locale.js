/**
 * Pre-React boot locale — runs immediately after `#caretip-html-boot` (CSP-safe external file).
 * Visibility of `#caretip-html-boot` is CSS (`#caretip-html-boot { display: flex }` until the node is removed).
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

  function readLangQueryParam() {
    try {
      var search = global.location && global.location.search;
      if (!search) return null;
      var match = /[?&]lang=(de|en)\b/i.exec(search);
      if (match) return match[1].toLowerCase();
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Default for the German product surface when no preference is stored. */
  function readBootLanguage() {
    var fromQuery = readLangQueryParam();
    if (fromQuery === "en" || fromQuery === "de") {
      try {
        global.localStorage.setItem(STORAGE_KEY, fromQuery);
      } catch {
        /* ignore */
      }
      return fromQuery;
    }
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
      gettingReady: "Einen Moment bitte…",
      settingUpWorkspace: "Ihr Bereich wird eingerichtet…",
      sessionCheck: "Ihr Konto wird vorbereitet…",
      tipPage: "Ihr Trinkgeld-Erlebnis wird vorbereitet…",
      checkout: "Ihr sicherer Checkout wird vorbereitet…",
      stripeReturn: "Ihr Trinkgeld wird bestätigt…",
      finishing: "Gleich geschafft…",
      legalPrivacy: "Datenschutzerklärung wird geöffnet…",
      legalTerms: "Allgemeine Geschäftsbedingungen werden geöffnet…",
      legalCookies: "Cookie-Richtlinie wird geöffnet…",
      legalImprint: "Impressum wird geöffnet…",
      legalDpa: "Auftragsverarbeitungsvertrag wird geöffnet…",
      legalPlv: "Preis- und Leistungsverzeichnis wird geöffnet…",
    },
    en: {
      gettingReady: "Just a moment…",
      settingUpWorkspace: "Setting up your workspace…",
      sessionCheck: "Preparing your account…",
      tipPage: "Preparing your tipping experience…",
      checkout: "Preparing your secure checkout…",
      stripeReturn: "Confirming your tip…",
      finishing: "Almost there…",
      legalPrivacy: "Opening Privacy Policy…",
      legalTerms: "Opening Terms of Service…",
      legalCookies: "Opening Cookie Policy…",
      legalImprint: "Opening Legal Notice…",
      legalDpa: "Opening Data Processing Agreement…",
      legalPlv: "Opening Price & Services List…",
    },
  };

  function resolveLegalBootTagline(copy, path) {
    if (path === "/privacy") return copy.legalPrivacy;
    if (path === "/terms") return copy.legalTerms;
    if (path === "/cookies") return copy.legalCookies;
    if (path === "/imprint") return copy.legalImprint;
    if (path === "/avv" || path === "/dpa") return copy.legalDpa;
    if (path === "/plv") return copy.legalPlv;
    return null;
  }

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
    var legalTagline = resolveLegalBootTagline(copy, path);
    if (legalTagline) return legalTagline;
    if (path === "/payment") return copy.checkout;
    if (path === "/success" || path === "/rating") return copy.stripeReturn;
    if (path === "/tip-complete") return copy.finishing;
    if (path === "/mobile-auth") return copy.sessionCheck;
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

  var GOOGLE_RETURN_PATH = "/auth/google/complete";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var GOOGLE_PATHS = [
    ["#EA4335", "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"],
    ["#4285F4", "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"],
    ["#FBBC05", "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"],
    ["#34A853", "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"],
  ];

  /**
   * Returning from Google (redirect sign-in): the boot screen shows the same "Signing you in with
   * Google" state as the app's AuthOAuthProgress, so the CareTip mark never appears in between and the
   * whole sign-in reads as one uninterrupted step until the dashboard renders.
   * Built with DOM calls (CSP: no inline script); the spinner uses the Web Animations API.
   */
  function applyGoogleReturnBootVariant(doc, lng) {
    var el = doc.getElementById("caretip-html-boot");
    if (!el) return;
    var dark = doc.documentElement.classList.contains("dark");
    var title = lng === "en" ? "Signing you in with Google…" : "Anmeldung mit Google läuft …";
    var hint = lng === "en" ? "This only takes a moment." : "Das dauert nur einen Moment.";
    while (el.firstChild) el.removeChild(el.firstChild);
    el.setAttribute("data-oauth-progress", "google");
    el.setAttribute("aria-label", title);

    var wrap = doc.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:1.25rem;max-width:20rem;text-align:center";
    var ringBox = doc.createElement("div");
    ringBox.style.cssText = "position:relative;display:flex;align-items:center;justify-content:center;width:4rem;height:4rem";
    var ring = doc.createElement("span");
    ring.setAttribute("aria-hidden", "true");
    ring.style.cssText =
      "position:absolute;inset:0;border-radius:9999px;border:2px solid rgba(235,153,44,0.2);border-top-color:#eb992c;box-sizing:border-box";
    ringBox.appendChild(ring);
    var svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "28");
    for (var i = 0; i < GOOGLE_PATHS.length; i++) {
      var path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", GOOGLE_PATHS[i][0]);
      path.setAttribute("d", GOOGLE_PATHS[i][1]);
      svg.appendChild(path);
    }
    ringBox.appendChild(svg);
    var texts = doc.createElement("div");
    var t1 = doc.createElement("p");
    t1.textContent = title;
    t1.style.cssText = "margin:0 0 0.375rem;font-size:1rem;line-height:1.5rem;font-weight:600";
    var t2 = doc.createElement("p");
    t2.textContent = hint;
    t2.style.cssText = "margin:0;font-size:0.875rem;line-height:1.25rem;color:" + (dark ? "#a3a3a3" : "#737373");
    texts.appendChild(t1);
    texts.appendChild(t2);
    wrap.appendChild(ringBox);
    wrap.appendChild(texts);
    el.appendChild(wrap);
    var reduce = false;
    try {
      reduce = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
      reduce = false;
    }
    if (!reduce && typeof ring.animate === "function") {
      ring.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 1000, iterations: Infinity });
    }
  }

  /**
   * Locale/tagline only. Visibility is CSS (`#caretip-html-boot { display: flex }` until the node is removed).
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
      var bootPath = String((global.location && global.location.pathname) || "/").split("?")[0];
      if (bootPath === GOOGLE_RETURN_PATH) applyGoogleReturnBootVariant(doc, lng);
      // Reveal the boot mark (index.html keeps it hidden until this script has run).
      doc.documentElement.setAttribute("data-boot-copy", "");
      markBootLocalePerf();
    } catch (_) {
      /* ignore */
    }
  }

  function markBootLocalePerf() {
    try {
      var perf = global.performance;
      if (!perf || typeof perf.mark !== "function") return;
      var host = global.location && global.location.hostname;
      var dev = host === "localhost" || host === "127.0.0.1";
      var qs =
        global.location &&
        String(global.location.search || "").indexOf("caretipPerfMarks=1") !== -1;
      if (dev || qs) perf.mark("caretip:boot-locale-ready");
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

  function isCustomerBootPath(path) {
    if (
      path === "/payment" ||
      path === "/success" ||
      path === "/rating" ||
      path === "/tip-complete" ||
      path === "/tip-amount" ||
      path === "/select-employee"
    ) {
      return true;
    }
    if (
      path.indexOf("/staff/") === 0 ||
      path.indexOf("/qr/") === 0 ||
      path.indexOf("/qr-landing/") === 0 ||
      path.indexOf("/table/") === 0
    ) {
      return true;
    }
    return isGuestSlugPath(path);
  }

  /**
   * Public `/` must not uncover an empty #root.
   * Guest tip URLs and lazy marketing shells keep #caretip-html-boot until
   * `[data-caretip-route-ready]` / public-committed markers exist. Not a timeout.
   */
  function isLazyPublicMarketingPath(path) {
    return (
      path === "/pricing" ||
      path === "/features" ||
      path === "/faq" ||
      path === "/contact" ||
      path === "/privacy" ||
      path === "/terms" ||
      path === "/avv" ||
      path === "/dpa" ||
      path === "/plv" ||
      path === "/cookies" ||
      path === "/imprint" ||
      path === "/help" ||
      path === "/blog" ||
      path === "/careers" ||
      path === "/how-it-works" ||
      path === "/mobile-app" ||
      path.indexOf("/industries/") === 0
    );
  }

  function publicLandingRouteCommitted() {
    var doc = global.document;
    if (!doc) return false;
    var path = String((global.location && global.location.pathname) || "/")
      .split("?")[0]
      .split("#")[0];
    if (path === "/") {
      return Boolean(
        doc.querySelector(
          ".caretip-landing #about-section.caretip-hero-section, .caretip-landing [data-caretip-hero-ready]",
        ),
      );
    }
    if (isCustomerBootPath(path)) {
      return Boolean(doc.querySelector("[data-caretip-route-ready]"));
    }
    if (isLazyPublicMarketingPath(path)) {
      return Boolean(
        doc.querySelector("[data-caretip-route-ready], [data-caretip-public-committed]"),
      );
    }
    return true;
  }

  function installPublicLandingBootRetain() {
    var doc = global.document;
    var html = doc && doc.documentElement;
    if (!doc || !html || typeof html.getAttribute !== "function") return;
    if (html.getAttribute("data-caretip-boot-retain") === "1") return;
    if (typeof Element === "undefined" || typeof Node === "undefined") return;
    if (!Element.prototype || !Node.prototype) return;
    html.setAttribute("data-caretip-boot-retain", "1");

    var nativeElRemove = Element.prototype.remove;
    Element.prototype.remove = function () {
      if (this && this.id === "caretip-html-boot" && !publicLandingRouteCommitted()) return;
      return nativeElRemove.call(this);
    };

    var nativeRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && child.id === "caretip-html-boot" && !publicLandingRouteCommitted()) {
        return child;
      }
      return nativeRemoveChild.call(this, child);
    };

    var html = doc.documentElement;
    if (html && html.classList) {
      var nativeClassRemove = html.classList.remove.bind(html.classList);
      html.classList.remove = function () {
        var names = Array.prototype.slice.call(arguments);
        if (
          names.indexOf("caretip-html-boot-active") !== -1 &&
          !publicLandingRouteCommitted()
        ) {
          names = names.filter(function (name) {
            return name !== "caretip-html-boot-active";
          });
          if (!names.length) return;
        }
        return nativeClassRemove.apply(html.classList, names);
      };
    }
  }

  if (global.document) {
    if (global.document.getElementById("caretip-html-boot-tagline")) {
      applyHtmlBootCopy();
      installPublicLandingBootRetain();
    } else if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", function () {
        applyHtmlBootCopy();
        installPublicLandingBootRetain();
      });
    } else {
      applyHtmlBootCopy();
      installPublicLandingBootRetain();
    }
  }
})(
  typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined"
    ? globalThis.window
    : globalThis,
);
