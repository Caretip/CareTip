/**
 * Startup configuration review. `fatal` stops the process, because the server would otherwise run
 * with weaker security than it reports. `warnings` are logged for the operator. Values are never
 * included in messages.
 */
import { MFA_KEY_MIN_LENGTH } from "../lib/mfaSecretCrypto.js";

export type ProductionConfigReport = { fatal: string[]; warnings: string[] };

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
  const jwt = env.JWT_SECRET?.trim() ?? "";
  if (jwt && jwt.length < 32) warnings.push("JWT_SECRET is shorter than 32 characters");
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
