import express, { Router } from "express";
import { authMiddleware, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import {
  loginRateLimit,
  registerCombinedRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  resendVerificationRateLimit,
  resendVerificationSessionRateLimit,
  oauthRateLimit,
  activateEmployeeRateLimit,
  mobileWebHandoffConsumeRateLimitWithAudit,
  appleNativeCallbackRateLimit,
  googleRedirectRateLimit,
} from "../middleware/authRateLimit.middleware.js";
import { buildGoogleRedirectCompleteUrl } from "../services/oauth/googleOAuthRedirect.service.js";
import {
  changePasswordRateLimit,
  mfaTotpRateLimit,
  mfaLoginChallengeRateLimit,
} from "../middleware/securityRateLimit.middleware.js";
import { requireTrustedOrigin } from "../middleware/requireTrustedOrigin.middleware.js";
import { requireCaretipClientHeader } from "../middleware/requireCaretipClientHeader.middleware.js";
import * as authController from "../controllers/auth.controller.js";
import * as mobileWebHandoffController from "../controllers/mobileWebHandoff.controller.js";
import * as facebookOAuthRedirectController from "../controllers/facebookOAuthRedirect.controller.js";

const router = Router();

router.post("/register", registerCombinedRateLimit, authController.register);
router.post("/login", loginRateLimit, requireTrustedOrigin, authController.login);
/** Same handler as POST /login — preferred name for sign-in clients. */
router.post("/signin", loginRateLimit, requireTrustedOrigin, authController.login);
router.post(
  "/cancel-deletion",
  loginRateLimit,
  requireTrustedOrigin,
  authController.cancelDeletion,
);
router.post("/login/mfa/setup", loginRateLimit, authController.loginMfaSetup);
router.post("/login/mfa/enable", mfaLoginChallengeRateLimit, authController.loginMfaEnable);
router.post("/login/mfa/verify", mfaLoginChallengeRateLimit, authController.loginMfaVerify);
router.post(
  "/resend-verification-email",
  resendVerificationRateLimit,
  authController.resendVerificationEmail
);
router.post(
  "/resend-verification-email/session",
  authMiddleware,
  resendVerificationSessionRateLimit,
  authController.resendVerificationEmailForSession
);
router.post("/oauth", oauthRateLimit, authController.oauth);
// Google Identity Services redirect mode (mobile web). Cross-site form POST from accounts.google.com:
// CSRF is Google's g_csrf_token double-submit cookie, so there is no trusted-origin gate here.
router.post(
  "/google/redirect",
  googleRedirectRateLimit((res) => {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(303, buildGoogleRedirectCompleteUrl({ error: "rate_limited" }));
  }),
  authController.googleRedirectCallback,
);
router.post(
  "/facebook/start",
  oauthRateLimit,
  requireTrustedOrigin,
  facebookOAuthRedirectController.startFacebookOAuthRedirect,
);
router.post(
  "/facebook/start/link",
  authMiddleware,
  oauthRateLimit,
  requireTrustedOrigin,
  facebookOAuthRedirectController.startFacebookOAuthRedirect,
);
router.get("/facebook/callback", oauthRateLimit, facebookOAuthRedirectController.facebookOAuthCallback);
router.post(
  "/facebook/complete",
  oauthRateLimit,
  requireTrustedOrigin,
  requireCaretipClientHeader,
  facebookOAuthRedirectController.consumeFacebookOAuthComplete,
);
/**
 * Apple HTTPS Return URL for Android web OAuth (form_post bounce → caretip://).
 * Not a session/login endpoint — identity verification stays on POST /oauth.
 */
router.get("/apple/native-callback", appleNativeCallbackRateLimit, authController.appleNativeCallback);
router.post(
  "/apple/native-callback",
  express.urlencoded({ extended: false, limit: "32kb" }),
  appleNativeCallbackRateLimit,
  authController.appleNativeCallback,
);
router.get("/oauth/accounts", authMiddleware, authController.listLinkedOAuthAccounts);
router.post("/oauth/link", authMiddleware, oauthRateLimit, authController.linkOAuthAccount);
router.post("/oauth/unlink", authMiddleware, authController.unlinkOAuthAccount);
router.delete(
  "/oauth/accounts/:provider",
  authMiddleware,
  authController.unlinkOAuthAccount,
);
router.post("/activate-employee", activateEmployeeRateLimit, authController.activateEmployee);
/** Mobile→web one-time handoff redeem — sets refresh cookie + returns access JWT. */
router.post(
  "/mobile-web-handoff/consume",
  mobileWebHandoffConsumeRateLimitWithAudit,
  requireTrustedOrigin,
  mobileWebHandoffController.consumeMobileWebHandoffSession,
);
router.get(
  "/activate-employee-branding",
  authController.activateEmployeeBrandingPreview
);
router.post(
  "/refresh",
  requireCaretipClientHeader,
  requireTrustedOrigin,
  authController.refresh,
);
/** API-hostname migration: exchange a validated session for a cookie issued by this host. */
router.post(
  "/session/migrate",
  oauthRateLimit,
  requireCaretipClientHeader,
  requireTrustedOrigin,
  authMiddleware,
  authController.migrateSessionHost,
);
router.post(
  "/logout",
  requireCaretipClientHeader,
  requireTrustedOrigin,
  authController.logout,
);
router.get("/verify-email", authController.verifyEmail);
router.post("/forgot-password", forgotPasswordRateLimit, authController.forgotPassword);
router.post("/reset-password", resetPasswordRateLimit, authController.resetPassword);
router.post("/change-password", authMiddleware, changePasswordRateLimit, authController.changePassword);
router.post("/email-change/request", authMiddleware, changePasswordRateLimit, authController.requestOwnEmailChange);
router.post("/account-recovery/request", forgotPasswordRateLimit, requireTrustedOrigin, authController.requestAccountRecovery);
router.post("/account-recovery/confirm", resetPasswordRateLimit, requireTrustedOrigin, authController.confirmAccountRecovery);
router.post("/account-recovery/cancel", resetPasswordRateLimit, requireTrustedOrigin, authController.cancelAccountRecovery);
router.post("/email-change/approve", resetPasswordRateLimit, requireTrustedOrigin, authController.approveEmailChange);
router.post("/email-change/confirm", resetPasswordRateLimit, requireTrustedOrigin, authController.confirmEmailChange);
router.patch("/me", authMiddleware, requireVerifiedEmail, authController.patchMe);

// 2FA (TOTP) management (does not change login flow by itself)
router.get("/2fa/status", authMiddleware, authController.twoFactorStatus);
router.post("/2fa/setup", authMiddleware, mfaTotpRateLimit, authController.twoFactorSetup);
router.post("/2fa/enable", authMiddleware, mfaTotpRateLimit, authController.twoFactorEnable);
router.post("/2fa/disable", authMiddleware, mfaTotpRateLimit, authController.twoFactorDisable);
router.post("/2fa/replace/start", authMiddleware, mfaTotpRateLimit, authController.twoFactorReplaceStart);
router.post("/2fa/replace/confirm", authMiddleware, mfaTotpRateLimit, authController.twoFactorReplaceConfirm);

export default router;
