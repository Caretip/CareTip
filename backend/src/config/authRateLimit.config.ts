/** 15-minute window — login / register / invite bursts. */
export const AUTH_WINDOW_15M_MS = 15 * 60 * 1000;
/** 1-hour window — email-heavy abuse (reset, resend, account creation). */
export const AUTH_WINDOW_1H_MS = 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Layered auth limits — IP caps are intentionally higher than per-email / composite
 * so legitimate users on shared venue WiFi (hotels, cafés, corporate) are not blocked.
 */
export const authRateLimits = {
  login: {
    ip: { max: envInt("AUTH_LOGIN_IP_MAX_PER_15M", 100), windowMs: AUTH_WINDOW_15M_MS },
    email: { max: envInt("AUTH_LOGIN_EMAIL_MAX_PER_15M", 20), windowMs: AUTH_WINDOW_15M_MS },
    ipEmail: { max: envInt("AUTH_LOGIN_IP_EMAIL_MAX_PER_15M", 10), windowMs: AUTH_WINDOW_15M_MS },
  },
  register: {
    ip: { max: envInt("AUTH_REGISTER_IP_MAX_PER_15M", 40), windowMs: AUTH_WINDOW_15M_MS },
    email: { max: envInt("AUTH_REGISTER_EMAIL_MAX_PER_HOUR", 5), windowMs: AUTH_WINDOW_1H_MS },
  },
  passwordReset: {
    ip: { max: envInt("AUTH_FORGOT_PASSWORD_IP_MAX_PER_HOUR", 25), windowMs: AUTH_WINDOW_1H_MS },
    email: { max: envInt("AUTH_FORGOT_PASSWORD_EMAIL_MAX_PER_HOUR", 5), windowMs: AUTH_WINDOW_1H_MS },
  },
  resetPasswordSubmit: {
    ip: { max: envInt("AUTH_RESET_PASSWORD_IP_MAX_PER_HOUR", 30), windowMs: AUTH_WINDOW_1H_MS },
  },
  resendVerification: {
    ip: { max: envInt("AUTH_RESEND_VERIFICATION_IP_MAX_PER_HOUR", 20), windowMs: AUTH_WINDOW_1H_MS },
    email: { max: envInt("AUTH_RESEND_VERIFICATION_EMAIL_MAX_PER_HOUR", 5), windowMs: AUTH_WINDOW_1H_MS },
  },
  employeeInvite: {
    ip: { max: envInt("AUTH_INVITE_IP_MAX_PER_15M", 50), windowMs: AUTH_WINDOW_15M_MS },
    email: { max: envInt("AUTH_INVITE_EMAIL_MAX_PER_HOUR", 5), windowMs: AUTH_WINDOW_1H_MS },
    inviteCode: { max: envInt("AUTH_INVITE_CODE_MAX_PER_HOUR", 40), windowMs: AUTH_WINDOW_1H_MS },
  },
  inviteValidate: {
    ip: { max: envInt("AUTH_INVITE_VALIDATE_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
    inviteCode: { max: envInt("AUTH_INVITE_VALIDATE_CODE_MAX_PER_HOUR", 50), windowMs: AUTH_WINDOW_1H_MS },
  },
  /** Mobile → web billing handoff issuance (authenticated manager). */
  mobileWebHandoffCreate: {
    ip: { max: envInt("AUTH_MOBILE_HANDOFF_CREATE_IP_MAX_PER_15M", 40), windowMs: AUTH_WINDOW_15M_MS },
    user: { max: envInt("AUTH_MOBILE_HANDOFF_CREATE_USER_MAX_PER_15M", 10), windowMs: AUTH_WINDOW_15M_MS },
  },
  /** Mobile → web handoff redeem (public, token-gated). */
  mobileWebHandoffConsume: {
    ip: { max: envInt("AUTH_MOBILE_HANDOFF_CONSUME_IP_MAX_PER_15M", 60), windowMs: AUTH_WINDOW_15M_MS },
    token: { max: envInt("AUTH_MOBILE_HANDOFF_CONSUME_TOKEN_MAX_PER_15M", 8), windowMs: AUTH_WINDOW_15M_MS },
  },
} as const;
