import applePayMarkUrl from "../../../../images/SVG/Apple_Pay_Mark_RGB_041619.svg?url";
import googlePayMarkUrl from "../../../../images/google-pay-mark_800.svg?url";

export type PaymentMethodMarkId = "apple-pay" | "google-pay" | "card";

/** Brand assets live in `/payment_logo` at repo root (png, svg, webp, jpg). */
const logoModules = import.meta.glob<string>("../../../../payment_logo/*.{png,svg,webp,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
});

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[\s._-]+/g, "");
}

function findLogoUrl(candidates: string[]): string | undefined {
  const wants = candidates.map((c) => c.toLowerCase().replace(/[\s._-]+/g, ""));
  for (const [path, url] of Object.entries(logoModules)) {
    const stem = fileStem(path);
    if (wants.some((w) => stem === w || stem.includes(w) || w.includes(stem))) {
      return url;
    }
  }
  return undefined;
}

/** Same official marks as the landing Payments Infrastructure section. */
const LANDING_OFFICIAL_MARKS: Partial<Record<PaymentMethodMarkId, string>> = {
  "apple-pay": applePayMarkUrl,
  "google-pay": googlePayMarkUrl,
};

const LOGO_CANDIDATES: Record<PaymentMethodMarkId, string[]> = {
  "apple-pay": ["applepay", "apple-pay", "apple_pay", "apple"],
  "google-pay": ["googlepay", "google-pay", "google_pay", "google"],
  card: ["card", "creditcard", "credit-card", "credit_card", "debitcard", "visa"],
};

export function paymentLogoUrl(id: PaymentMethodMarkId): string | undefined {
  const official = LANDING_OFFICIAL_MARKS[id];
  if (official) return official;
  return findLogoUrl(LOGO_CANDIDATES[id]);
}
