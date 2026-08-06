import { prisma } from "../prisma.js";
import { EmailNotVerifiedLoginError } from "../utils/httpErrors.js";
import {
  authResultForUserRecord,
  normalizeLoginEmail,
  type AuthIntendedRole,
  type AuthResult,
} from "./auth.service.js";
import { scheduleWelcomeEmailBestEffort } from "./emailVerification.service.js";
import { applyEmailVerificationBypassIfEligible } from "./emailVerificationBypass.service.js";
import { isSubscriptionBasicDefaultEnabled } from "../config/featureFlags.js";
import { provisionInternalBasicSubscription } from "./subscription.service.js";
import { generateUniqueBusinessSlugForName } from "./business.service.js";
import { registerEmployeeWithInvite } from "./employeeInvite.service.js";
import { resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import {
  isOAuthProviderId,
  verifyOAuthIdentity,
  OAuthTokenVerificationError,
  OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
  type OAuthProviderId,
  type VerifiedIdentity,
} from "./oauth/verifyIdentity.js";

/** @deprecated Prefer OAUTH_ACCOUNT_NOT_REGISTERED_* — kept for Google client aliases. */
export const GOOGLE_ACCOUNT_NOT_REGISTERED_MESSAGE =
  "This Google account is not registered with CareTip yet. Please create an account first.";
export const GOOGLE_ACCOUNT_NOT_REGISTERED_CODE = "GOOGLE_ACCOUNT_NOT_REGISTERED" as const;
export const GOOGLE_TOKEN_VERIFICATION_FAILED_CODE = OAUTH_TOKEN_VERIFICATION_FAILED_CODE;

export const OAUTH_ACCOUNT_NOT_REGISTERED_CODE = "OAUTH_ACCOUNT_NOT_REGISTERED" as const;
export const OAUTH_ACCOUNT_NOT_REGISTERED_MESSAGE =
  "This social account is not registered with CareTip yet. Please create an account first.";

export const OAUTH_LINKING_REQUIRED_CODE = "OAUTH_LINKING_REQUIRED" as const;
export const OAUTH_LINKING_REQUIRED_MESSAGE =
  "An account with this email already exists. Sign in with your existing method, then link this provider from Settings → Security → Linked Accounts.";

export const OAUTH_EMAIL_REQUIRED_CODE = "OAUTH_EMAIL_REQUIRED" as const;
export const OAUTH_EMAIL_REQUIRED_MESSAGE =
  "Facebook did not provide an email address. Enable email permission in Facebook Login, or use another sign-in method.";

export const OAUTH_EMAIL_ALREADY_REGISTERED_MESSAGE = "Email already registered. Sign in instead.";

export { OAuthTokenVerificationError, OAUTH_TOKEN_VERIFICATION_FAILED_CODE };
/** @deprecated alias */
export const GoogleTokenVerificationError = OAuthTokenVerificationError;

type OAuthBody = {
  idToken: string;
  intendedRole?: AuthIntendedRole;
  isLogin: boolean;
  name?: string;
  businessName?: string;
  inviteCode?: string;
  businessType?: string;
  location?: string;
  locale?: string;
};

const businessIncludeForOAuth = {
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

const userIncludeForOAuth = {
  business: businessIncludeForOAuth,
  employee: { select: { id: true, name: true, avatar: true, businessId: true } },
  oauthAccounts: { select: { provider: true, subject: true } },
} as const;

export class OAuthLinkingRequiredError extends Error {
  readonly code = OAUTH_LINKING_REQUIRED_CODE;
  readonly email: string;
  readonly provider: OAuthProviderId;

  constructor(email: string, provider: OAuthProviderId) {
    super(OAUTH_LINKING_REQUIRED_MESSAGE);
    this.name = "OAuthLinkingRequiredError";
    this.email = email;
    this.provider = provider;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthEmailRequiredError extends Error {
  readonly code = OAUTH_EMAIL_REQUIRED_CODE;

  constructor(message = OAUTH_EMAIL_REQUIRED_MESSAGE) {
    super(message);
    this.name = "OAuthEmailRequiredError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function loadOAuthSessionUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userIncludeForOAuth,
  });
  if (!user) {
    throw new Error("Invalid email or password");
  }
  return user;
}

async function findUserByOAuthSubject(provider: OAuthProviderId, subject: string) {
  const link = await prisma.oAuthAccount.findUnique({
    where: { provider_subject: { provider, subject } },
    select: { userId: true },
  });
  if (!link) return null;
  return loadOAuthSessionUser(link.userId);
}

async function createOAuthAccountRow(input: {
  userId: string;
  identity: VerifiedIdentity;
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
}) {
  const db = input.tx ?? prisma;
  return db.oAuthAccount.create({
    data: {
      userId: input.userId,
      provider: input.identity.provider,
      subject: input.identity.subject,
      emailAtLink: input.identity.email,
      displayName: input.identity.displayName,
    },
  });
}

function providerLabel(provider: OAuthProviderId): string {
  return provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Facebook";
}

export async function authenticateWithOAuth(
  providerRaw: string,
  body: OAuthBody,
  opts?: { acceptLanguage?: string | null },
): Promise<AuthResult> {
  if (!isOAuthProviderId(providerRaw)) {
    throw new Error("Unsupported OAuth provider. Use google, apple, or facebook.");
  }
  const provider = providerRaw;

  const idToken = body.idToken?.trim();
  if (!idToken) {
    throw new Error("idToken is required");
  }

  const verified = await verifyOAuthIdentity(provider, idToken);

  // Facebook signup/login account creation requires email; login by subject alone is OK if already linked.
  if (provider === "facebook" && !verified.email && body.isLogin === false) {
    throw new OAuthEmailRequiredError();
  }
  if (provider === "google" && !verified.emailVerified) {
    throw new OAuthTokenVerificationError("google", "Google email is not verified");
  }
  if (provider === "google" && !verified.email) {
    throw new OAuthTokenVerificationError("google", "Google did not provide an email address");
  }

  const preferredLocale = body.locale?.trim()
    ? resolveUserPreferredLocale(body.locale)
    : null;

  if (body.isLogin) {
    let sessionUser = await findUserByOAuthSubject(provider, verified.subject);

    if (!sessionUser) {
      // No linked OAuthAccount — never auto-link by email.
      if (verified.email) {
        const emailOwner = await prisma.user.findUnique({
          where: { email: normalizeLoginEmail(verified.email) },
          select: { id: true, role: true },
        });
        if (emailOwner) {
          if (emailOwner.role === "SUPER_ADMIN") {
            throw new Error("Use the Platform Admin sign-in for this account.");
          }
          throw new OAuthLinkingRequiredError(normalizeLoginEmail(verified.email), provider);
        }
      }
      throw new Error(
        provider === "google" ? GOOGLE_ACCOUNT_NOT_REGISTERED_MESSAGE : OAUTH_ACCOUNT_NOT_REGISTERED_MESSAGE,
      );
    }

    if (sessionUser.isActive !== true) {
      throw new Error("This account has been disabled.");
    }
    if (sessionUser.role === "SUPER_ADMIN") {
      throw new Error("Use the Platform Admin sign-in for this account.");
    }

    // Persist Apple display name only when first provided (rare after first authorize).
    if (verified.displayName) {
      const link = sessionUser.oauthAccounts.find((a) => a.provider === provider);
      if (link) {
        await prisma.oAuthAccount.updateMany({
          where: {
            userId: sessionUser.id,
            provider,
            subject: verified.subject,
            displayName: null,
          },
          data: { displayName: verified.displayName },
        });
      }
    }

    if (sessionUser.emailVerified !== true) {
      const bypassed = await applyEmailVerificationBypassIfEligible(sessionUser);
      if (!bypassed) {
        throw new EmailNotVerifiedLoginError();
      }
      sessionUser = await loadOAuthSessionUser(sessionUser.id);
      if (sessionUser.emailVerified !== true) {
        throw new EmailNotVerifiedLoginError();
      }
    }

    const session = authResultForUserRecord(sessionUser);
    console.info(
      "[oauth] SESSION_CREATED",
      JSON.stringify({
        userId: session.user.id,
        role: session.user.role,
        provider,
        channel: "login",
      }),
    );
    return session;
  }

  /** Sign up — requires email for all providers (Apple first auth usually includes it). */
  if (!verified.email) {
    if (provider === "facebook") {
      throw new OAuthEmailRequiredError();
    }
    throw new OAuthTokenVerificationError(
      provider,
      `${providerLabel(provider)} did not provide an email address required for signup.`,
    );
  }

  const email = normalizeLoginEmail(verified.email);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new OAuthLinkingRequiredError(email, provider);
  }

  const subjectTaken = await prisma.oAuthAccount.findUnique({
    where: { provider_subject: { provider, subject: verified.subject } },
    select: { id: true },
  });
  if (subjectTaken) {
    throw new Error(OAUTH_ACCOUNT_NOT_REGISTERED_MESSAGE);
  }

  const intendedRole = body.intendedRole;
  if (intendedRole === "SUPER_ADMIN") {
    throw new Error("Platform admin sign-in is not available with social login.");
  }

  const inviteCode = body.inviteCode?.trim();
  const displayName =
    body.name?.trim() || verified.displayName || email.split("@")[0] || "User";

  // Identity principle: invitation authorizes employment; OAuth never creates employment alone.
  if (inviteCode) {
    if (intendedRole === "MANAGER") {
      throw new Error(
        "Invite codes complete employee invitations only. Create a business account without an invite code.",
      );
    }
    await registerEmployeeWithInvite({
      inviteCode,
      email,
      name: displayName,
      passwordHash: null,
      emailVerified: true,
      preferredLocale,
      oauthProvider: provider,
      oauthSubject: verified.subject,
      oauthDisplayName: verified.displayName,
      activationStatus: "active",
      registrationChannel: "oauth",
    });

    const full = await prisma.user.findUnique({
      where: { email },
      include: userIncludeForOAuth,
    });
    if (!full) throw new Error("Registration failed");

    const session = authResultForUserRecord(full);
    console.info(
      "[oauth] SESSION_CREATED",
      JSON.stringify({
        userId: session.user.id,
        role: session.user.role,
        provider,
        channel: "employee_invite",
      }),
    );
    return session;
  }

  if (intendedRole === "MANAGER") {
    const businessName = body.businessName?.trim();
    const businessType = body.businessType?.trim();
    const location = body.location?.trim();
    const bizName = businessName || `${displayName}'s venue`;
    const slug = await generateUniqueBusinessSlugForName(bizName);

    const created = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash: null,
            role: "MANAGER",
            isPlatformAdmin: false,
            emailVerified: true,
            preferredLocale,
            business: {
              create: {
                name: bizName,
                slug,
                businessType: businessType || null,
                location: location || null,
              },
            },
            oauthAccounts: {
              create: {
                provider,
                subject: verified.subject,
                emailAtLink: email,
                displayName: verified.displayName,
              },
            },
          },
          include: userIncludeForOAuth,
        });

        console.info(
          "[oauth] USER_CREATED",
          JSON.stringify({ userId: user.id, email: user.email, provider }),
        );

        const businessId = user.business?.id;
        if (!businessId) {
          throw new Error("Business creation failed during OAuth signup.");
        }

        if (isSubscriptionBasicDefaultEnabled()) {
          const provision = await provisionInternalBasicSubscription(businessId, {
            source: "oauth_signup",
            tx,
          });
          console.info(
            "[oauth] BASIC_SUBSCRIPTION_CREATED",
            JSON.stringify({
              businessId,
              subscriptionId: provision.subscriptionId,
              created: provision.created,
              skipped: provision.skipped,
            }),
          );
        }

        return user;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    scheduleWelcomeEmailBestEffort({
      userId: created.id,
      email: created.email,
      explicitLocale: body.locale ?? null,
      storedLocale: created.preferredLocale,
      acceptLanguage: opts?.acceptLanguage ?? null,
      logContext: "oauth_manager_signup",
    });

    const session = authResultForUserRecord(created);
    console.info(
      "[oauth] SESSION_CREATED",
      JSON.stringify({
        userId: session.user.id,
        role: session.user.role,
        provider,
        businessId: session.user.businessId ?? null,
      }),
    );
    return session;
  }

  if (intendedRole === "EMPLOYEE") {
    throw new Error(
      "Employees join via invitation. Provide a valid invite code to complete activation.",
    );
  }

  throw new Error("intendedRole is required and must be 'MANAGER', 'EMPLOYEE', or 'SUPER_ADMIN'");
}

/** Authenticated Settings: link a provider to the current user. */
export async function linkOAuthProviderForUser(
  userId: string,
  providerRaw: string,
  idToken: string,
): Promise<{ provider: OAuthProviderId; linked: true }> {
  if (!isOAuthProviderId(providerRaw)) {
    throw new Error("Unsupported OAuth provider. Use google, apple, or facebook.");
  }
  const provider = providerRaw;
  const token = idToken?.trim();
  if (!token) throw new Error("idToken is required");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, email: true },
  });
  if (!user || user.isActive !== true) {
    throw new Error("Authentication required");
  }
  if (user.role === "SUPER_ADMIN") {
    throw new Error("Platform admin accounts cannot link social providers.");
  }

  const verified = await verifyOAuthIdentity(provider, token);
  if (provider === "facebook" && !verified.email) {
    // Linking FB without email is allowed if we already know the CareTip email — still store subject.
  }

  const existingSubject = await prisma.oAuthAccount.findUnique({
    where: { provider_subject: { provider, subject: verified.subject } },
  });
  if (existingSubject && existingSubject.userId !== userId) {
    throw new Error("This social account is already linked to another CareTip user.");
  }
  if (existingSubject && existingSubject.userId === userId) {
    return { provider, linked: true };
  }

  const existingProvider = await prisma.oAuthAccount.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (existingProvider) {
    throw new Error(`This account already has ${providerLabel(provider)} linked.`);
  }

  await createOAuthAccountRow({ userId, identity: verified });
  return { provider, linked: true };
}

/** Authenticated Settings: unlink a provider without orphaning the account. */
export async function unlinkOAuthProviderForUser(
  userId: string,
  providerRaw: string,
): Promise<{ provider: OAuthProviderId; unlinked: true }> {
  if (!isOAuthProviderId(providerRaw)) {
    throw new Error("Unsupported OAuth provider. Use google, apple, or facebook.");
  }
  const provider = providerRaw;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      passwordHash: true,
      oauthAccounts: { select: { id: true, provider: true } },
    },
  });
  if (!user) throw new Error("Authentication required");

  const link = user.oauthAccounts.find((a) => a.provider === provider);
  if (!link) {
    throw new Error(`${providerLabel(provider)} is not linked to this account.`);
  }

  const hasPassword = Boolean(user.passwordHash);
  const otherLinks = user.oauthAccounts.filter((a) => a.provider !== provider).length;
  if (!hasPassword && otherLinks === 0) {
    throw new Error(
      "Cannot unlink your only sign-in method. Add a password or another provider first.",
    );
  }

  await prisma.oAuthAccount.delete({ where: { id: link.id } });
  return { provider, unlinked: true };
}

export async function listLinkedOAuthProvidersForUser(userId: string): Promise<
  Array<{ provider: OAuthProviderId; emailAtLink: string | null; linkedAt: string }>
> {
  const rows = await prisma.oAuthAccount.findMany({
    where: { userId },
    select: { provider: true, emailAtLink: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((r): r is typeof r & { provider: OAuthProviderId } => isOAuthProviderId(r.provider))
    .map((r) => ({
      provider: r.provider,
      emailAtLink: r.emailAtLink,
      linkedAt: r.createdAt.toISOString(),
    }));
}

export async function userHasPasswordOrOAuth(userId: string): Promise<{
  hasPassword: boolean;
  providers: OAuthProviderId[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      oauthAccounts: { select: { provider: true } },
    },
  });
  return {
    hasPassword: Boolean(user?.passwordHash),
    providers: (user?.oauthAccounts ?? [])
      .map((a) => a.provider)
      .filter(isOAuthProviderId),
  };
}
