import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";

type ActivationDb = Prisma.TransactionClient | typeof prisma;

/**
 * Generates a secure activation token for employee onboarding.
 * Returns both the raw token (to send via email) and hash (stored in DB).
 */
export function generateActivationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Creates an activation token for an employee.
 * Invalidates any previous tokens for the same employee.
 */
export async function createEmployeeActivationToken(
  employeeId: string,
  email: string,
  expirationHours: number = 24
): Promise<string> {
  const { token, tokenHash } = generateActivationToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expirationHours);

  // Delete any existing unexpired tokens for this employee
  await prisma.employeeActivationToken.deleteMany({
    where: {
      employeeId,
      expiresAt: { gt: new Date() },
    },
  });

  // Create new token
  await prisma.employeeActivationToken.create({
    data: {
      tokenHash,
      employeeId,
      email,
      expiresAt,
    },
  });

  return token;
}

/**
 * Validates an activation token and returns associated employee.
 * Returns null if token is invalid or expired.
 */
export async function validateActivationToken(
  token: string
): Promise<
  | {
      employeeId: string;
      email: string;
      name: string;
      businessName: string;
      businessLogo: string | null;
    }
  | null
> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const record = await prisma.employeeActivationToken.findUnique({
    where: { tokenHash },
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
          activationStatus: true,
          business: { select: { name: true, logoPath: true } },
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  // Check expiration
  if (record.expiresAt < new Date()) {
    return null;
  }

  if (record.employee.isDeleted === true || record.employee.activationStatus !== "pending_activation") {
    return null;
  }

  return {
    employeeId: record.employee.id,
    email: record.email,
    name: record.employee.name,
    businessName: record.employee.business?.name ?? "Business",
    businessLogo: absolutizePublicMediaPath(record.employee.business?.logoPath ?? null),
  };
}

/**
 * Consumes an activation token after successful activation.
 */
export async function consumeActivationToken(
  employeeId: string,
  db: ActivationDb = prisma,
): Promise<void> {
  await db.employeeActivationToken.deleteMany({
    where: { employeeId },
  });
}

/**
 * Gets unexpired tokens for an employee (for resend scenarios).
 */
export async function getActiveActivationToken(
  employeeId: string
): Promise<string | null> {
  // If there's an active token, we could return info about it,
  // but since we only store the hash, we can't retrieve the original token.
  // This is by design for security.
  const token = await prisma.employeeActivationToken.findFirst({
    where: {
      employeeId,
      expiresAt: { gt: new Date() },
    },
  });

  return token ? "exists" : null;
}
