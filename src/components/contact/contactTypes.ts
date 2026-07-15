export type ContactIntent = "choose" | "demo" | "support" | "sales";

export type ContactSupportCategory =
  | "account_login"
  | "payments_stripe"
  | "qr_codes"
  | "team_setup"
  | "technical"
  | "product_feedback"
  | "pricing"
  | "other";

export const CONTACT_SUPPORT_CATEGORIES: readonly ContactSupportCategory[] = [
  "account_login",
  "payments_stripe",
  "qr_codes",
  "team_setup",
  "technical",
  "product_feedback",
  "pricing",
  "other",
] as const;

export const CONTACT_TRUST_KEYS = ["response24h", "gdpr", "stripe", "trusted"] as const;

export type ContactTrustKey = (typeof CONTACT_TRUST_KEYS)[number];

export const CONTACT_TEAM_SIZES = ["1-10", "11-50", "51-200", "200plus"] as const;

export type ContactTeamSize = (typeof CONTACT_TEAM_SIZES)[number];

export const DEMO_BULLET_COUNT = 5;

export const SALES_BULLET_COUNT = 4;
