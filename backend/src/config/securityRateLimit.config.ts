import { AUTH_WINDOW_15M_MS, AUTH_WINDOW_1H_MS } from "./authRateLimit.config.js";

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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
  publicSocketToken: {
    ip: { max: envInt("SEC_PUBLIC_SOCKET_TOKEN_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
  },
  authenticatedApi: {
    ip: { max: envInt("SEC_API_IP_MAX_PER_15M", 400), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("SEC_API_USER_MAX_PER_15M", 200), windowMs: AUTH_WINDOW_15M_MS },
  },
} as const;
