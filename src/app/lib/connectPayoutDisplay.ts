import type {
  ConnectPayoutReconciliationStatus,
  ConnectPayoutStatus,
} from "./api";

/** Display Stripe integer cents in the payout's own currency. Never converts to EUR. */
export function formatConnectPayoutAmount(
  amountCents: number,
  currency: string,
  locale: string,
): string {
  const code = (currency || "eur").trim().toUpperCase() || "EUR";
  const major = amountCents / 100;
  try {
    return new Intl.NumberFormat(locale || "en", {
      style: "currency",
      currency: code,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${code}`;
  }
}

export function formatConnectPayoutDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Extra client-side redaction. Backend remains authoritative. */
export function sanitizePayoutFailureDisplay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/\b(sk_live_|sk_test_|whsec_|acct_|po_)/i.test(s)) return null;
  s = s.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, "[redacted]");
  s = s.replace(/\b\d{8,17}\b/g, "[redacted]");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 255) || null;
}

export function payoutStatusI18nKey(status: ConnectPayoutStatus | string): string {
  return `business.billing.payouts.status.${status}`;
}

export function reconStatusI18nKey(status: ConnectPayoutReconciliationStatus | string | undefined): string {
  return `business.billing.payouts.reconciliation.${status ?? "pending"}`;
}

export function reconExplainI18nKey(status: ConnectPayoutReconciliationStatus | string | undefined): string {
  const s = status ?? "pending";
  return `business.billing.payouts.reconExplain.${s}`;
}
