/** Device locale for sign-in payload — seeds User.preferredLocale on first login. */

export function resolveLoginLocale(): "en" | "de" {
  try {
    const locale =
      Intl.DateTimeFormat().resolvedOptions().locale ||
      (typeof navigator !== "undefined" ? navigator.language : "") ||
      "";
    return locale.toLowerCase().startsWith("de") ? "de" : "en";
  } catch {
    return "en";
  }
}
