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
    var match = /[?&]lang=(de|en)\b/i.exec(location.search);
    var lang = match ? match[1].toLowerCase() : localStorage.getItem("caretip_i18n_language");
    var href = assets[lang === "en" ? "en" : "de"];
    if (href) {
      var script = document.createElement("link");
      script.rel = "modulepreload";
      script.href = href;
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
