import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { kycStatusToLegacyMirror } from "../lib/verificationWorkflow.js";
import { emitBusinessDataChanged } from "../socket/socketEmitters.js";
import { invalidateBusinessStatsCache } from "./business.service.js";

function notifyBusinessRosterChanged(businessId: string, reason: string): void {
  emitBusinessDataChanged(businessId, reason);
  invalidateBusinessStatsCache(businessId);
}
import * as employeeActivationService from "./employeeActivation.service.js";
import {
  buildEmployeeActivationUrl,
  sendEmployeeActivationEmail,
} from "./employeeActivationEmail.service.js";
import { resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { getSubscriptionTierForBusinessId, resolveSubscriptionEntitlements } from "./subscriptionEntitlement.service.js";
import { isPresetStaffRole } from "../config/staffRolePresets.js";

import {
  GO_LIVE_REQUIRED_MESSAGE,
  hasBusinessVerificationCapability,
} from "../config/businessVerificationCapabilities.js";

const VERIFICATION_REQUIRED_MSG = GO_LIVE_REQUIRED_MESSAGE;

const CUSTOM_JOB_TITLE_PRO_REQUIRED =
  "Custom job titles require CareTip Pro. Choose a standard role or upgrade.";

/**
 * Basic: standard titles only (existing custom title on the same employee may be kept).
 * Pro+: any non-empty title.
 */
export async function assertJobTitleAllowedForBusiness(
  businessId: string,
  jobTitle: string,
  previousJobTitle?: string | null,
): Promise<void> {
  const trimmed = jobTitle.trim();
  if (!trimmed) {
    throw new Error("Name, email, and role are required");
  }
  if (isPresetStaffRole(trimmed)) return;

  const previous = previousJobTitle?.trim() ?? "";
  if (previous && previous.toLowerCase() === trimmed.toLowerCase()) {
    return;
  }

  const entitlements = await resolveSubscriptionEntitlements(businessId);
  if (!entitlements.capabilities.includes("customJobTitles")) {
    throw new Error(CUSTOM_JOB_TITLE_PRO_REQUIRED);
  }
}

/** Validates location/tables belong to the business; infers location from tables when unset. */
export async function resolveStaffAssignments(
  businessId: string,
  locationId: string | null | undefined,
  tableIds: string[]
): Promise<{ locationId: string | null; tableIds: string[] }> {
  const uniqueTableIds = [...new Set(tableIds.filter(Boolean))];
  let locId: string | null =
    locationId === undefined || locationId === null
      ? null
      : String(locationId).trim() || null;
  if (locId) {
    const loc = await prisma.location.findFirst({
      where: { id: locId, businessId },
    });
    if (!loc) throw new Error("Invalid location");
  }
  if (uniqueTableIds.length === 0) {
    return { locationId: locId, tableIds: [] };
  }
  const rows = await prisma.table.findMany({
    where: { id: { in: uniqueTableIds } },
    select: {
      id: true,
      locationId: true,
      location: { select: { businessId: true } },
    },
  });
  if (rows.length !== uniqueTableIds.length) {
    throw new Error("One or more tables are invalid");
  }
  for (const r of rows) {
    if (r.location.businessId !== businessId) {
      throw new Error("Table does not belong to this business");
    }
  }
  const uniqueLocIds = [...new Set(rows.map((r) => r.locationId))];
  if (uniqueLocIds.length > 1) {
    throw new Error("Selected tables must belong to a single location");
  }
  if (locId && uniqueLocIds[0] !== locId) {
    throw new Error("Selected tables must belong to the assigned location");
  }
  if (!locId && uniqueLocIds.length === 1) {
    locId = uniqueLocIds[0];
  }
  return { locationId: locId, tableIds: uniqueTableIds };
}

export interface EmployeeListItem {
  id: string;
  slug: string | null;
  name: string;
  role: string;
  avatar: string | null;
  isActive: boolean;
  rating: number | null;
  tips: number;
  topRated: boolean;
}

type EmployeeRosterAggRow = {
  id: string;
  slug: string | null;
  name: string;
  job_title: string;
  avatar: string | null;
  is_active: boolean;
  tip_count: number;
};

/** Dashboard / manager list: read filter only — does not change database rows. */
export async function getEmployeesByBusinessId(businessId: string): Promise<EmployeeListItem[]> {
  const rows = await prisma.$queryRaw<EmployeeRosterAggRow[]>(Prisma.sql`
    SELECT
      e.id,
      e.slug,
      e.name,
      e.job_title,
      e.avatar,
      e.is_active,
      COUNT(t.id) FILTER (WHERE t.status = 'success')::int AS tip_count
    FROM employees e
    INNER JOIN "User" u ON u.id = e.user_id
    LEFT JOIN tips t ON t.employee_id = e.id
    WHERE e.business_id = ${businessId}
      AND e.is_deleted = false
      AND e.is_active = true
      AND e.activation_status = 'active'
      AND u.email_verified = true
    GROUP BY e.id, e.slug, e.name, e.job_title, e.avatar, e.is_active
    ORDER BY e.name ASC
  `);

  return rows.map((emp) => {
    const tipCount = Number(emp.tip_count ?? 0);
    return {
      id: emp.id,
      slug: emp.slug,
      name: emp.name,
      role: emp.job_title,
      avatar: absolutizePublicMediaPath(emp.avatar),
      isActive: emp.is_active,
      rating: tipCount > 0 ? 4.8 : null,
      tips: tipCount,
      topRated: tipCount > 200,
    };
  });
}

export interface EmployeeDetail {
  id: string;
  name: string;
  role: string;
  bio: string | null;
  avatar: string | null;
  businessId: string;
  /** Public `Business.slug` for canonical `/{businessSlug}/{employeeSlug}` links. */
  businessSlug: string | null;
  /** Public `Business.logoPath` for venue branding on tip flows. */
  businessLogo: string | null;
  /** Venue display name for customer UI. */
  businessName: string;
  /** Public `Employee.slug` when set. */
  slug: string | null;
}

export async function getEmployeeById(employeeId: string): Promise<EmployeeDetail | null> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      bio: true,
      avatar: true,
      slug: true,
      isActive: true,
      isDeleted: true,
      activationStatus: true,
      businessId: true,
      business: {
        select: {
          kycVerificationStatus: true,
          onboardingVerificationStatus: true,
          slug: true,
          logoPath: true,
          name: true,
        },
      },
      user: { select: { emailVerified: true } },
    },
  });
  if (!emp) {
    console.warn("[employee.getEmployeeById] no row for scanned id", { scannedRouteId: employeeId });
    return null;
  }
  if (emp.isDeleted) {
    console.warn("[employee.getEmployeeById] employee soft-deleted", {
      scannedRouteId: employeeId,
      dbLookupId: emp.id,
    });
    return null;
  }
  if (!emp.isActive) {
    console.warn("[employee.getEmployeeById] employee inactive", {
      scannedRouteId: employeeId,
      dbLookupId: emp.id,
    });
    return null;
  }
  if (emp.activationStatus !== "active") {
    console.warn("[employee.getEmployeeById] employee not fully onboarded", {
      scannedRouteId: employeeId,
      dbLookupId: emp.id,
      activationStatus: emp.activationStatus,
    });
    return null;
  }
  if (emp.user?.emailVerified !== true) {
    console.warn("[employee.getEmployeeById] employee email not verified", {
      scannedRouteId: employeeId,
      dbLookupId: emp.id,
    });
    return null;
  }
  if (
    !hasBusinessVerificationCapability(
      kycStatusToLegacyMirror(emp.business.kycVerificationStatus),
      "activateTipping",
      {
        onboardingVerificationStatus: emp.business.onboardingVerificationStatus,
      },
    )
  ) {
    throw new Error(VERIFICATION_REQUIRED_MSG);
  }
  return {
    id: emp.id,
    name: emp.name,
    role: emp.jobTitle,
    bio: emp.bio?.trim() || null,
    avatar: absolutizePublicMediaPath(emp.avatar),
    businessId: emp.businessId,
    businessSlug: emp.business.slug ?? null,
    businessLogo: absolutizePublicMediaPath(emp.business.logoPath ?? null),
    businessName: emp.business.name ?? "",
    slug: emp.slug ?? null,
  };
}

export interface UpdateEmployeeInput {
  name?: string;
  jobTitle?: string;
  monthlyGoal?: number | null;
  isActive?: boolean;
  email?: string;
  locationId?: string | null;
  tableIds?: string[];
}

export async function updateEmployeeForBusiness(
  businessId: string,
  employeeId: string,
  input: UpdateEmployeeInput
) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId, isDeleted: false },
    include: {
      user: true,
      tableAssignments: { select: { table: { select: { id: true } } } },
    },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }

  const { name, jobTitle, monthlyGoal, isActive, email, locationId, tableIds } = input;
  const shouldUpdateAssignments =
    typeof locationId !== "undefined" || typeof tableIds !== "undefined";
  let resolvedAssignments: { locationId: string | null; tableIds: string[] } | null = null;
  if (shouldUpdateAssignments) {
    const nextLocationId =
      typeof locationId !== "undefined" ? locationId : emp.locationId;
    const nextTableIds =
      typeof tableIds !== "undefined"
        ? tableIds
        : emp.tableAssignments.map((ta) => ta.table.id);
    resolvedAssignments = await resolveStaffAssignments(businessId, nextLocationId, nextTableIds);
  }
  if (name !== undefined) {
    const newName = name.trim();
    if (!newName) {
      throw new Error("Name cannot be empty");
    }
  }

  if (jobTitle !== undefined && jobTitle.trim()) {
    await assertJobTitleAllowedForBusiness(businessId, jobTitle, emp.jobTitle);
  }

  if (email !== undefined && email.trim()) {
    const trimmed = email.trim().toLowerCase();
    // Only update email if employee has been activated (has a user)
    if (emp.user && trimmed !== emp.user.email) {
      const taken = await prisma.user.findFirst({
        where: {
          email: trimmed,
          ...(emp.userId ? { NOT: { id: emp.userId } } : {}),
        },
      });
      if (taken) {
        throw new Error("Email already in use");
      }
      await prisma.user.update({
        where: { id: emp.userId! },
        data: { email: trimmed },
      });
    } else if (!emp.user) {
      throw new Error("Cannot update email for pending activation employees");
    }
  }

  const nameTrimmed = name !== undefined ? name.trim() : undefined;
  const employeeDisplayName =
    name !== undefined ? name.trim() : emp.name;

  await prisma.$transaction(async (tx) => {
    if (isActive !== undefined && emp.userId) {
      await tx.user.updateMany({
        where: {
          OR: [
            { id: emp.userId },
            // More robust: sync via relation in case userId is stale/missing in the employee row.
            { employee: { id: employeeId } },
          ],
        },
        data: { isActive },
      });
    }

    await tx.employee.update({
    where: { id: employeeId },
    data: {
      ...(nameTrimmed !== undefined ? { name: nameTrimmed } : {}),
      ...(jobTitle !== undefined && jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
      ...(monthlyGoal !== undefined
        ? { monthlyGoal: monthlyGoal === null ? null : monthlyGoal }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(resolvedAssignments
        ? {
            locationId: resolvedAssignments.locationId,
            tableAssignments: {
              deleteMany: {},
              create: resolvedAssignments.tableIds.map((tableId) => ({
                employeeName: employeeDisplayName,
                table: { connect: { id: tableId } },
              })),
            },
          }
        : {}),
    },
    });
  });

  if (
    nameTrimmed !== undefined &&
    nameTrimmed !== emp.name &&
    !resolvedAssignments
  ) {
    await prisma.employeeTableAssignment.updateMany({
      where: { employeeId },
      data: { employeeName: nameTrimmed },
    });
  }

  const updated = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: { select: { email: true } },
      tableAssignments: { select: { table: { select: { id: true } } } },
    },
  });
  if (!updated) throw new Error("Update failed");

  notifyBusinessRosterChanged(businessId, "staff_updated");

  return {
    id: updated.id,
    name: updated.name,
    jobTitle: updated.jobTitle,
    slug: updated.slug,
    avatar: absolutizePublicMediaPath(updated.avatar),
    monthlyGoal: updated.monthlyGoal != null ? Number(updated.monthlyGoal) : null,
    isActive: updated.isActive,
    email: updated.user?.email ?? "",
    locationId: updated.locationId,
    assignedTableIds: updated.tableAssignments.map((ta) => ta.table.id),
  };
}

export async function updateEmployeeActiveStatusForBusiness(
  businessId: string,
  employeeId: string,
  isActive: boolean
) {
  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.findFirst({
      where: { id: employeeId, businessId },
      select: { id: true, userId: true },
    });
    if (!emp) {
      throw new Error("Employee not found");
    }

    // Keep User.isActive in sync for activated employees (those with a linked user).
    // Pending-activation employees have no user yet, so only Employee.isActive is updated.
    await tx.user.updateMany({
      where: {
        OR: [
          ...(emp.userId ? [{ id: emp.userId }] : []),
          { employee: { id: employeeId } },
        ],
      },
      data: { isActive },
    });

    return tx.employee.update({
      where: { id: employeeId },
      data: { isActive },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        slug: true,
        avatar: true,
        isActive: true,
        locationId: true,
        tableAssignments: { select: { table: { select: { id: true } } } },
        user: { select: { email: true } },
        monthlyGoal: true,
      },
    });
  });

  notifyBusinessRosterChanged(businessId, "staff_updated");

  return {
    id: updated.id,
    name: updated.name,
    jobTitle: updated.jobTitle,
    slug: updated.slug,
    avatar: absolutizePublicMediaPath(updated.avatar),
    monthlyGoal: updated.monthlyGoal != null ? Number(updated.monthlyGoal) : null,
    isActive: updated.isActive,
    email: updated.user?.email ?? "",
    locationId: updated.locationId,
    assignedTableIds: updated.tableAssignments.map((ta) => ta.table.id),
  };
}

/** Regenerate a unique staff URL slug (saved to Postgres). Caller must authorize businessId. */
export async function regenerateEmployeeSlugForBusiness(businessId: string, employeeId: string) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { kycVerificationStatus: true, onboardingVerificationStatus: true },
  });
  if (!biz) {
    throw new Error("Business not found");
  }
  if (
    !hasBusinessVerificationCapability(kycStatusToLegacyMirror(biz.kycVerificationStatus), "qrCodes", {
      onboardingVerificationStatus: biz.onboardingVerificationStatus,
    })
  ) {
    throw new Error(VERIFICATION_REQUIRED_MSG);
  }
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }
  const baseSlug = generateSlug(emp.name.trim() || "staff");
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const other = await prisma.employee.findFirst({
      where: { slug: s, NOT: { id: employeeId } },
    });
    return !!other;
  });
  await prisma.employee.update({
    where: { id: employeeId },
    data: { slug },
  });
  const updated = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { email: true } } },
  });
  if (!updated) throw new Error("Update failed");
  notifyBusinessRosterChanged(businessId, "staff_slug_updated");
  return {
    id: updated.id,
    name: updated.name,
    jobTitle: updated.jobTitle,
    slug: updated.slug,
    avatar: absolutizePublicMediaPath(updated.avatar),
    email: updated.user?.email ?? "",
  };
}

export async function deleteEmployeeForBusiness(businessId: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId, isDeleted: false },
    select: { id: true, userId: true },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.employee.update({
      where: { id: emp.id },
      data: {
        isDeleted: true,
        deletedAt: now,
        isActive: false,
        activationStatus: "pending_activation",
      },
    }),
    prisma.user.update({
      where: { id: emp.userId },
      data: { isActive: false },
    }),
  ]);
  notifyBusinessRosterChanged(businessId, "staff_deleted");
}

export interface EmployeeSelfProfile {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  bio: string | null;
  avatar: string | null;
  monthlyGoal: number | null;
  emailNotifications: boolean;
  pushNotifications: boolean;
  businessId: string;
  /** Public `Business.slug` for `/{businessSlug}/{employeeSlug}` URLs. */
  businessSlug: string | null;
  /** Public `Business.logoPath` for employee branding (logo URL resolved for the frontend). */
  businessLogo: string | null;
  /** Display name of the business (venue). */
  businessName: string;
  /** Business IANA timezone for analytics reporting. */
  businessTimezone?: string;
  /** Public staff page / QR URL segment (Postgres `slug`) */
  slug: string | null;
  /** Venue SaaS tier for entitlement UI (server remains source of truth). */
  subscriptionTier?: "basic" | "premium" | "enterprise" | null;
  subscriptionStatus?: "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete";
  hasActiveSubscription?: boolean;
  accessSource?: "none" | "subscription" | "sponsored";
  sponsoredProgrammeKey?: string | null;
}

export async function getEmployeeProfileForUser(userId: string): Promise<EmployeeSelfProfile | null> {
  const userEmail = { select: { email: true } } as const;
  const fullSelect = {
    id: true,
    name: true,
    jobTitle: true,
    bio: true,
    avatar: true,
    monthlyGoal: true,
    emailNotifications: true,
    pushNotifications: true,
    businessId: true,
    slug: true,
    business: { select: { slug: true, timezone: true, name: true, logoPath: true, subscriptionTier: true } },
    user: userEmail,
  } as const;
  try {
    const emp = await prisma.employee.findUnique({
      where: { userId },
      select: fullSelect,
    });
    if (!emp) return null;
    if (!emp.user) return null;
    const entitlements = await resolveSubscriptionEntitlements(emp.businessId);
    return {
      id: emp.id,
      name: emp.name,
      email: emp.user.email,
      jobTitle: emp.jobTitle,
      bio: emp.bio ?? null,
      avatar: absolutizePublicMediaPath(emp.avatar),
      monthlyGoal: emp.monthlyGoal != null ? Number(emp.monthlyGoal) : null,
      emailNotifications: emp.emailNotifications,
      pushNotifications: emp.pushNotifications,
      businessId: emp.businessId,
      businessSlug: emp.business.slug ?? null,
      businessLogo: absolutizePublicMediaPath(emp.business.logoPath ?? null),
      businessName: emp.business.name ?? "",
      businessTimezone: (emp.business as any).timezone ?? undefined,
      slug: emp.slug ?? null,
      subscriptionTier: entitlements.subscriptionTier,
      subscriptionStatus: entitlements.status,
      hasActiveSubscription: entitlements.hasActiveEntitlements,
      accessSource: entitlements.accessSource,
      sponsoredProgrammeKey: entitlements.sponsoredProgrammeKey,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
      const emp = await prisma.employee.findUnique({
        where: { userId },
        select: {
          id: true,
          name: true,
          jobTitle: true,
          avatar: true,
          businessId: true,
          slug: true,
          business: { select: { slug: true, timezone: true, name: true, logoPath: true } },
          user: userEmail,
        },
      });
      if (!emp) return null;
      if (!emp.user) return null;
      const entitlements = await resolveSubscriptionEntitlements(emp.businessId);
      return {
        id: emp.id,
        name: emp.name,
        email: emp.user.email,
        jobTitle: emp.jobTitle,
        bio: null,
        avatar: absolutizePublicMediaPath(emp.avatar),
        monthlyGoal: null,
        emailNotifications: true,
        pushNotifications: true,
        businessId: emp.businessId,
        businessSlug: emp.business.slug ?? null,
        businessLogo: absolutizePublicMediaPath(emp.business.logoPath ?? null),
        businessName: emp.business.name ?? "",
        businessTimezone: (emp.business as any).timezone ?? undefined,
        slug: emp.slug ?? null,
        subscriptionTier: entitlements.subscriptionTier,
        subscriptionStatus: entitlements.status,
        hasActiveSubscription: entitlements.hasActiveEntitlements,
        accessSource: entitlements.accessSource,
        sponsoredProgrammeKey: entitlements.sponsoredProgrammeKey,
      };
    }
    throw e;
  }
}

/** Create a unique staff slug if missing (e.g. legacy rows). Idempotent if slug already set. */
export async function ensureEmployeeSlugForUser(userId: string): Promise<EmployeeSelfProfile> {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    include: {
      user: { select: { email: true } },
      business: { select: { kycVerificationStatus: true, onboardingVerificationStatus: true } },
    },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }
  if (
    !hasBusinessVerificationCapability(
      kycStatusToLegacyMirror(emp.business.kycVerificationStatus),
      "qrCodes",
      {
        onboardingVerificationStatus: emp.business.onboardingVerificationStatus,
      },
    )
  ) {
    throw new Error(VERIFICATION_REQUIRED_MSG);
  }
  if (emp.slug) {
    const profile = await getEmployeeProfileForUser(userId);
    if (!profile) throw new Error("Profile not found");
    return profile;
  }
  const baseSlug = generateSlug(emp.name.trim() || "staff");
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const existing = await prisma.employee.findFirst({
      where: { slug: s, NOT: { id: emp.id } },
    });
    return !!existing;
  });
  await prisma.employee.update({
    where: { id: emp.id },
    data: { slug },
  });
  const updated = await getEmployeeProfileForUser(userId);
  if (!updated) throw new Error("Update failed");
  return updated;
}

export async function updateEmployeeSelf(
  userId: string,
  input: {
    name?: string;
    bio?: string | null;
    phone?: string | null;
    monthlyGoal?: number | null;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
  }
): Promise<EmployeeSelfProfile> {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }

  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.bio !== undefined ? { bio: input.bio?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.monthlyGoal !== undefined
        ? { monthlyGoal: input.monthlyGoal === null ? null : input.monthlyGoal }
        : {}),
      ...(input.emailNotifications !== undefined ? { emailNotifications: input.emailNotifications } : {}),
      ...(input.pushNotifications !== undefined ? { pushNotifications: input.pushNotifications } : {}),
    },
  });

  const updated = await getEmployeeProfileForUser(userId);
  if (!updated) throw new Error("Update failed");
  return updated;
}

export async function setEmployeeAvatarUrl(userId: string, avatarUrl: string) {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }
  await prisma.employee.update({
    where: { id: emp.id },
    data: { avatar: avatarUrl },
  });
  return { avatar: absolutizePublicMediaPath(avatarUrl) };
}

export async function exportEmployeeData(userId: string) {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    include: {
      user: { select: { email: true, createdAt: true } },
      transactions: { where: { status: "success" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!emp) {
    throw new Error("Employee not found");
  }
  if (!emp.user) {
    throw new Error("Profile not found");
  }
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      name: emp.name,
      email: emp.user.email,
      jobTitle: emp.jobTitle,
      bio: emp.bio,
      avatar: absolutizePublicMediaPath(emp.avatar),
      monthlyGoal: emp.monthlyGoal != null ? Number(emp.monthlyGoal) : null,
      accountCreatedAt: emp.user.createdAt.toISOString(),
    },
    tips: emp.transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function deleteEmployeeAccount(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "EMPLOYEE") {
    throw new Error("Not allowed");
  }
  await prisma.user.delete({ where: { id: userId } });
}

export interface CreateEmployeeWithActivationInput {
  name: string;
  jobTitle: string;
  email: string;
  phone?: string;
  businessId: string;
  locationId?: string | null;
  tableIds?: string[];
  /** Client UI language for invite email (overrides inviter stored locale when set). */
  explicitLocale?: string | null;
  acceptLanguage?: string | null;
}

export interface CreateEmployeeWithActivationResult {
  id: string;
  name: string;
  jobTitle: string;
  email: string;
  activationToken: string;
  expiresAt: Date;
  locationId: string | null;
  assignedTableIds: string[];
}

/**
 * Creates an employee with activation token and a linked `users` row (password unset until activation).
 * Every employee row keeps `user_id` set so dashboard, auth, and FK flows stay consistent.
 */
export async function createEmployeeWithActivation(
  input: CreateEmployeeWithActivationInput
): Promise<CreateEmployeeWithActivationResult> {
  const {
    name,
    jobTitle,
    email,
    phone,
    businessId,
    locationId: locIn,
    tableIds: tablesIn,
    explicitLocale,
    acceptLanguage,
  } = input;
  if (!name?.trim() || !email?.trim() || !jobTitle?.trim()) {
    throw new Error("Name, email, and role are required");
  }
  await assertJobTitleAllowedForBusiness(businessId, jobTitle);
  const trimmedEmail = email.trim().toLowerCase();

  // Verify email is not already registered
  const existing = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Email already registered");
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { verificationStatus: true, name: true, userId: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }

  const inviter = business.userId
    ? await prisma.user.findUnique({
        where: { id: business.userId },
        select: { preferredLocale: true },
      })
    : null;

  const resolved = await resolveStaffAssignments(businessId, locIn ?? null, tablesIn ?? []);

  const inviteLocaleSeed = explicitLocale ?? inviter?.preferredLocale ?? null;
  const seededPreferredLocale = inviteLocaleSeed
    ? resolveUserPreferredLocale(inviteLocaleSeed)
    : null;

  const employee = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: trimmedEmail,
        passwordHash: null,
        role: "EMPLOYEE",
        isPlatformAdmin: false,
        /** Confirmed when activation completes (password set); see `activateEmployee`. */
        emailVerified: false,
        preferredLocale: seededPreferredLocale,
      },
    });
    return tx.employee.create({
      data: {
        name: name.trim(),
        jobTitle: jobTitle.trim(),
        phone: phone ? phone.trim() : null,
        businessId,
        userId: user.id,
        locationId: resolved.locationId,
        activationStatus: "pending_activation",
        ...(resolved.tableIds.length > 0
          ? {
              tableAssignments: {
                create: resolved.tableIds.map((tableId) => ({
                  employeeName: name.trim(),
                  table: { connect: { id: tableId } },
                })),
              },
            }
          : {}),
      },
      include: { tableAssignments: { select: { table: { select: { id: true } } } } },
    });
  });

  // Generate activation token
  const activationToken = await employeeActivationService.createEmployeeActivationToken(
    employee.id,
    trimmedEmail,
    24 // 24 hours expiration
  );

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  // Send activation email (best-effort; does not block employee creation)
  await sendEmployeeActivationEmail({
    to: trimmedEmail,
    employeeName: employee.name,
    activationUrl: buildEmployeeActivationUrl(activationToken),
    expiresInHours: 24,
    businessName: business.name?.trim() || "CareTip",
    inviteeUserId: employee.userId,
  });

  notifyBusinessRosterChanged(businessId, "staff_created");

  void import("./push/notification.triggers.js").then(({ onEmployeeInvited }) => {
    onEmployeeInvited({
      businessId,
      employeeName: employee.name,
      employeeEmail: trimmedEmail,
    });
  });

  void import("./activity/staffActivity.helpers.js").then(
    ({ scheduleEmployeeInvitedEmailProjection }) => {
      scheduleEmployeeInvitedEmailProjection({
        businessId,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeEmail: trimmedEmail,
        actorUserId: business.userId,
      });
    },
  );

  return {
    id: employee.id,
    name: employee.name,
    jobTitle: employee.jobTitle,
    email: trimmedEmail,
    activationToken,
    expiresAt,
    locationId: employee.locationId,
    assignedTableIds: employee.tableAssignments.map((ta) => ta.table.id),
  };
}
