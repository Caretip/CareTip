(function () {
  try {
    var saved = localStorage.getItem("caretip-theme");
    var preference =
      saved === "light" || saved === "dark" || saved === "system" ? saved : "light";
    var resolved =
      preference === "system"
        ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
    // The canvas painted before any stylesheet follows this meta (index.html ships "light").
    var colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.setAttribute("content", resolved);
    document.documentElement.dataset.theme = resolved;
  } catch {
    /* ignore */
  }
})();

/**
 * Starts the language chunk, and landing styles on the home page, alongside the main bundle. This has
 * to be a head script placed before the main stylesheet: later scripts wait for that stylesheet.
 */
(function () {
  try {
    var meta = document.querySelector('meta[name="caretip-boot-assets"]');
    if (!meta) return;
    var assets = JSON.parse(meta.getAttribute("content") || "{}");
    // Main stylesheet, inserted from script so it does not block the first paint (the boot cover is
    // styled inline). It still applies on arrival; main.tsx waits for it before React mounts.
    if (assets.mainCss) {
      var mainCss = document.createElement("link");
      mainCss.rel = "stylesheet";
      mainCss.crossOrigin = "anonymous";
      mainCss.href = assets.mainCss;
      mainCss.setAttribute("data-caretip-main-css", "");
      mainCss.onload = mainCss.onerror = function () {
        mainCss.setAttribute("data-caretip-settled", "");
      };
      document.head.appendChild(mainCss);
    }
    var match = /[?&]lang=(de|en)\b/i.exec(location.search);
    var lang = match ? match[1].toLowerCase() : localStorage.getItem("caretip_i18n_language");
    var code = lang === "en" ? "en" : "de";
    // Core translations everywhere; the deferred sections (dashboards, legal pages) everywhere but the
    // homepage, which renders without them (src/i18n/localeSplit.ts).
    var hrefs = [assets[code]];
    if (location.pathname !== "/") hrefs.push(assets[code + "App"]);
    for (var i = 0; i < hrefs.length; i++) {
      if (!hrefs[i]) continue;
      var script = document.createElement("link");
      script.rel = "modulepreload";
      script.href = hrefs[i];
      // After the stylesheet: first paint needs that, and sharing the connection delayed it.
      script.fetchPriority = "low";
      document.head.appendChild(script);
    }
    if (location.pathname === "/" && assets.landingCss) {
      var style = document.createElement("link");
      style.rel = "preload";
      style.as = "style";
      style.href = assets.landingCss;
      document.head.appendChild(style);
    }
  } catch (e) {
    /* Only an optimisation: everything still loads on demand. */
  }
})();
