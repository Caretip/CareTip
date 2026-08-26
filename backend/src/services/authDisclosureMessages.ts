/**
 * Auth client messages that avoid account enumeration / method disclosure.
 * Prefer these over existence-confirming copy in public auth flows.
 */

/** Password login / credential checks — same for missing, wrong password, OAuth-only, inactive. */
export const AUTH_INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

/**
 * Public registration conflict (email already taken, race P2002, etc.).
 * Does not confirm whether the email is registered.
 */
export const AUTH_REGISTER_GENERIC_MESSAGE =
  "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.";

/**
 * Public OAuth login/signup failures that previously forked on account existence,
 * linking state, disabled status, or platform-admin routing.
 */
export const AUTH_OAUTH_GENERIC_FAILURE_MESSAGE =
  "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.";

/** Uniform code for OAuth failures that must not distinguish account existence. */
export const AUTH_OAUTH_SIGN_IN_FAILED_CODE = "OAUTH_SIGN_IN_FAILED" as const;

/**
 * Resend-verification after password proof when already verified — same shape as send success.
 */
export const AUTH_RESEND_VERIFICATION_GENERIC_MESSAGE =
  "If verification is needed for this account, we sent a link.";

/** Authenticated OAuth link failure (cross-user) — no “another user” disclosure. */
export const AUTH_OAUTH_LINK_FAILED_MESSAGE = "Unable to link this social account.";
