/**
 * Phase 2 sanitization policy for the local validation copy.
 *
 * Default-deny: every text/JSON/array column is pseudonymized unless it is a key (PK/FK/`*_id`), a
 * Stripe reference, or a named non-personal token (status, currency, idempotency key, ...). Numbers,
 * booleans, timestamps and enums are kept so amounts, lifecycle and relationships stay intact.
 * Replacements are HMAC-SHA256 with a per-run secret: deterministic within one copy (uniqueness and
 * cross-table equality survive) and not reversible without the secret, which is never persisted.
 */
import { createHmac } from "node:crypto";

export const SANITIZER_VERSION = "phase2-sanitizer-v1";

export type ColumnInfo = {
  table: string;
  column: string;
  dataType: string;
  udtName: string;
  maxLength: number | null;
  nullable: boolean;
  isPk: boolean;
  isFk: boolean;
};

export type ColumnPolicy = "keep" | "email" | "phone" | "slug" | "url" | "secret" | "text" | "json" | "array";

const KEEP_TYPES = new Set([
  "smallint", "integer", "bigint", "numeric", "real", "double precision", "boolean", "date",
  "timestamp without time zone", "timestamp with time zone", "time without time zone", "interval", "uuid",
  "USER-DEFINED",
]);

/** Non-personal operational tokens (exact column names, snake_case as stored). */
const KEEP_TEXT_COLUMNS = new Set([
  "currency", "status", "kind", "type", "event_type", "action", "audience", "audit_type", "author_role",
  "business_type", "capability_profile_key", "country", "failure_code", "last_error_code", "feature_key",
  "language", "preferred_locale", "method", "payout_type", "platform", "programme_key", "provider", "purpose",
  "reporting_category", "scan_type", "stream", "subject_type", "timezone", "version", "condition_version",
  "notification_key", "schedule_window_key", "device_type", "oauth_provider", "idempotency_key", "dedupe_key",
  "correlation_id", "run_id", "jti", "receipt_number", "ticket_number", "last_stripe_event_type",
  "channels", "legal_hold_categories", "brand_primary_color", "brand_secondary_color", "qr_accent_color",
  "qr_background_color", "qr_border_style", "qr_shape", "qr_template", "migration_name", "checksum",
  "processing_result",
]);

/** `*_id` columns that hold personal or external identity data rather than row references. */
const PERSONAL_ID_COLUMNS = new Set(["tax_id", "vat_id", "google_place_id", "oauth_subject"]);

/** Transfer error columns keep only their machine prefix (e.g. `rel_durable:`), never free text. */
const ERROR_PREFIX_COLUMNS = new Set(["last_transfer_error"]);

const TEXT_TYPES = new Set(["text", "character varying", "character", "citext"]);

export function columnPolicy(c: ColumnInfo): ColumnPolicy {
  const name = c.column.toLowerCase();
  if (KEEP_TYPES.has(c.dataType)) return "keep";
  if (c.dataType === "ARRAY") {
    if (c.udtName !== "_text" && c.udtName !== "_varchar") return "keep";
    return KEEP_TEXT_COLUMNS.has(name) ? "keep" : "array";
  }
  if (c.dataType === "json" || c.dataType === "jsonb") return "json";
  if (!TEXT_TYPES.has(c.dataType)) return "secret";
  if (c.isPk || c.isFk) return "keep";
  if (PERSONAL_ID_COLUMNS.has(name)) return "secret";
  if (name === "id" || name.endsWith("_id") || name.startsWith("stripe_")) return "keep";
  if (KEEP_TEXT_COLUMNS.has(name) || /_(status|mode|type|kind|role|model|currency|locale|interval)$/.test(name)) return "keep";
  if (name.includes("email")) return name.endsWith("_hash") ? "secret" : "email";
  if (name.includes("phone")) return "phone";
  if (name === "slug" || name.endsWith("_slug")) return "slug";
  if (/(^|_)(url|website|path|avatar|asset)$/.test(name) || name.endsWith("_path")) return "url";
  if (/(token|secret|password|hash|code|fingerprint)/.test(name)) return "secret";
  return "text";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_ANYWHERE_RE = /[^\s@:;,]+@[^\s@:;,]+\.[A-Za-z]{2,}/g;
const SAFE_JSON_VALUE_RE: RegExp[] = [
  /^(acct|pi|ch|py|tr|trr|re|dp|evt|cus|sub|in|ii|price|prod|po|pyr|ba|card|pm|seti|cs|txn|fee|fr|src|ipi|si)_[A-Za-z0-9_]+$/,
  /^c[a-z0-9]{20,32}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/,
];
const SAFE_JSON_KEY_RE =
  /^(id|ids|object|status|type|kind|currency|mode|code|reason|event|event_type|action|livemode|interval|version|locale|language|country|source|routing_mode|charge_model|payout_mode|amount|amount_.*|.*_cents|.*Cents|.*_id|.*Id|.*_status|.*Status|.*_type|.*Type|.*_at|.*At)$/;

export function createSanitizer(secret: Buffer) {
  const h = (value: string, n: number) => createHmac("sha256", secret).update(value).digest("hex").slice(0, n);
  const fit = (value: string, max: number | null) => (max != null && value.length > max ? value.slice(0, max) : value);
  const scrubEmails = (value: string) =>
    value.replace(EMAIL_ANYWHERE_RE, (m) => `u${h(`email:${m.toLowerCase()}`, 12)}@example.invalid`);

  function text(policy: ColumnPolicy, c: ColumnInfo, value: string): string {
    switch (policy) {
      case "keep":
        return fit(scrubEmails(value), c.maxLength);
      case "email":
        return EMAIL_RE.test(value.trim())
          ? fit(`u${h(`email:${value.trim().toLowerCase()}`, 12)}@example.invalid`, c.maxLength)
          : fit(`x${h(`v:${value}`, 16)}`, c.maxLength);
      case "phone":
        return fit(`+00${parseInt(h(`phone:${value}`, 10), 16).toString().slice(0, 10)}`, c.maxLength);
      case "slug":
        return fit(`s-${h(`slug:${value}`, 16)}`, c.maxLength);
      case "url":
        return fit(`https://example.invalid/${h(`url:${value}`, 16)}`, c.maxLength);
      case "secret":
        return fit(`x${h(`secret:${c.column}:${value}`, 32)}`, c.maxLength);
      default: {
        if (ERROR_PREFIX_COLUMNS.has(c.column)) {
          if (/^[a-z0-9_:|.-]+$/.test(value)) return value;
          const prefix = value.match(/^(?:[a-z_]+:|\d+:)+/)?.[0] ?? "";
          return fit(`${prefix}~${h(`v:${value}`, 10)}`, c.maxLength);
        }
        return fit(`~${h(`v:${value}`, 12)}`, c.maxLength);
      }
    }
  }

  function json(value: unknown, key: string | null): unknown {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((v) => json(v, key));
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = json(v, k);
      return out;
    }
    const s = String(value);
    const tokenLike = s.length <= 120 && !/\s/.test(s) && !s.includes("@");
    if (tokenLike && SAFE_JSON_VALUE_RE.some((re) => re.test(s))) return s;
    if (tokenLike && key && SAFE_JSON_KEY_RE.test(key) && s.length <= 64) return s;
    if (EMAIL_RE.test(s.trim())) return `u${h(`email:${s.trim().toLowerCase()}`, 12)}@example.invalid`;
    return `~${h(`v:${s}`, 12)}`;
  }

  return {
    sanitizeValue(c: ColumnInfo, policy: ColumnPolicy, value: unknown): unknown {
      if (value === null || value === undefined) return value ?? null;
      if (policy === "json") return json(value, null);
      if (policy === "array") return Array.isArray(value) ? value.map((v) => (v == null ? v : `~${h(`v:${v}`, 12)}`)) : value;
      if (policy === "keep" && typeof value !== "string") return value;
      return text(policy, c, String(value));
    },
  };
}
