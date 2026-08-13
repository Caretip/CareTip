(function () {
  try {
    var saved = localStorage.getItem("caretip-theme");
    var preference =
      saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
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
