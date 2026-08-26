import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import {
  monitorInviteCreated,
  monitorInviteRedemption,
  monitorInviteValidation,
} from "./inviteAbuseMonitor.service.js";
import { onEmployeeInviteRedeemed } from "./push/notification.triggers.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { AUTH_REGISTER_GENERIC_MESSAGE } from "./authDisclosureMessages.js";

/** Readable charset — excludes 0/O, 1/I/L to reduce transcription errors. */
const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const INVITE_CODE_LENGTH = 8;
const INVITE_TTL_DAYS = 7;
const MAX_CODE_GENERATION_ATTEMPTS = 32;

export type ActiveInviteSnapshot = {
  inviteId: string;
  inviteCode: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  businessLocation: string | null;
  expiresAt: Date;
  verificationStatus: string;
};

export function generateSecureInviteCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i]! % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

function normalizeInviteCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

async function generateUniqueInviteCode(
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateSecureInviteCode();
    const [businessHit, inviteHit] = await Promise.all([
      tx.business.findUnique({ where: { inviteCode: candidate }, select: { id: true } }),
      tx.employeeInvite.findUnique({ where: { inviteCode: candidate }, select: { id: true } }),
    ]);
    if (!businessHit && !inviteHit) return candidate;
  }
  throw new Error("Could not generate a unique invite code. Please try again.");
}

export async function createEmployeeInviteForManager(userId: string): Promise<{
  inviteCode: string;
  expiresAt: string;
  inviteId: string;
}> {
  const business = await prisma.business.findUnique({
    where: { userId },
    select: { id: true, userId: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

  const result = await prisma.$transaction(async (tx) => {
    await tx.employeeInvite.updateMany({
      where: { businessId: business.id, status: "active" },
      data: { status: "revoked" },
    });

    const inviteCode = await generateUniqueInviteCode(tx);

    const invite = await tx.employeeInvite.create({
      data: {
        inviteCode,
        businessId: business.id,
        createdByUserId: userId,
        expiresAt,
        status: "active",
      },
    });

    await tx.business.update({
      where: { id: business.id },
      data: {
        inviteCode,
        inviteCodeExpiresAt: expiresAt,
      },
    });

    return invite;
  });

  void writeAuditLog({
    userId,
    action: "employee_invite_created",
    metadata: JSON.stringify({
      inviteId: result.id,
      businessId: business.id,
      inviteCode: result.inviteCode,
      expiresAt: expiresAt.toISOString(),
    }),
  });

  monitorInviteCreated({
    businessId: business.id,
    createdByUserId: userId,
    inviteId: result.id,
  });

  void import("./activity/staffActivity.helpers.js").then(
    ({ scheduleEmployeeInvitedCodeProjection }) => {
      scheduleEmployeeInvitedCodeProjection({
        businessId: business.id,
        inviteId: result.id,
        inviteCode: result.inviteCode,
        expiresAt: expiresAt,
        actorUserId: userId,
      });
    },
  );

  return {
    inviteId: result.id,
    inviteCode: result.inviteCode,
    expiresAt: expiresAt.toISOString(),
  };
}

async function loadActiveInviteByCode(
  code: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<ActiveInviteSnapshot | null> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;

  const now = new Date();

  const invite = await tx.employeeInvite.findFirst({
    where: {
      inviteCode: normalized,
      status: "active",
      expiresAt: { gt: now },
    },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          location: true,
          verificationStatus: true,
          inviteCode: true,
          inviteCodeExpiresAt: true,
        },
      },
    },
  });

  if (invite?.business) {
    return {
      inviteId: invite.id,
      inviteCode: invite.inviteCode,
      businessId: invite.business.id,
      businessName: invite.business.name,
      businessSlug: invite.business.slug,
      businessLocation: invite.business.location,
      expiresAt: invite.expiresAt,
      verificationStatus: invite.business.verificationStatus,
    };
  }

  // Legacy fallback until all rows are backfilled.
  const legacy = await tx.business.findFirst({
    where: {
      inviteCode: normalized,
      inviteCodeExpiresAt: { gt: now },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      location: true,
      verificationStatus: true,
      inviteCode: true,
      inviteCodeExpiresAt: true,
      userId: true,
    },
  });
  if (!legacy?.inviteCode || !legacy.inviteCodeExpiresAt) return null;

  return {
    inviteId: `legacy:${legacy.id}`,
    inviteCode: legacy.inviteCode,
    businessId: legacy.id,
    businessName: legacy.name,
    businessSlug: legacy.slug,
    businessLocation: legacy.location,
    expiresAt: legacy.inviteCodeExpiresAt,
    verificationStatus: legacy.verificationStatus,
  };
}

export async function validateEmployeeInviteCode(
  code: string,
  opts?: { clientKey?: string; ipKey?: string },
): Promise<{
  ok: boolean;
  businessName?: string;
  businessId?: string;
  businessSlug?: string;
  businessLocation?: string | null;
}> {
  const snapshot = await loadActiveInviteByCode(code);
  if (!snapshot) {
    monitorInviteValidation({
      ok: false,
      code: normalizeInviteCode(code),
      clientKey: opts?.clientKey ?? "unknown",
      ipKey: opts?.ipKey,
    });
    return { ok: false };
  }

  monitorInviteValidation({
    ok: true,
    code: snapshot.inviteCode,
    clientKey: opts?.clientKey ?? "unknown",
    ipKey: opts?.ipKey,
    businessId: snapshot.businessId,
  });

  return {
    ok: true,
    businessName: snapshot.businessName,
    businessId: snapshot.businessId,
    businessSlug: snapshot.businessSlug,
    businessLocation: snapshot.businessLocation,
  };
}

export type InviteRedemptionContext = {
  inviteId: string;
  inviteCode: string;
  businessId: string;
  businessName: string;
  verificationStatus: string;
};

/**
 * Locks an active invite inside a transaction before user/employee creation.
 * Multi-use: each successful registration creates a redemption row.
 */
export async function lockActiveInviteForRedemption(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<InviteRedemptionContext> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) {
    throw new Error("Invalid or expired invite code");
  }

  const now = new Date();
  const invite = await tx.employeeInvite.findFirst({
    where: {
      inviteCode: normalized,
      status: "active",
      expiresAt: { gt: now },
    },
    include: {
      business: { select: { id: true, name: true, verificationStatus: true } },
    },
  });

  if (invite) {
    return {
      inviteId: invite.id,
      inviteCode: invite.inviteCode,
      businessId: invite.business.id,
      businessName: invite.business.name,
      verificationStatus: invite.business.verificationStatus,
    };
  }

  const legacy = await tx.business.findFirst({
    where: {
      inviteCode: normalized,
      inviteCodeExpiresAt: { gt: now },
    },
    select: { id: true, name: true, verificationStatus: true, inviteCode: true },
  });
  if (!legacy?.inviteCode) {
    throw new Error("Invalid or expired invite code");
  }

  return {
    inviteId: `legacy:${legacy.id}`,
    inviteCode: legacy.inviteCode,
    businessId: legacy.id,
    businessName: legacy.name,
    verificationStatus: legacy.verificationStatus,
  };
}

export async function recordInviteRedemption(input: {
  tx: Prisma.TransactionClient;
  invite: InviteRedemptionContext;
  redeemedByUserId: string;
  employeeId: string;
  inviteeEmail: string;
  inviteeName: string;
  createdByUserIdForAudit: string;
  registrationChannel: "password" | "oauth";
}): Promise<void> {
  if (input.invite.inviteId.startsWith("legacy:")) {
    void writeAuditLog({
      userId: input.createdByUserIdForAudit,
      action: "employee_invite_redeemed",
      metadata: JSON.stringify({
        inviteId: input.invite.inviteId,
        businessId: input.invite.businessId,
        redeemedByUserId: input.redeemedByUserId,
        employeeId: input.employeeId,
        inviteeEmail: input.inviteeEmail,
        registrationChannel: input.registrationChannel,
        legacy: true,
      }),
    });
    return;
  }

  await input.tx.employeeInviteRedemption.create({
    data: {
      inviteId: input.invite.inviteId,
      redeemedByUserId: input.redeemedByUserId,
      employeeId: input.employeeId,
      inviteeEmail: input.inviteeEmail,
      inviteeName: input.inviteeName,
    },
  });

  void writeAuditLog({
    userId: input.redeemedByUserId,
    action: "employee_invite_redeemed",
    metadata: JSON.stringify({
      inviteId: input.invite.inviteId,
      businessId: input.invite.businessId,
      redeemedByUserId: input.redeemedByUserId,
      employeeId: input.employeeId,
      inviteeEmail: input.inviteeEmail,
      registrationChannel: input.registrationChannel,
    }),
  });

  void writeAuditLog({
    userId: input.createdByUserIdForAudit,
    action: "employee_invite_redemption_observed",
    metadata: JSON.stringify({
      inviteId: input.invite.inviteId,
      businessId: input.invite.businessId,
      redeemedByUserId: input.redeemedByUserId,
      employeeId: input.employeeId,
    }),
  });
}

export function afterInviteRedemptionSideEffects(input: {
  invite: InviteRedemptionContext;
  redeemedByUserId: string;
  employeeId: string;
  inviteeEmail: string;
  inviteeName: string;
}): void {
  if (input.invite.inviteId.startsWith("legacy:")) return;

  monitorInviteRedemption({
    inviteId: input.invite.inviteId,
    inviteCode: input.invite.inviteCode,
    businessId: input.invite.businessId,
    redeemedByUserId: input.redeemedByUserId,
  });

  onEmployeeInviteRedeemed({
    businessId: input.invite.businessId,
    employeeName: input.inviteeName,
    employeeEmail: input.inviteeEmail,
    inviteCode: input.invite.inviteCode,
  });
}

export async function listInviteHistoryForBusiness(businessId: string, take = 20) {
  const invites = await prisma.employeeInvite.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, take)),
    select: {
      id: true,
      inviteCode: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      createdBy: { select: { id: true, email: true } },
      redemptions: {
        orderBy: { redeemedAt: "desc" },
        select: {
          id: true,
          redeemedAt: true,
          inviteeEmail: true,
          inviteeName: true,
          redeemedBy: { select: { id: true, email: true } },
          employee: { select: { id: true, name: true, activationStatus: true } },
        },
      },
    },
  });

  return invites.map((inv) => ({
    id: inv.id,
    inviteCode: inv.inviteCode,
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
    createdBy: inv.createdBy,
    redemptionCount: inv.redemptions.length,
    redemptions: inv.redemptions.map((r) => ({
      id: r.id,
      redeemedAt: r.redeemedAt.toISOString(),
      inviteeEmail: r.inviteeEmail,
      inviteeName: r.inviteeName,
      redeemedBy: r.redeemedBy,
      employee: r.employee,
    })),
  }));
}

export { normalizeInviteCode, INVITE_CODE_LENGTH };

export type RegisterWithInviteInput = {
  inviteCode: string;
  email: string;
  name: string;
  passwordHash: string | null;
  emailVerified: boolean;
  preferredLocale: string | null;
  oauthProvider?: string | null;
  oauthSubject?: string | null;
  oauthDisplayName?: string | null;
  activationStatus: "pending_verification" | "active";
  registrationChannel: "password" | "oauth";
};

/**
 * Atomic invite validation + user/employee creation + redemption record.
 */
export async function registerEmployeeWithInvite(input: RegisterWithInviteInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  const invitePreview = await loadActiveInviteByCode(input.inviteCode);
  let employeeSlug: string | null = null;
  if (invitePreview?.verificationStatus === "verified") {
    const baseSlug = generateSlug(name);
    employeeSlug = await ensureUniqueSlug(baseSlug, async (s) => {
      const hit = await prisma.employee.findUnique({ where: { slug: s } });
      return !!hit;
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new Error(AUTH_REGISTER_GENERIC_MESSAGE);
    }

    const invite = await lockActiveInviteForRedemption(tx, input.inviteCode);
    const business = await tx.business.findUnique({
      where: { id: invite.businessId },
      select: { userId: true },
    });
    if (!business) {
      throw new Error("Invalid or expired invite code");
    }

    const created = await tx.user.create({
      data: {
        email,
        passwordHash: input.passwordHash,
        role: "EMPLOYEE",
        isPlatformAdmin: false,
        emailVerified: input.emailVerified,
        preferredLocale: input.preferredLocale,
        ...(input.oauthProvider && input.oauthSubject
          ? {
              oauthAccounts: {
                create: {
                  provider: input.oauthProvider,
                  subject: input.oauthSubject,
                  emailAtLink: email,
                  displayName: input.oauthDisplayName ?? null,
                },
              },
            }
          : {}),
        employee: {
          create: {
            name,
            jobTitle: "Staff",
            businessId: invite.businessId,
            slug: employeeSlug,
            activationStatus: input.activationStatus,
          },
        },
      },
      include: {
        employee: { select: { id: true, name: true, avatar: true, businessId: true } },
      },
    });

    if (!created.employee) {
      throw new Error("Could not create employee profile");
    }

    await recordInviteRedemption({
      tx,
      invite,
      redeemedByUserId: created.id,
      employeeId: created.employee.id,
      inviteeEmail: email,
      inviteeName: name,
      createdByUserIdForAudit: business.userId,
      registrationChannel: input.registrationChannel,
    });

    return { created, invite };
  });

  afterInviteRedemptionSideEffects({
    invite: result.invite,
    redeemedByUserId: result.created.id,
    employeeId: result.created.employee!.id,
    inviteeEmail: email,
    inviteeName: name,
  });

  if (input.activationStatus === "active" && result.created.employee) {
    void import("./activity/staffActivity.helpers.js").then(
      ({ scheduleEmployeeJoinedProjection }) => {
        scheduleEmployeeJoinedProjection({
          businessId: result.created.employee!.businessId,
          employeeId: result.created.employee!.id,
          employeeName: result.created.employee!.name,
          employeeEmail: email,
          channel: input.registrationChannel === "oauth" ? "oauth" : "email_verify",
        });
      },
    );
  }

  return result.created;
}
