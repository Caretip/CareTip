/**
 * Phase 2.8 — secret-safe Stripe Connect destination-charge configuration preflight.
 * Never prints secret values. Does not call Stripe. Does not inspect Render.
 */
import { classifyCheckoutFrontendUrl, resolveCheckoutFrontendBaseUrl } from "./frontendUrl.js";

/** Repository-documented guest SPA origin (CORS allowlist). Not proof of Render env. */
export const REPOSITORY_DOCUMENTED_GUEST_ORIGIN = "https://caretip.de";

export type StripeKeyMode = "TEST" | "LIVE" | "UNKNOWN" | "N/A";

export type StripeConnectPreflightReport = {
  processNodeEnv: string;
  environmentLabel: "LOCAL" | "PRODUCTION_PROCESS";
  stripeSecretKey: {
    presence: "PRESENT" | "MISSING";
    mode: StripeKeyMode;
  };
  stripeWebhookSecret: {
    presence: "PRESENT" | "MISSING";
  };
  frontendUrl: {
    presence: "PRESENT" | "MISSING";
    validity: "VALID" | "INVALID" | "N/A";
    protocol: "HTTPS" | "HTTP" | "OTHER" | "NONE";
    hostClass: "PUBLIC" | "LOCALHOST" | "NONE";
    hostname: string | null;
  };
  productionFrontendUrlRules: {
    wouldAccept: boolean;
    reason: string;
  };
  stripeConnectDefaultCountry: {
    presence: "PRESENT" | "MISSING";
    /** ISO country code or default — not a secret. */
    valueSafe: string;
  };
  render: {
    frontendUrl: "NOT_VERIFIABLE_FROM_REPOSITORY";
    stripeWebhook: "NOT_VERIFIABLE_FROM_REPOSITORY";
    stripeSecret: "NOT_VERIFIABLE_FROM_REPOSITORY";
  };
  documentedGuestOrigin: typeof REPOSITORY_DOCUMENTED_GUEST_ORIGIN;
  stripeDashboard: "NOT VERIFIABLE FROM REPOSITORY";
  productionFrontendUrlHost: "NOT VERIFIABLE";
  modeConsistency: {
    code:
      | "KEY_MISSING"
      | "TEST_KEY_LOCAL_PROCESS"
      | "LIVE_KEY_LOCAL_PROCESS"
      | "TEST_KEY_PRODUCTION_PROCESS"
      | "LIVE_KEY_PRODUCTION_PROCESS"
      | "UNKNOWN_KEY";
    safeLabel: string;
  };
};

function stripeKeyMode(raw: string): StripeKeyMode {
  if (!raw) return "N/A";
  if (raw.startsWith("sk_test_")) return "TEST";
  if (raw.startsWith("sk_live_")) return "LIVE";
  return "UNKNOWN";
}

function connectCountry(env: NodeJS.ProcessEnv): { presence: "PRESENT" | "MISSING"; valueSafe: string } {
  const raw = env.STRIPE_CONNECT_DEFAULT_COUNTRY?.trim().toUpperCase() ?? "";
  if (raw && /^[A-Z]{2}$/.test(raw)) {
    return { presence: "PRESENT", valueSafe: raw };
  }
  return { presence: "MISSING", valueSafe: "DE (code default)" };
}

export function inspectStripeConnectPreflight(
  env: NodeJS.ProcessEnv = process.env,
): StripeConnectPreflightReport {
  const nodeEnv = env.NODE_ENV?.trim() || "(unset)";
  const isProdProcess = env.NODE_ENV === "production";
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhook = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const classified = classifyCheckoutFrontendUrl(env.FRONTEND_URL);

  let productionWouldAccept = false;
  let productionReason = "FRONTEND_URL missing";
  try {
    const resolved = resolveCheckoutFrontendBaseUrl({
      ...env,
      NODE_ENV: "production",
      FRONTEND_URL: env.FRONTEND_URL,
    });
    productionWouldAccept = true;
    productionReason = `would resolve to origin (host ${new URL(resolved).host})`;
  } catch (err) {
    productionWouldAccept = false;
    productionReason = err instanceof Error ? err.message : "invalid";
  }

  let localValidity: "VALID" | "INVALID" | "N/A" = "N/A";
  if (isProdProcess) {
    try {
      resolveCheckoutFrontendBaseUrl(env);
      localValidity = "VALID";
    } catch {
      localValidity = "INVALID";
    }
  } else if (classified.presence === "MISSING") {
    localValidity = "N/A";
  } else {
    localValidity = classified.parseable && classified.protocol !== "OTHER" ? "VALID" : "INVALID";
  }

  return {
    processNodeEnv: nodeEnv,
    environmentLabel: isProdProcess ? "PRODUCTION_PROCESS" : "LOCAL",
    stripeSecretKey: {
      presence: secret ? "PRESENT" : "MISSING",
      mode: stripeKeyMode(secret),
    },
    stripeWebhookSecret: {
      presence: webhook ? "PRESENT" : "MISSING",
    },
    frontendUrl: {
      presence: classified.presence,
      validity: localValidity,
      protocol: classified.protocol,
      hostClass: classified.hostClass,
      hostname: classified.hostname,
    },
    productionFrontendUrlRules: {
      wouldAccept: productionWouldAccept,
      reason: productionReason,
    },
    stripeConnectDefaultCountry: connectCountry(env),
    render: {
      frontendUrl: "NOT_VERIFIABLE_FROM_REPOSITORY",
      stripeWebhook: "NOT_VERIFIABLE_FROM_REPOSITORY",
      stripeSecret: "NOT_VERIFIABLE_FROM_REPOSITORY",
    },
    documentedGuestOrigin: REPOSITORY_DOCUMENTED_GUEST_ORIGIN,
    stripeDashboard: "NOT VERIFIABLE FROM REPOSITORY",
    productionFrontendUrlHost: "NOT VERIFIABLE",
    modeConsistency: classifyModeConsistency(isProdProcess, stripeKeyMode(secret), Boolean(secret)),
  };
}

function classifyModeConsistency(
  isProdProcess: boolean,
  mode: StripeKeyMode,
  present: boolean,
): StripeConnectPreflightReport["modeConsistency"] {
  if (!present || mode === "N/A") {
    return { code: "KEY_MISSING", safeLabel: "STRIPE_SECRET_KEY missing in this process" };
  }
  if (mode === "UNKNOWN") {
    return { code: "UNKNOWN_KEY", safeLabel: "Key present but prefix is neither sk_test_ nor sk_live_" };
  }
  if (isProdProcess && mode === "LIVE") {
    return {
      code: "LIVE_KEY_PRODUCTION_PROCESS",
      safeLabel: "LIVE key on NODE_ENV=production process — still not proof of Render",
    };
  }
  if (isProdProcess && mode === "TEST") {
    return {
      code: "TEST_KEY_PRODUCTION_PROCESS",
      safeLabel: "TEST key on NODE_ENV=production process — not live card charging",
    };
  }
  if (!isProdProcess && mode === "LIVE") {
    return {
      code: "LIVE_KEY_LOCAL_PROCESS",
      safeLabel: "LIVE key on a non-production process — do not mutate Stripe from here",
    };
  }
  return {
    code: "TEST_KEY_LOCAL_PROCESS",
    safeLabel: "TEST key on local/non-production process",
  };
}

export function formatStripeConnectPreflight(report: StripeConnectPreflightReport): string {
  const secretLine =
    report.stripeSecretKey.presence === "MISSING"
      ? "STRIPE_SECRET_KEY: MISSING"
      : `STRIPE_SECRET_KEY: PRESENT — ${report.stripeSecretKey.mode} MODE`;

  const frontendLine = (() => {
    if (report.frontendUrl.presence === "MISSING") return "FRONTEND_URL: MISSING";
    const bits = [
      report.frontendUrl.validity === "INVALID" ? "INVALID" : report.frontendUrl.validity,
      report.frontendUrl.protocol,
      report.frontendUrl.hostClass,
    ].filter((b) => b && b !== "N/A");
    return `FRONTEND_URL: PRESENT — ${bits.join(" ")}`;
  })();

  const country =
    report.stripeConnectDefaultCountry.presence === "PRESENT"
      ? `STRIPE_CONNECT_DEFAULT_COUNTRY: PRESENT (${report.stripeConnectDefaultCountry.valueSafe})`
      : `STRIPE_CONNECT_DEFAULT_COUNTRY: MISSING — ${report.stripeConnectDefaultCountry.valueSafe}`;

  return [
    "=== LOCAL ENVIRONMENT RESULT ===",
    `NODE_ENV: ${report.processNodeEnv} (${report.environmentLabel})`,
    secretLine,
    `STRIPE_WEBHOOK_SECRET: ${report.stripeWebhookSecret.presence}`,
    frontendLine,
    country,
    "",
    "=== PRODUCTION FRONTEND_URL RULE CHECK (simulated NODE_ENV=production) ===",
    report.productionFrontendUrlRules.wouldAccept
      ? `FRONTEND_URL: VALID — ${report.productionFrontendUrlRules.reason}`
      : `FRONTEND_URL: INVALID — ${report.productionFrontendUrlRules.reason}`,
    "",
    "=== RENDER / PRODUCTION HOST ===",
    `RENDER FRONTEND_URL: ${report.render.frontendUrl}`,
    `RENDER STRIPE_SECRET_KEY: ${report.render.stripeSecret}`,
    `RENDER STRIPE_WEBHOOK_SECRET: ${report.render.stripeWebhook}`,
    `Repository-documented guest origin (CORS, not Render proof): ${report.documentedGuestOrigin}`,
  ].join("\n");
}

/** Phase 2.9 go-live printout. Includes 2.8 local result plus unverifiable production/Dashboard lines. */
export function formatStripeConnectGoLivePreflight(report: StripeConnectPreflightReport): string {
  return [
    formatStripeConnectPreflight(report),
    "",
    "=== GO-LIVE CLASSIFICATION (this process only) ===",
    `NODE_ENV: ${report.processNodeEnv}`,
    `STRIPE_MODE_VS_NODE_ENV: ${report.modeConsistency.safeLabel}`,
    `PRODUCTION FRONTEND_URL: ${report.productionFrontendUrlHost}`,
    `STRIPE DASHBOARD: ${report.stripeDashboard}`,
    "Code does not mix-block TEST vs LIVE keys against NODE_ENV; operators must set the intended key on Render.",
  ].join("\n");
}

/** True if the formatted report accidentally contains credential material. */
export function preflightTextLeaksSecrets(text: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const secrets = [
    env.STRIPE_SECRET_KEY?.trim(),
    env.STRIPE_WEBHOOK_SECRET?.trim(),
  ].filter((s): s is string => Boolean(s && s.length >= 8));
  for (const s of secrets) {
    if (text.includes(s)) return true;
  }
  if (/\bsk_(live|test)_[A-Za-z0-9]{8,}\b/.test(text)) return true;
  if (/\bwhsec_[A-Za-z0-9]{8,}\b/.test(text)) return true;
  return false;
}
