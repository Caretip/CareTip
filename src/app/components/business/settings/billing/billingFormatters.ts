export function formatBillingDate(
  iso: string | null,
  locale: string,
  emptyLabel: string,
): string {
  if (!iso) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function resolveBillingLocale(language: string | undefined): string {
  return language?.startsWith("de") ? "de-DE" : "en-GB";
}
