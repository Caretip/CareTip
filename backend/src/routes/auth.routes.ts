import { Router } from "express";
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
} from "../middleware/authRateLimit.middleware.js";
import {
  changePasswordRateLimit,
  mfaTotpRateLimit,
} from "../middleware/securityRateLimit.middleware.js";
import { requireTrustedOrigin } from "../middleware/requireTrustedOrigin.middleware.js";
import { requireCaretipClientHeader } from "../middleware/requireCaretipClientHeader.middleware.js";
import * as authController from "../controllers/auth.controller.js";
import * as mobileWebHandoffController from "../controllers/mobileWebHandoff.controller.js";

const router = Router();

router.post("/register", registerCombinedRateLimit, authController.register);
router.post("/login", loginRateLimit, requireTrustedOrigin, authController.login);
/** Same handler as POST /login — preferred name for sign-in clients. */
router.post("/signin", loginRateLimit, requireTrustedOrigin, authController.login);
router.post("/login/mfa/setup", loginRateLimit, authController.loginMfaSetup);
router.post("/login/mfa/enable", mfaTotpRateLimit, authController.loginMfaEnable);
router.post("/login/mfa/verify", mfaTotpRateLimit, authController.loginMfaVerify);
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
router.patch("/me", authMiddleware, requireVerifiedEmail, authController.patchMe);

// 2FA (TOTP) management (does not change login flow by itself)
router.get("/2fa/status", authMiddleware, authController.twoFactorStatus);
router.post("/2fa/setup", authMiddleware, authController.twoFactorSetup);
router.post("/2fa/enable", authMiddleware, mfaTotpRateLimit, authController.twoFactorEnable);
router.post("/2fa/disable", authMiddleware, mfaTotpRateLimit, authController.twoFactorDisable);

export default router;
