/**
 * Auth information-disclosure / account-enumeration regression.
 * Run: npm run test:auth-enumeration (from backend/)
 */
import { randomBytes } from "node:crypto";
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import * as authService from "../src/services/auth.service.js";
import * as oauthAuthService from "../src/services/oauthAuth.service.js";
import { registerEmployeeWithInvite } from "../src/services/employeeInvite.service.js";
import { requestPasswordReset } from "../src/services/passwordReset.service.js";
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
  AUTH_OAUTH_SIGN_IN_FAILED_CODE,
  AUTH_REGISTER_GENERIC_MESSAGE,
} from "../src/services/authDisclosureMessages.js";
import { clientSafeMessage } from "../src/utils/httpErrors.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function assertNoExpository(msg: string, label: string) {
  const bad =
    /already exists|already registered|already in use|Linked Accounts|not registered with CareTip|This social account is not registered|has been disabled|Use the Platform Admin|This account uses (Google|Apple|Facebook|social)|Continue with Google, Apple, or Facebook/i;
  if (bad.test(msg)) fail(`${label}: expository message — ${msg}`);
  else pass(`${label}: non-expository`);
}

async function main() {
  const tag = randomBytes(6).toString("hex");
  const existingEmail = `enum-existing-${tag}@caretip-test.local`;
  const missingEmail = `enum-missing-${tag}@caretip-test.local`;
  const oauthEmail = `enum-oauth-${tag}@caretip-test.local`;
  const password = "EnumTest1!a";
  let existingUserId: string | null = null;
  let oauthUserId: string | null = null;
  let inviteId: string | null = null;
  let businessId: string | null = null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await prisma.user.create({
      data: {
        email: existingEmail,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        isActive: true,
        business: { create: { name: `Enum Biz ${tag}`, slug: `enum-biz-${tag}` } },
      },
      select: { id: true, business: { select: { id: true } } },
    });
    existingUserId = existing.id;
    businessId = existing.business?.id ?? null;

    const oauthOnly = await prisma.user.create({
      data: {
        email: oauthEmail,
        passwordHash: null,
        role: "MANAGER",
        emailVerified: true,
        isActive: true,
        business: { create: { name: `Enum OAuth Biz ${tag}`, slug: `enum-oauth-${tag}` } },
        oauthAccounts: {
          create: {
            provider: "google",
            subject: `enum-google-${tag}`,
            emailAtLink: oauthEmail,
          },
        },
      },
      select: { id: true },
    });
    oauthUserId = oauthOnly.id;

    // --- Signup: existing email ---
    try {
      await authService.registerBusiness({
        email: existingEmail,
        password,
        name: "Should Fail",
      });
      fail("register existing email should throw");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === AUTH_REGISTER_GENERIC_MESSAGE) pass("register existing → generic register message");
      else fail(`register existing unexpected: ${msg}`);
      assertNoExpository(msg, "register existing");
    }

    // --- Login: unknown email vs wrong password ---
    let unknownMsg = "";
    let wrongPwMsg = "";
    try {
      await authService.validateLoginCredentials({ email: missingEmail, password });
      fail("unknown email should fail login");
    } catch (e) {
      unknownMsg = e instanceof Error ? e.message : String(e);
    }
    try {
      await authService.validateLoginCredentials({
        email: existingEmail,
        password: "WrongPass1!",
      });
      fail("wrong password should fail login");
    } catch (e) {
      wrongPwMsg = e instanceof Error ? e.message : String(e);
    }
    if (unknownMsg === AUTH_INVALID_CREDENTIALS_MESSAGE && unknownMsg === wrongPwMsg) {
      pass("login unknown email === wrong password message");
    } else {
      fail(`login messages differ: unknown="${unknownMsg}" wrong="${wrongPwMsg}"`);
    }

    // --- Login: OAuth-only ---
    let oauthOnlyMsg = "";
    try {
      await authService.validateLoginCredentials({
        email: oauthEmail,
        password: "WrongPass1!",
      });
      fail("oauth-only password login should fail");
    } catch (e) {
      oauthOnlyMsg = e instanceof Error ? e.message : String(e);
    }
    if (oauthOnlyMsg === AUTH_INVALID_CREDENTIALS_MESSAGE) {
      pass("oauth-only password login uses invalid credentials");
    } else {
      fail(`oauth-only login message: ${oauthOnlyMsg}`);
    }
    assertNoExpository(oauthOnlyMsg, "oauth-only login");

    // --- Forgot password ---
    try {
      await requestPasswordReset(existingEmail);
      await requestPasswordReset(missingEmail);
      pass("forgot password succeeds for existing and missing emails");
    } catch (e) {
      fail(`forgot password threw: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- OAuth error uniformity ---
    const linkErr = new oauthAuthService.OAuthLinkingRequiredError(existingEmail, "google");
    const failErr = new oauthAuthService.OAuthSignInFailedError();
    if (
      linkErr.code === AUTH_OAUTH_SIGN_IN_FAILED_CODE &&
      failErr.code === AUTH_OAUTH_SIGN_IN_FAILED_CODE &&
      linkErr.message === AUTH_OAUTH_GENERIC_FAILURE_MESSAGE &&
      failErr.message === AUTH_OAUTH_GENERIC_FAILURE_MESSAGE
    ) {
      pass("OAuth linking and generic failure share code+message");
    } else {
      fail("OAuth error uniformity broken");
    }
    assertNoExpository(linkErr.message, "oauth linking message");
    assertNoExpository(
      oauthAuthService.OAUTH_ACCOUNT_NOT_REGISTERED_MESSAGE,
      "oauth not-registered const",
    );

    // --- Resend verification when already verified ---
    try {
      await authService.resendVerificationEmail({
        email: existingEmail,
        password,
      });
      pass("resend verification when already verified is silent success");
    } catch (e) {
      fail(`resend verified threw: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- Employee invite with existing email ---
    if (businessId && existingUserId) {
      const inviteCode = `EN${tag.slice(0, 6).toUpperCase()}`;
      const invite = await prisma.employeeInvite.create({
        data: {
          inviteCode,
          businessId,
          createdByUserId: existingUserId,
          expiresAt: new Date(Date.now() + 86400000),
          status: "active",
        },
      });
      inviteId = invite.id;
      try {
        await registerEmployeeWithInvite({
          inviteCode,
          email: existingEmail,
          name: "Dup",
          passwordHash,
          emailVerified: true,
          preferredLocale: null,
          activationStatus: "active",
          registrationChannel: "password",
        });
        fail("employee invite with existing email should fail");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === AUTH_REGISTER_GENERIC_MESSAGE) {
          pass("employee invite existing email → generic register");
        } else {
          fail(`employee invite message: ${msg}`);
        }
      }
    } else {
      fail("could not create invite fixture");
    }

    // --- Prisma P2002 ---
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });
    const safe = clientSafeMessage(p2002, "fallback");
    if (safe === AUTH_REGISTER_GENERIC_MESSAGE) pass("P2002 maps to generic register message");
    else fail(`P2002 clientSafeMessage: ${safe}`);
    assertNoExpository(safe, "P2002");

    const primary =
      "An account with this email already exists. Sign in with your existing method, then link this provider from Settings → Security → Linked Accounts.";
    if (oauthAuthService.OAUTH_LINKING_REQUIRED_MESSAGE !== primary) {
      pass("primary OAuth linking copy removed from backend constant");
    } else {
      fail("primary OAuth linking copy still present");
    }
  } finally {
    if (inviteId) {
      await prisma.employeeInvite.delete({ where: { id: inviteId } }).catch(() => {});
    }
    if (oauthUserId) {
      await prisma.oAuthAccount.deleteMany({ where: { userId: oauthUserId } }).catch(() => {});
      await prisma.business.deleteMany({ where: { userId: oauthUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: oauthUserId } }).catch(() => {});
    }
    if (existingUserId) {
      await prisma.employeeInvite.deleteMany({ where: { createdByUserId: existingUserId } }).catch(() => {});
      await prisma.business.deleteMany({ where: { userId: existingUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: existingUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
