/** Logins provisioned by `npm run db:seed` walkthrough demo (`backend/prisma/seedWalkthroughDemo.ts`). */
export const WALKTHROUGH_DEMO_MANAGER_EMAIL = "demo@caretip.de";
export const WALKTHROUGH_DEMO_EMPLOYEE_EMAIL = "employee@caretip.de";
export const WALKTHROUGH_DEMO_PLATFORM_ADMIN_EMAIL = "admin@caretip.de";

const WALKTHROUGH_DEMO_EMAILS = new Set(
  [
    WALKTHROUGH_DEMO_MANAGER_EMAIL,
    WALKTHROUGH_DEMO_EMPLOYEE_EMAIL,
    WALKTHROUGH_DEMO_PLATFORM_ADMIN_EMAIL,
  ].map((e) => e.toLowerCase()),
);

/** Exact-match walkthrough logins — mirrors backend `isWalkthroughDemoAccount`. */
export function isWalkthroughDemoAccount(
  user: { email: string } | null | undefined,
): boolean {
  if (!user?.email) return false;
  return WALKTHROUGH_DEMO_EMAILS.has(user.email.trim().toLowerCase());
}

export function isWalkthroughDemoManager(
  user: { email: string; role: string } | null | undefined,
): boolean {
  if (!user || user.role !== "business") return false;
  return user.email.trim().toLowerCase() === WALKTHROUGH_DEMO_MANAGER_EMAIL;
}

export function isWalkthroughDemoPlatformAdmin(
  user: { email: string; role: string } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role !== "platform_admin" && user.role !== "admin") return false;
  return user.email.trim().toLowerCase() === WALKTHROUGH_DEMO_PLATFORM_ADMIN_EMAIL;
}

export function isWalkthroughDemoEmployee(
  user: { email: string; role: string } | null | undefined,
): boolean {
  if (!user || user.role !== "employee") return false;
  return user.email.trim().toLowerCase() === WALKTHROUGH_DEMO_EMPLOYEE_EMAIL;
}
