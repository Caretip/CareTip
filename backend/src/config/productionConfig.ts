/**
 * Startup configuration review. `fatal` stops the process, because the server would otherwise run
 * with weaker security than it reports. `warnings` are logged for the operator. Values are never
 * included in messages.
 */
import { MFA_KEY_MIN_LENGTH } from "../lib/mfaSecretCrypto.js";

export type ProductionConfigReport = { fatal: string[]; warnings: string[] };

/** Minimum JWT_SECRET size in bytes (HS256 key; RFC 7518 §3.2 requires >= 256 bits). */
export const JWT_SECRET_MIN_BYTES = 32;

/**
 * Phrases from docs / .env.example / tutorials (case-insensitive). Each is long enough that a random
 * base64/hex secret will not contain it by chance.
 */
const JWT_PLACEHOLDER_PATTERNS: RegExp[] = [
  /replace[-_ ]?(me|in[-_ ]?production|this)/i,
  /change[-_ ]?(me|this)/i,
  /your[-_ ]?(super[-_ ]?)?(jwt[-_ ]?)?secret/i,
  /placeholder|example|dummy|insecure|not[-_ ]?secret|long[-_ ]?random/i,
];

/**
 * SEC-08: why a JWT_SECRET is unacceptable in production, or null when it is acceptable.
 * Never includes the value. Byte length is measured on the trimmed UTF-8 value.
 */
export function jwtSecretProblem(raw: string | undefined): string | null {
  const secret = raw?.trim() ?? "";
  if (!secret) return "JWT_SECRET must be set";
  if (Buffer.byteLength(secret, "utf8") < JWT_SECRET_MIN_BYTES) {
    return `JWT_SECRET must be at least ${JWT_SECRET_MIN_BYTES} bytes of random data`;
  }
  if (JWT_PLACEHOLDER_PATTERNS.some((re) => re.test(secret))) {
    return "JWT_SECRET looks like a placeholder or example value: generate a random secret";
  }
  if (new Set(secret).size < 10) {
    return "JWT_SECRET has too few distinct characters to be random: generate a random secret";
  }
  return null;
}

const has = (env: NodeJS.ProcessEnv, name: string) => Boolean(env[name]?.trim());

export function reviewProductionConfig(env: NodeJS.ProcessEnv = process.env): ProductionConfigReport {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const deployed = has(env, "RENDER");
  const production = env.NODE_ENV === "production";

  // Secure cookies, HSTS, trust proxy and test routes all key on this exact value.
  if (deployed && !production) {
    fatal.push('NODE_ENV must be exactly "production" on a deployed service');
  }
  if (!production) return { fatal, warnings };

  const jwtProblem = jwtSecretProblem(env.JWT_SECRET);
  if (jwtProblem) fatal.push(jwtProblem);

  const mfaKey = env.MFA_SECRET_ENCRYPTION_KEY?.trim() ?? "";
  if (mfaKey.length < MFA_KEY_MIN_LENGTH) {
    fatal.push(`MFA_SECRET_ENCRYPTION_KEY must be set with at least ${MFA_KEY_MIN_LENGTH} characters`);
  }
  if (!has(env, "TRUST_PROXY_CIDRS") && !has(env, "TRUST_PROXY_HOPS") && !has(env, "NETLIFY_PROXY_SIGNATURE_SECRET")) {
    warnings.push("No TRUST_PROXY_CIDRS, TRUST_PROXY_HOPS or NETLIFY_PROXY_SIGNATURE_SECRET: using one hop, which may merge clients behind a second proxy");
  }
  if (env.SEC_API_TRAFFIC_CLASSES_ENABLED === "false") {
    warnings.push("SEC_API_TRAFFIC_CLASSES_ENABLED=false: traffic classes are off, one user can affect others on a shared address");
  }
  if (!has(env, "SUPABASE_URL") || !has(env, "SUPABASE_SERVICE_ROLE_KEY")) {
    warnings.push("Supabase Storage is not configured: uploaded files on local disk are lost on redeploy");
  }
  if (!has(env, "CRON_SECRET")) warnings.push("CRON_SECRET is not set: scheduled jobs will be refused");
  if (!has(env, "STRIPE_WEBHOOK_SECRET")) warnings.push("STRIPE_WEBHOOK_SECRET is not set: Stripe webhooks will be refused");
  if (!has(env, "REDIS_URL")) warnings.push("REDIS_URL is not set: rate limits are per process");
  if (env.ENABLE_DEMO_BYPASS === "true") warnings.push("ENABLE_DEMO_BYPASS is set and ignored in production: remove it");
  if (has(env, "EMAIL_VERIFICATION_BYPASS_EMAILS") || has(env, "EMAIL_VERIFICATION_BYPASS_FIRST_NAMES")) {
    warnings.push("Email verification bypass lists are set and ignored in production: remove them");
  }
  if (env.STRIPE_SECRET_KEY?.trim().startsWith("sk_test_")) {
    warnings.push("STRIPE_SECRET_KEY is a test key while NODE_ENV=production");
  }
  for (const name of Object.keys(env)) {
    if (/^VITE_.*(SECRET|PRIVATE|SERVICE_ROLE)/.test(name) && has(env, name)) {
      warnings.push(`${name} has a VITE_ prefix: a build could ship it to browsers`);
    }
  }
  return { fatal, warnings };
}
