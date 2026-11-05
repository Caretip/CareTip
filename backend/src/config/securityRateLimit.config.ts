import { AUTH_WINDOW_15M_MS, AUTH_WINDOW_1H_MS } from "./authRateLimit.config.js";

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const API_TRAFFIC_BURST_WINDOW_MS = 10_000;

/**
 * Per-class API limits. Inactive unless SEC_API_TRAFFIC_CLASSES_ENABLED=true; until then the single
 * `authenticatedApi` limit below applies, exactly as before. Every figure is a starting value to
 * compare against production traffic before enabling; each can be overridden by its env var.
 */
export const apiTrafficRateLimits = {
  enabled: () => process.env.SEC_API_TRAFFIC_CLASSES_ENABLED === "true",
  auth: {
    ip: { max: envInt("SEC_API_AUTH_IP_MAX_PER_15M", 600), windowMs: AUTH_WINDOW_15M_MS },
  },
  sessionRefresh: {
    ip: { max: envInt("SEC_API_REFRESH_IP_MAX_PER_15M", 300), windowMs: AUTH_WINDOW_15M_MS },
    session: { max: envInt("SEC_API_REFRESH_SESSION_MAX_PER_15M", 30), windowMs: AUTH_WINDOW_15M_MS },
  },
  instantPayout: {
    ip: { max: envInt("SEC_API_INSTANT_PAYOUT_IP_MAX_PER_15M", 30), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_INSTANT_PAYOUT_USER_MAX_PER_15M", 5), windowMs: AUTH_WINDOW_15M_MS },
  },
  financialWrite: {
    ip: { max: envInt("SEC_API_FINANCIAL_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_FINANCIAL_USER_MAX_PER_15M", 10), windowMs: AUTH_WINDOW_15M_MS },
  },
  dashboardRead: {
    ip: { max: envInt("SEC_API_DASHBOARD_IP_MAX_PER_15M", 3000), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_DASHBOARD_USER_MAX_PER_15M", 900), windowMs: AUTH_WINDOW_15M_MS },
    burst: { max: envInt("SEC_API_DASHBOARD_USER_BURST_PER_10S", 60), windowMs: API_TRAFFIC_BURST_WINDOW_MS },
  },
  analyticsRead: {
    ip: { max: envInt("SEC_API_ANALYTICS_IP_MAX_PER_15M", 1000), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_ANALYTICS_USER_MAX_PER_15M", 300), windowMs: AUTH_WINDOW_15M_MS },
    burst: { max: envInt("SEC_API_ANALYTICS_USER_BURST_PER_10S", 20), windowMs: API_TRAFFIC_BURST_WINDOW_MS },
  },
  publicTipping: {
    ip: { max: envInt("SEC_API_PUBLIC_TIPPING_IP_MAX_PER_15M", 300), windowMs: AUTH_WINDOW_15M_MS },
  },
  ordinary: {
    ip: { max: envInt("SEC_API_ORDINARY_IP_MAX_PER_15M", 1500), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_ORDINARY_USER_MAX_PER_15M", 400), windowMs: AUTH_WINDOW_15M_MS },
    burst: { max: envInt("SEC_API_ORDINARY_USER_BURST_PER_10S", 40), windowMs: API_TRAFFIC_BURST_WINDOW_MS },
  },
} as const;

export const securityRateLimits = {
  changePassword: {
    ip: { max: envInt("SEC_CHANGE_PASSWORD_IP_MAX_PER_15M", 15), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_CHANGE_PASSWORD_USER_MAX_PER_15M", 8), windowMs: AUTH_WINDOW_15M_MS },
  },
  mfaTotp: {
    ip: { max: envInt("SEC_MFA_TOTP_IP_MAX_PER_15M", 40), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_MFA_TOTP_USER_MAX_PER_15M", 12), windowMs: AUTH_WINDOW_15M_MS },
  },
  mfaFailure: {
    lock: {
      maxFailures: envInt("SEC_MFA_MAX_FAILURES", 5),
      windowMs: AUTH_WINDOW_15M_MS,
      /** Duration of the failure/lock bucket. Defaults to the 15m window; not a second independent timer. */
      lockoutMs: envInt("SEC_MFA_LOCKOUT_MS", 15 * 60 * 1000),
    },
  },
  feedbackTip: {
    ip: { max: envInt("SEC_FEEDBACK_TIP_IP_MAX_PER_15M", 25), windowMs: AUTH_WINDOW_15M_MS },
  },
  /** Authenticated CareTip product review upsert — separate from guest tip feedback. */
  productReviewMe: {
    ip: { max: envInt("SEC_PRODUCT_REVIEW_IP_MAX_PER_15M", 40), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_PRODUCT_REVIEW_USER_MAX_PER_15M", 15), windowMs: AUTH_WINDOW_15M_MS },
  },
  publicSocketToken: {
    ip: { max: envInt("SEC_PUBLIC_SOCKET_TOKEN_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
  },
  authenticatedApi: {
    ip: { max: envInt("SEC_API_IP_MAX_PER_15M", 400), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_USER_MAX_PER_15M", 200), windowMs: AUTH_WINDOW_15M_MS },
  },
  /** Logo, banner, avatar — per authenticated user (+ IP cap). */
  uploadImage: {
    ip: { max: envInt("SEC_UPLOAD_IMAGE_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_UPLOAD_IMAGE_USER_MAX_PER_15M", 25), windowMs: AUTH_WINDOW_15M_MS },
  },
  /** KYC / verification documents — stricter per user. */
  uploadKyc: {
    ip: { max: envInt("SEC_UPLOAD_KYC_IP_MAX_PER_15M", 30), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_UPLOAD_KYC_USER_MAX_PER_15M", 12), windowMs: AUTH_WINDOW_15M_MS },
  },
  platformScheduledPayoutOps: {
    ip: { max: envInt("SEC_PLATFORM_SCHED_PAYOUT_OPS_IP_MAX_PER_15M", 40), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_PLATFORM_SCHED_PAYOUT_OPS_USER_MAX_PER_15M", 20), windowMs: AUTH_WINDOW_15M_MS },
  },
} as const;
