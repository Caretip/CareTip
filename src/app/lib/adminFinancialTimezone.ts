/**
 * Platform Admin financial timestamps use a fixed IANA zone so operators can reconcile
 * across Global Transactions, Refunds, Connect payouts, and payout schedules without
 * browser-local drift.
 */
export const ADMIN_FINANCIAL_TIMEZONE = "Europe/Berlin";

export function formatAdminFinancialDateTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ADMIN_FINANCIAL_TIMEZONE,
    });
  } catch {
    return iso;
  }
}
