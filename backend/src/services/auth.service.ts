import bcrypt from "bcrypt";
import { type BusinessVerificationStatus, type Role, type User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { validatePassword } from "../utils/passwordValidation.js";
import { EmailNotVerifiedLoginError } from "../utils/httpErrors.js";
import {
  ACCESS_JWT_TYPE,
  IMPERSONATION_JWT_TYPE,
  signJwt,
} from "../lib/jwtConfig.js";
import { generateUniqueBusinessSlugForName } from "./business.service.js";
import { isSubscriptionBasicDefaultEnabled } from "../config/featureFlags.js";
import { provisionInternalBasicSubscription } from "./subscription.service.js";
import {
  buildVerifyEmailHttpsFallbackUrl,
  buildVerifyEmailUrl,
  createEmailVerificationToken,
  sendEmailVerificationEmail,
} from "./emailVerification.service.js";
import type { AuthLinkPlatform } from "../utils/clientPlatform.js";
import * as employeeActivationService from "./employeeActivation.service.js";
import { registerEmployeeWithInvite } from "./employeeInvite.service.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { applyEmailVerificationBypassIfEligible } from "./emailVerificationBypass.service.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { resolveEmailLocale, resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import { assertPlatformAdminMfaSessionAllowed } from "./mfaLogin.service.js";
import { inferManagerOnboardingStep, type OnboardingStep } from "./onboardingProgress.service.js";
import { kycStatusToLegacyMirror } from "../lib/verificationWorkflow.js";
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_REGISTER_GENERIC_MESSAGE,
} from "./authDisclosureMessages.js";

/** Mirrors the frontend `AuthResponse.user` shape (see `src/app/lib/api.ts`). */
export interface AuthUserDto {
  id: string;
  email: string;
  role: Role;
  name: string;
  /** False until the user completes email verification (password sign-up). */
  emailVerified: boolean;
  /** Business-only: whether onboarding has been completed. */
  hasCompletedOnboarding?: boolean;
  /** Business-only: 1–3 wizard step inferred from saved profile (resume). */
  onboardingStep?: OnboardingStep;
  businessId?: string;
  employeeId?: string;
  avatar?: string | null;
  impersonation?: boolean;
  impersonatedBy?: string;
  businessVerificationStatus?: "pending" | "verified" | "rejected";
  onboardingVerificationStatus?: "draft" | "submitted" | "approved" | "rejected";
  kycVerificationStatus?: "not_started" | "awaiting_upload" | "pending_review" | "verified" | "rejected";
  /** UI + email language (`en` / `de`). */
  preferredLocale?: string | null;
}

export interface AuthResult {
  token: string;
  user: AuthUserDto;
}

/** Password sign-up before inbox verification — no access JWT or refresh session. */
export interface RegisterPendingResult {
  requiresEmailVerification: true;
  user: AuthUserDto;
}

export type AuthIntendedRole = "MANAGER" | "EMPLOYEE" | "SUPER_ADMIN";

export type LoginInput = {
  email: string;
  password: string;
};

export function normalizeLoginEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function parseLoginIntendedRole(raw: unknown): AuthIntendedRole | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().toUpperCase().replace(/-/g, "_");
  if (n === "MANAGER" || n === "BUSINESS") return "MANAGER";
  if (n === "EMPLOYEE" || n === "STAFF") return "EMPLOYEE";
  if (n === "SUPER_ADMIN" || n === "SUPERADMIN" || n === "PLATFORM_ADMIN" || n === "ADMIN") {
    return "SUPER_ADMIN";
  }
  return null;
}

export type AuthSessionContext = {
  /** Links access JWT to the active refresh session — invalidated on logout / rotation revoke. */
  refreshSessionId?: string;
};

function jwtExpiresIn() {
  // Short-lived access token (15m default); override with `JWT_EXPIRES_IN` if needed.
  return (process.env.JWT_EXPIRES_IN?.trim() || "15m") as import("jsonwebtoken").SignOptions["expiresIn"];
}

function impersonationJwtExpiresIn() {
  return (process.env.JWT_IMPERSONATION_EXPIRES_IN?.trim() || "12h") as import("jsonwebtoken").SignOptions["expiresIn"];
}

/** Exported for security regression scripts that simulate client JWT misuse. */
export function signAuthJwt(payload: Record<string, unknown>): string {
  return signJwt(payload, jwtExpiresIn());
}

export function signImpersonationToken(
  targetUserId: string,
  _targetEmail: string,
  platformAdminUserId: string
): string {
  return signJwt(
    {
      sub: targetUserId,
      role: "MANAGER",
      type: IMPERSONATION_JWT_TYPE,
      impersonatedBy: platformAdminUserId,
    },
    impersonationJwtExpiresIn(),
  );
}

type BusinessForAuthResult = {
  id: string;
  name: string;
  verificationStatus: BusinessVerificationStatus;
  onboardingVerificationStatus?: string;
  kycVerificationStatus?: string;
  businessType?: string | null;
  registeredAddress?: string | null;
};

type UserForAuthResult = User & {
  business?: BusinessForAuthResult | null;
  employee?: { id: string; name: string; avatar: string | null; businessId: string } | null;
};

const businessIncludeForAuth = {
  select: {
    id: true,
    name: true,
    verificationStatus: true,
    onboardingVerificationStatus: true,
    kycVerificationStatus: true,
    businessType: true,
    registeredAddress: true,
  },
} as const;

/** True when the manager finished the business onboarding wizard (DB flag). */
export function managerHasCompletedOnboarding(
  user: Pick<User, "role" | "hasCompletedOnboarding" | "onboardingCompletedAt">,
): boolean {
  if (user.role !== "MANAGER") return true;
  return user.hasCompletedOnboarding === true && user.onboardingCompletedAt != null;
}

type ImpersonatedManagerBusiness = {
  id: string;
  name: string;
  verificationStatus: BusinessVerificationStatus;
  onboardingVerificationStatus?: string;
  kycVerificationStatus?: string;
  businessType?: string | null;
  registeredAddress?: string | null;
};

/**
 * Manager auth user payload for platform impersonation — same verification/onboarding
 * fields as {@link buildAuthUserDto} on a normal login, plus impersonation markers.
 */
export function impersonationAuthUserDto(
  manager: Pick<
    User,
    | "id"
    | "email"
    | "role"
    | "emailVerified"
    | "hasCompletedOnboarding"
    | "onboardingCompletedAt"
    | "preferredLocale"
  >,
  business: ImpersonatedManagerBusiness,
  platformAdminUserId: string,
): AuthUserDto {
  const completed = managerHasCompletedOnboarding(manager);
  return {
    id: manager.id,
    email: manager.email,
    role: manager.role,
    name: business.name,
    emailVerified: manager.emailVerified === true,
    preferredLocale: manager.preferredLocale ?? null,
    hasCompletedOnboarding: completed,
    onboardingStep: completed
      ? 3
      : inferManagerOnboardingStep({
          name: business.name,
          businessType: business.businessType,
          registeredAddress: business.registeredAddress,
        }),
    businessId: business.id,
    businessVerificationStatus: kycStatusToLegacyMirror(
      business.kycVerificationStatus as import("@prisma/client").KycVerificationStatus | undefined,
    ),
    onboardingVerificationStatus: business.onboardingVerificationStatus as AuthUserDto["onboardingVerificationStatus"],
    kycVerificationStatus: business.kycVerificationStatus as AuthUserDto["kycVerificationStatus"],
    impersonation: true,
    impersonatedBy: platformAdminUserId,
  };
}

function displayNameForUser(user: UserForAuthResult): string {
  if (user.role === "MANAGER" && user.business?.name) {
    return user.business.name;
  }
  if (user.role === "EMPLOYEE" && user.employee?.name) {
    return user.employee.name;
  }
  return user.email.split("@")[0] || "User";
}

function buildAuthUserDto(user: UserForAuthResult): AuthUserDto {
  const dto: AuthUserDto = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: displayNameForUser(user),
    emailVerified: user.emailVerified === true,
    preferredLocale: user.preferredLocale ?? null,
  };

  if (user.role === "MANAGER") {
    const completed = managerHasCompletedOnboarding(user);
    dto.hasCompletedOnboarding = completed;
    dto.onboardingStep = completed
      ? 3
      : inferManagerOnboardingStep(
          user.business
            ? {
                name: user.business.name,
                businessType: user.business.businessType,
                registeredAddress: user.business.registeredAddress,
              }
            : null,
        );
    if (user.business) {
      dto.businessId = user.business.id;
      dto.businessVerificationStatus = kycStatusToLegacyMirror(
        user.business.kycVerificationStatus as import("@prisma/client").KycVerificationStatus | undefined,
      );
      dto.onboardingVerificationStatus =
        user.business.onboardingVerificationStatus as AuthUserDto["onboardingVerificationStatus"];
      dto.kycVerificationStatus =
        user.business.kycVerificationStatus as AuthUserDto["kycVerificationStatus"];
    }
  }
  if (user.role === "EMPLOYEE" && user.employee) {
    dto.employeeId = user.employee.id;
    dto.businessId = user.employee.businessId;
    dto.avatar = absolutizePublicMediaPath(user.employee.avatar ?? null);
  }

  return dto;
}

function jwtPayloadForUser(
  user: UserForAuthResult,
  ctx?: AuthSessionContext,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sub: user.id,
    role: user.role,
    type: ACCESS_JWT_TYPE,
    tv: user.authTokenVersion ?? 0,
  };
  const sid = ctx?.refreshSessionId?.trim();
  if (sid) payload.sid = sid;
  return payload;
}

/** Registration response only — never includes a session token. */
export function pendingVerificationResultForUserRecord(user: UserForAuthResult): RegisterPendingResult {
  return {
    requiresEmailVerification: true,
    user: buildAuthUserDto(user),
  };
}

export function authResultForUserRecord(
  user: UserForAuthResult,
  ctx?: AuthSessionContext,
): AuthResult {
  return {
    token: signAuthJwt(jwtPayloadForUser(user, ctx)),
    user: buildAuthUserDto(user),
  };
}

/** Legacy rows: `has_completed_onboarding` was auto-set from profile fields without a finish action. */
async function reconcileStaleOnboardingCompletion(user: UserForAuthResult): Promise<UserForAuthResult> {
  if (user.role !== "MANAGER") return user;
  if (user.hasCompletedOnboarding !== true || user.onboardingCompletedAt != null) {
    return user;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { hasCompletedOnboarding: false },
  });
  return { ...user, hasCompletedOnboarding: false };
}

async function loadUserForAuthResult(userId: string): Promise<UserForAuthResult> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      business: businessIncludeForAuth,
      employee: { select: { id: true, name: true, avatar: true, businessId: true } },
    },
  });
  if (!row) {
    throw new Error("Invalid email or password");
  }
  return reconcileStaleOnboardingCompletion(row);
}

/** Used by refresh-token flow to re-issue an access token and user payload. */
export async function authResultForUserId(
  userId: string,
  ctx?: AuthSessionContext,
): Promise<AuthResult> {
  const user = await loadUserForAuthResult(userId);
  if (!user || user.isActive !== true) {
    throw new Error("Authentication required");
  }
  if (
    (user.role === "MANAGER" || user.role === "EMPLOYEE") &&
    user.emailVerified !== true
  ) {
    throw new EmailNotVerifiedLoginError();
  }
  await assertPlatformAdminMfaSessionAllowed(user);
  return authResultForUserRecord(user, ctx);
}

async function sendVerificationEmailBestEffort(
  userId: string,
  email: string,
  opts?: {
    explicitLocale?: string | null;
    acceptLanguage?: string | null;
    platform?: "web" | "mobile";
  }
): Promise<void> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    const locale = resolveUserPreferredLocale(
      opts?.explicitLocale ?? u?.preferredLocale ?? null,
    );
    const platform: AuthLinkPlatform = opts?.platform === "mobile" ? "mobile" : "web";
    const { plainToken } = await createEmailVerificationToken(userId);
    await sendEmailVerificationEmail({
      to: email,
      verifyUrl: buildVerifyEmailUrl(plainToken, platform),
      secondaryVerifyUrl:
        platform === "mobile" ? buildVerifyEmailHttpsFallbackUrl(plainToken) : null,
      locale,
      userId,
    });
  } catch (e) {
    console.error("[auth] Failed to enqueue email verification", { userId, email }, e);
  }
}

export async function registerBusiness(
  input: {
    email: string;
    password: string;
    /** Optional display name for the account (not persisted to Business profile). */
    name?: string;
    /** Client app language (`en` / `de`); stored on user for email + UI consistency. */
    locale?: string | null;
  },
  opts?: { acceptLanguage?: string | null; platform?: AuthLinkPlatform }
): Promise<RegisterPendingResult> {
  const email = normalizeLoginEmail(input.email);
  const pwCheck = validatePassword(input.password);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.message ?? "Password is required");
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new Error(AUTH_REGISTER_GENERIC_MESSAGE);
  }

  const baseName = (email.split("@")[0] || "My").trim();
  const placeholderBusinessName = `${baseName} venue`;
  const slug = await generateUniqueBusinessSlugForName(placeholderBusinessName);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const preferredLocale = input.locale?.trim()
    ? resolveUserPreferredLocale(input.locale)
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "MANAGER",
        isPlatformAdmin: false,
        emailVerified: false,
        preferredLocale,
        business: {
          create: {
            name: placeholderBusinessName,
            slug,
            businessType: null,
            location: null,
            registeredAddress: null,
            contactPhone: null,
            contactEmail: null,
            website: null,
          },
        },
      },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            verificationStatus: true,
            onboardingVerificationStatus: true,
            kycVerificationStatus: true,
          },
        },
        employee: { select: { id: true, name: true, avatar: true, businessId: true } },
      },
    });

    if (isSubscriptionBasicDefaultEnabled() && user.business?.id) {
      await provisionInternalBasicSubscription(user.business.id, {
        source: "email_signup",
        tx,
      });
    }

    return user;
  });

  // Managers must verify email for password sign-ups — await so delivery runs before HTTP response (serverless-safe).
  await sendVerificationEmailBestEffort(created.id, created.email, {
    explicitLocale: input.locale,
    platform: opts?.platform,
  });

  return pendingVerificationResultForUserRecord(created);
}

export async function registerEmployee(
  input: {
    email: string;
    password: string;
    name: string;
    inviteCode: string;
    locale?: string | null;
  },
  opts?: { acceptLanguage?: string | null; platform?: AuthLinkPlatform }
): Promise<RegisterPendingResult> {
  const email = normalizeLoginEmail(input.email);
  const pwCheck = validatePassword(input.password);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.message ?? "Password is required");
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new Error(AUTH_REGISTER_GENERIC_MESSAGE);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const preferredLocale = input.locale?.trim()
    ? resolveUserPreferredLocale(input.locale)
    : null;

  const created = await registerEmployeeWithInvite({
    inviteCode: input.inviteCode,
    email,
    name: input.name,
    passwordHash,
    emailVerified: false,
    preferredLocale,
    activationStatus: "pending_verification",
    registrationChannel: "password",
  });

  await sendVerificationEmailBestEffort(created.id, created.email, {
    explicitLocale: input.locale,
    platform: opts?.platform,
  });

  const withEmployee = await prisma.user.findUnique({
    where: { id: created.id },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          verificationStatus: true,
          onboardingVerificationStatus: true,
          kycVerificationStatus: true,
        },
      },
      employee: { select: { id: true, name: true, avatar: true, businessId: true } },
    },
  });
  if (!withEmployee) {
    throw new Error("Registration failed");
  }

  return pendingVerificationResultForUserRecord(withEmployee);
}

export async function validateLoginCredentials(input: LoginInput): Promise<UserForAuthResult> {
  const email = normalizeLoginEmail(input.email);
  let user = await prisma.user.findUnique({
    where: { email },
    include: {
      business: businessIncludeForAuth,
      employee: { select: { id: true, name: true, avatar: true, businessId: true } },
    },
  });

  if (!user || user.isActive !== true) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }

  // Super Admin without platform flag: same message as bad credentials (no account-type oracle).
  if (user.role === "SUPER_ADMIN" && !user.isPlatformAdmin) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }

  // OAuth-only / missing password: same message as wrong password (no method disclosure).
  if (!user.passwordHash) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }

  if (user.emailVerified !== true) {
    const bypassed = await applyEmailVerificationBypassIfEligible(user);
    if (!bypassed) {
      throw new EmailNotVerifiedLoginError();
    }
    user = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        business: businessIncludeForAuth,
        employee: { select: { id: true, name: true, avatar: true, businessId: true } },
      },
    });
    if (!user || user.emailVerified !== true) {
      throw new EmailNotVerifiedLoginError();
    }
  }

  return user;
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await validateLoginCredentials(input);
  return authResultForUserRecord(user);
}

/**
 * Re-sends the email verification link after the user proves they know the password.
 * Does not reveal whether the email exists (same errors as a failed password check when appropriate).
 */
export async function resendVerificationEmail(input: {
  email: string;
  password: string;
  explicitLocale?: string | null;
  acceptLanguage?: string | null;
  platform?: AuthLinkPlatform;
}): Promise<void> {
  const email = normalizeLoginEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, emailVerified: true, isActive: true },
  });
  if (!user || user.isActive !== true || !user.passwordHash) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    throw new Error(AUTH_INVALID_CREDENTIALS_MESSAGE);
  }
  // Already verified: same silent success as a send (no verification-state oracle).
  if (user.emailVerified === true) {
    return;
  }
  await sendVerificationEmailBestEffort(user.id, email, {
    explicitLocale: input.explicitLocale,
    acceptLanguage: input.acceptLanguage,
    platform: input.platform,
  });
}

/**
 * Re-sends verification for the currently authenticated user (JWT), without requiring password again.
 * Used from the check-email screen right after sign-up while the session is still valid.
 */
export async function resendVerificationEmailForSessionUser(
  userId: string,
  opts?: {
    explicitLocale?: string | null;
    acceptLanguage?: string | null;
    platform?: AuthLinkPlatform;
  }
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, isActive: true },
  });
  if (!user || user.isActive !== true) {
    throw new Error("Authentication required");
  }
  if (user.emailVerified === true) {
    return;
  }
  const email = normalizeLoginEmail(user.email);
  await sendVerificationEmailBestEffort(user.id, email, {
    explicitLocale: opts?.explicitLocale,
    acceptLanguage: opts?.acceptLanguage,
    platform: opts?.platform,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    throw new Error("Current password is incorrect");
  }

  const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new Error("Current password is incorrect");
  }

  const pwCheck = validatePassword(newPassword);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.message ?? "Password is required");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

export async function activateEmployee(token: string, password: string): Promise<AuthResult> {
  const plain = String(token ?? "").trim();
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.message ?? "Password is required");
  }

  const validated = await employeeActivationService.validateActivationToken(plain);
  if (!validated) {
    throw new Error("Invalid or expired token");
  }

  const email = normalizeLoginEmail(validated.email);
  if (!email) {
    throw new Error("Invalid or expired token");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: validated.employeeId },
    include: {
      user: { select: { id: true, email: true, passwordHash: true } },
      business: { select: { verificationStatus: true } },
    },
  });
  if (!employee || employee.activationStatus !== "pending_activation") {
    throw new Error("Invalid or expired token");
  }

  const linkedUser = employee.user;
  if (linkedUser) {
    if (normalizeLoginEmail(linkedUser.email) !== email) {
      throw new Error("Invalid or expired token");
    }
    if (linkedUser.passwordHash != null) {
      throw new Error("Invalid or expired token");
    }
  } else {
    // Legacy rows without `user_id` — create the auth user on first successful activation.
    const conflicting = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (conflicting) {
      throw new Error("Invalid or expired token");
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const slug =
    employee.business.verificationStatus === "verified"
      ? await (async () => {
          const baseSlug = generateSlug(employee.name.trim());
          return ensureUniqueSlug(baseSlug, async (s) => {
            const hit = await prisma.employee.findUnique({ where: { slug: s } });
            return !!hit;
          });
        })()
      : employee.slug;

  let resolvedUserId!: string;

  // Dashboard activation (password setup only): same transaction, user row first — password stored,
  // email treated as confirmed for login, then employee becomes active. No email-verification tokens.
  await prisma.$transaction(async (tx) => {
    if (linkedUser && employee.userId) {
      resolvedUserId = employee.userId;
      await tx.user.update({
        where: { id: employee.userId },
        data: { passwordHash, emailVerified: true },
      });
      await tx.employee.update({
        where: { id: employee.id },
        data: { activationStatus: "active", slug },
      });
    } else {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: "EMPLOYEE",
          isPlatformAdmin: false,
          emailVerified: true,
        },
      });
      resolvedUserId = created.id;
      await tx.employee.update({
        where: { id: employee.id },
        data: {
          userId: created.id,
          activationStatus: "active",
          slug,
        },
      });
    }
  });

  await employeeActivationService.consumeActivationToken(employee.id);

  const businessName =
    (
      await prisma.business.findUnique({
        where: { id: employee.businessId },
        select: { name: true },
      })
    )?.name?.trim() || "CareTip";

  void import("./push/notification.triggers.js").then(({ onEmployeeAccountActivated }) => {
    onEmployeeAccountActivated(resolvedUserId, businessName);
  });

  void import("./activity/staffActivity.helpers.js").then(({ scheduleEmployeeJoinedProjection }) => {
    scheduleEmployeeJoinedProjection({
      businessId: employee.businessId,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeEmail: email,
      channel: "activate",
    });
  });

  const refreshed = await loadUserForAuthResult(resolvedUserId);
  return authResultForUserRecord(refreshed);
}
