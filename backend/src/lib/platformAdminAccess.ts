import type { Role } from "@prisma/client";

/** Mirrors backend requirePlatformAdmin policy for tests and shared checks. */
export function isPlatformAdminPrincipal(user: {
  role: Role | string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  emailVerified: boolean;
}): boolean {
  return (
    user.role === "SUPER_ADMIN" &&
    user.isPlatformAdmin === true &&
    user.isActive === true &&
    user.emailVerified === true
  );
}

/** Platform admins eligible for operational incident alerts (Phase C). */
export const platformAdminIncidentRecipientWhere = {
  role: "SUPER_ADMIN" as const,
  isPlatformAdmin: true,
  isActive: true,
  emailVerified: true,
};
