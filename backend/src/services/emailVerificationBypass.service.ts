import { prisma } from "../prisma.js";

/**
 * Demo / walkthrough email verification bypass.
 * Disabled in production unless ENABLE_DEMO_BYPASS=true (explicit opt-in).
 */
export function isDemoEmailVerificationBypassEnabled(): boolean {
  if (process.env.ENABLE_DEMO_BYPASS === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/** Case-insensitive first-name allowlist (plus optional env). */
const HARDCODED_BYPASS_FIRST_NAMES = new Set(["genevive", "genevieve", "bobby"]);

function mergeEnvFirstNames(base: Set<string>): Set<string> {
  const raw = process.env.EMAIL_VERIFICATION_BYPASS_FIRST_NAMES?.trim();
  if (!raw) return base;
  const out = new Set(base);
  for (const part of raw.split(/[,;]/)) {
    const t = part.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

/** Stakeholder walkthrough accounts — eligible for login without inbox verification (non–super-admin). */
const HARDCODED_DEMO_LOGIN_EMAILS = new Set(
  ["demo@caretip.de", "employee@caretip.de"].map((e) => e.toLowerCase()),
);

function bypassEmails(): Set<string> {
  const s = new Set<string>(HARDCODED_DEMO_LOGIN_EMAILS);
  const raw = process.env.EMAIL_VERIFICATION_BYPASS_EMAILS?.trim();
  if (!raw) return s;
  for (const part of raw.split(/[,;]/)) {
    const t = part.trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

function bypassFirstNames(): Set<string> {
  return mergeEnvFirstNames(new Set(HARDCODED_BYPASS_FIRST_NAMES));
}

export function firstNameTokenLower(displayName: string | null | undefined): string {
  if (!displayName || !String(displayName).trim()) return "";
  const [first] = String(displayName).trim().split(/\s+/);
  return (first || "").toLowerCase();
}

export type UserRowForEmailBypass = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: string;
  employee?: { name: string } | null;
  business?: { name: string } | null;
};

/**
 * When true, successful login may auto-verify email (same outcome as clicking the verify link).
 * Super-admin accounts are never matched by name allowlist.
 */
export function qualifiesEmailVerificationBypass(row: UserRowForEmailBypass): boolean {
  if (!isDemoEmailVerificationBypassEnabled()) return false;
  if (row.role === "SUPER_ADMIN") return false;
  const email = row.email.trim().toLowerCase();
  if (bypassEmails().has(email)) return true;
  const names = bypassFirstNames();
  if (row.role === "EMPLOYEE" && row.employee?.name) {
    const t = firstNameTokenLower(row.employee.name);
    if (t && names.has(t)) return true;
  }
  if (row.role === "MANAGER" && row.business?.name) {
    const t = firstNameTokenLower(row.business.name);
    if (t && names.has(t)) return true;
  }
  return false;
}

/**
 * Sets `email_verified`, promotes `pending_verification` employees to active, and clears verify tokens.
 * No-op if already verified or not on the allowlist.
 */
export async function applyEmailVerificationBypassIfEligible(
  row: UserRowForEmailBypass
): Promise<boolean> {
  if (row.emailVerified === true) return false;
  if (!qualifiesEmailVerificationBypass(row)) return false;

  const pendingEmployees = await prisma.employee.findMany({
    where: {
      userId: row.id,
      activationStatus: "pending_verification",
    },
    select: { id: true, name: true, businessId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.id },
      data: { emailVerified: true },
    });
    await tx.employee.updateMany({
      where: {
        userId: row.id,
        activationStatus: "pending_verification",
      },
      data: { activationStatus: "active" },
    });
    await tx.emailVerificationToken.deleteMany({ where: { userId: row.id } });
  });

  if (pendingEmployees.length > 0) {
    void import("./activity/staffActivity.helpers.js").then(({ scheduleEmployeeJoinedProjection }) => {
      for (const emp of pendingEmployees) {
        scheduleEmployeeJoinedProjection({
          businessId: emp.businessId,
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: row.email,
          channel: "bypass",
        });
      }
    });
  }
  return true;
}
