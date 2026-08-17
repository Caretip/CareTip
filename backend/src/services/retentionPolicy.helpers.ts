/**
 * GDPR retention policy helpers (fail-closed).
 *
 * Approved CareTip management/legal constants in retentionPolicy.constants.ts are
 * the authority for calendar-year and exact-duration policies.
 * RETENTION_T_*_DAYS must be UNSET, or fail-closed if they contradict the approved policy
 * (rolling-day env is not a substitute for calendar-year rules).
 *
 * Orchestration helpers (kycRetainUntil, financialRetainUntil, nextLifecycleWakeAt)
 * are NOT legal authority.
 *
 * MVP: this module must not gate onboarding/dashboard access.
 */

import {
  AUDIT_RETENTION_YEARS,
  BILLING_RETENTION_YEARS,
  EMPLOYEE_HISTORICAL_RETENTION_YEARS,
  NOTIFICATION_RETENTION_DAYS,
  QR_PERSONAL_ANONYMIZATION_HOURS,
  SUPPORT_RETENTION_YEARS,
} from "./retentionPolicy.constants.js";

export type RetentionDaysConfig =
  | { configured: false; reason: "unset" | "invalid" }
  | { configured: true; days: number };

export type RetentionCategory =
  | "analytics"
  | "audit"
  | "support"
  | "notify"
  | "guest"
  | "billing"
  | "staff_pii"
  | "kyc"
  | "financial"
  | "payment";

const ENV_KEYS: Record<
  Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  string
> = {
  analytics: "RETENTION_T_ANALYTICS_DAYS",
  audit: "RETENTION_T_AUDIT_DAYS",
  support: "RETENTION_T_SUPPORT_DAYS",
  notify: "RETENTION_T_NOTIFY_DAYS",
  guest: "RETENTION_T_GUEST_DAYS",
  billing: "RETENTION_T_BILLING_DAYS",
  staff_pii: "RETENTION_T_STAFF_PII_DAYS",
};

const EXEC_GATES: Record<
  Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  string
> = {
  analytics: "DATA_LIFECYCLE_ANALYTICS_EXECUTE",
  audit: "DATA_LIFECYCLE_AUDIT_EXECUTE",
  support: "DATA_LIFECYCLE_SUPPORT_EXECUTE",
  notify: "DATA_LIFECYCLE_NOTIFY_EXECUTE",
  guest: "DATA_LIFECYCLE_GUEST_EXECUTE",
  billing: "DATA_LIFECYCLE_BILLING_EXECUTE",
  staff_pii: "DATA_LIFECYCLE_STAFF_PII_EXECUTE",
};

/**
 * Hold category aliases accepted on legalHoldCategories[].
 * Includes profile / staff-profile for F-A anonymization gates (Amendment A2).
 */
const HOLD_ALIASES: Record<string, string[]> = {
  analytics: ["analytics"],
  audit: ["audit"],
  support: ["support"],
  notify: ["notify", "notification", "notifications"],
  guest: ["guest"],
  billing: ["billing"],
  staff_pii: ["staff_pii", "staff-profile", "staff", "employee"],
  kyc: ["kyc"],
  financial: ["financial", "payment"],
  payment: ["financial", "payment"],
  /** Profile anonymization hold (F-A). Not a retention T_* category. */
  profile: ["profile"],
};

/** Canonical categories accepted by Slice G legal-hold APIs (normalized lowercase). */
export const LEGAL_HOLD_API_CATEGORIES = [
  "financial",
  "payment",
  "kyc",
  "audit",
  "support",
  "analytics",
  "guest",
  "staff_pii",
  "billing",
  "notify",
  "profile",
  "staff-profile",
] as const;

export type LegalHoldApiCategory = (typeof LEGAL_HOLD_API_CATEGORIES)[number];

const API_CATEGORY_ALIASES: Record<string, LegalHoldApiCategory> = {
  financial: "financial",
  payment: "payment",
  kyc: "kyc",
  audit: "audit",
  support: "support",
  analytics: "analytics",
  guest: "guest",
  staff_pii: "staff_pii",
  "staff-profile": "staff-profile",
  staff: "staff_pii",
  employee: "staff-profile",
  billing: "billing",
  notify: "notify",
  notification: "notify",
  notifications: "notify",
  profile: "profile",
};

/** Normalize client-supplied hold categories; reject unknown tokens. */
export function normalizeLegalHoldCategories(input: unknown): {
  ok: true;
  categories: string[];
} | { ok: false; message: string } {
  if (!Array.isArray(input)) {
    return { ok: false, message: "categories must be an array of strings" };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string" || !raw.trim()) {
      return { ok: false, message: "each category must be a non-empty string" };
    }
    const key = raw.trim().toLowerCase();
    const canonical = API_CATEGORY_ALIASES[key];
    if (!canonical) {
      return {
        ok: false,
        message: `unsupported legal-hold category: ${key}`,
      };
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return { ok: true, categories: out };
}

export { HOLD_ALIASES };

export function envFlagTrue(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Parse RETENTION_T_*_DAYS. Empty/missing/non-integer → UNSET (fail-closed).
 * Does not invent defaults.
 */
export function readRetentionDaysFromEnv(
  envKey: string,
  env: NodeJS.ProcessEnv = process.env,
): RetentionDaysConfig {
  const raw = env[envKey];
  if (raw === undefined || raw.trim() === "") {
    return { configured: false, reason: "unset" };
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { configured: false, reason: "invalid" };
  }
  return { configured: true, days: Number(trimmed) };
}

export function readCategoryRetentionDays(
  category: Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  env: NodeJS.ProcessEnv = process.env,
): RetentionDaysConfig {
  return readRetentionDaysFromEnv(ENV_KEYS[category], env);
}

export function isDataLifecycleV1Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagTrue("DATA_LIFECYCLE_V1", env);
}

/** Dual gate: DATA_LIFECYCLE_V1 + category execute flag. Default OFF. */
export function isCategoryRetentionExecutionEnabled(
  category: Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isDataLifecycleV1Enabled(env) && envFlagTrue(EXEC_GATES[category], env);
}

/** Dry-run reports candidates without mutating. Preferred over EXECUTE when both are set. */
export function isDataLifecycleDryRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDataLifecycleV1Enabled(env) && envFlagTrue("DATA_LIFECYCLE_DRY_RUN", env);
}

export type RetentionJobMode = "off" | "dry_run" | "execute";

/**
 * Feature-flag progression: OFF → DRY RUN → ENABLE CATEGORY.
 * DRY_RUN wins over EXECUTE so production cannot mutate while reviewing reports.
 */
export function resolveRetentionJobMode(
  category: Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { bypassExecutionGate?: boolean },
): RetentionJobMode {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled(env) ? "dry_run" : "execute";
  }
  if (!isDataLifecycleV1Enabled(env)) return "off";
  if (isDataLifecycleDryRunEnabled(env)) return "dry_run";
  if (envFlagTrue(EXEC_GATES[category], env)) return "execute";
  return "off";
}

export function cutoffDateFromDays(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function holdCategoriesOf(entity: {
  legalHold: boolean;
  legalHoldCategories: string[];
}): Set<string> {
  if (!entity.legalHold) return new Set();
  return new Set(
    (entity.legalHoldCategories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
}

export type CategoryHoldDecision = "held" | "clear" | "unknown";

/**
 * Fail-closed hold lookup.
 * - missing entity → unknown (do not delete)
 * - legalHold true with empty categories → held for all (ambiguous hold)
 * - otherwise Amendment A2 category match
 */
export function categoryHoldDecision(
  entity: { legalHold: boolean; legalHoldCategories: string[] } | null | undefined,
  category: RetentionCategory | "profile",
): CategoryHoldDecision {
  if (!entity) return "unknown";
  if (!entity.legalHold) return "clear";
  const held = holdCategoriesOf(entity);
  if (held.size === 0) return "held";
  const aliases = HOLD_ALIASES[category] ?? [category];
  return aliases.some((a) => held.has(a)) ? "held" : "clear";
}

/** True when a worker must skip destructive work. */
export function shouldSkipForHold(decision: CategoryHoldDecision): boolean {
  return decision !== "clear";
}

/** Amendment A2: only the listed category (and aliases) blocks that category's destruction. */
export function isCategoryHeld(
  entity: { legalHold: boolean; legalHoldCategories: string[] } | null | undefined,
  category: RetentionCategory,
): boolean {
  return categoryHoldDecision(entity, category) === "held";
}

export type ApprovedCategoryPolicy =
  | { ok: true; kind: "hours"; hours: number }
  | { ok: true; kind: "days"; days: number }
  | { ok: true; kind: "calendar_years"; years: number }
  | { ok: true; kind: "immediate_name_only" }
  | { ok: false; reason: "invalid_env" | "contradicts_policy" };

/**
 * Resolve the approved cutoff policy for a retention category.
 * Rolling RETENTION_T_*_DAYS must remain UNSET for calendar-year / exact-duration
 * categories. A set or invalid T_* value fails closed.
 */
export function resolveApprovedCategoryPolicy(
  category: Exclude<RetentionCategory, "kyc" | "financial" | "payment">,
  env: NodeJS.ProcessEnv = process.env,
): ApprovedCategoryPolicy {
  const cfg = readCategoryRetentionDays(category, env);
  if (cfg.configured) {
    return { ok: false, reason: "contradicts_policy" };
  }
  if (cfg.reason === "invalid") {
    return { ok: false, reason: "invalid_env" };
  }
  switch (category) {
    case "analytics":
      return { ok: true, kind: "hours", hours: QR_PERSONAL_ANONYMIZATION_HOURS };
    case "notify":
      return { ok: true, kind: "days", days: NOTIFICATION_RETENTION_DAYS };
    case "audit":
      return { ok: true, kind: "calendar_years", years: AUDIT_RETENTION_YEARS };
    case "support":
      return { ok: true, kind: "calendar_years", years: SUPPORT_RETENTION_YEARS };
    case "billing":
      return { ok: true, kind: "calendar_years", years: BILLING_RETENTION_YEARS };
    case "staff_pii":
      return { ok: true, kind: "calendar_years", years: EMPLOYEE_HISTORICAL_RETENTION_YEARS };
    case "guest":
      return { ok: true, kind: "immediate_name_only" };
    default:
      return { ok: false, reason: "invalid_env" };
  }
}

/** Keys scrubbed from JSON/text audit metadata (Amendment A3). */
export const AUDIT_PII_METADATA_KEYS = [
  "email",
  "name",
  "inviteeEmail",
  "inviteeName",
  "phone",
  "ip",
  "customerName",
  "actorEmail",
  "actorName",
  "userEmail",
  "employeeName",
] as const;

export function scrubPiiKeysInJson(value: unknown): { changed: boolean; value: unknown } {
  if (value == null) return { changed: false, value };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const r = scrubPiiKeysInJson(item);
      if (r.changed) changed = true;
      return r.value;
    });
    return { changed, value: next };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (AUDIT_PII_METADATA_KEYS.includes(k as (typeof AUDIT_PII_METADATA_KEYS)[number])) {
        if (v !== "[redacted]") {
          next[k] = "[redacted]";
          changed = true;
        } else {
          next[k] = v;
        }
      } else {
        const r = scrubPiiKeysInJson(v);
        if (r.changed) changed = true;
        next[k] = r.value;
      }
    }
    return { changed, value: next };
  }
  return { changed: false, value };
}

export function scrubPiiKeysInMetadataString(raw: string | null | undefined): {
  changed: boolean;
  value: string | null;
} {
  if (raw == null || raw === "") return { changed: false, value: raw ?? null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const { changed, value } = scrubPiiKeysInJson(parsed);
    if (!changed) return { changed: false, value: raw };
    return { changed: true, value: JSON.stringify(value) };
  } catch {
    // Non-JSON legacy: replace common email-like tokens only — keep structure.
    let next = raw;
    let changed = false;
    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    if (emailRe.test(next)) {
      next = next.replace(emailRe, "[redacted]");
      changed = true;
    }
    return { changed, value: next };
  }
}

export function redactBillingPayload(payload: unknown): { changed: boolean; value: unknown } {
  // Preserve Stripe event ids / types; scrub CareTip-controlled nested PII keys only.
  return scrubPiiKeysInJson(payload);
}

export const RETENTION_ENV_KEYS = ENV_KEYS;
export const RETENTION_EXEC_GATES = EXEC_GATES;
