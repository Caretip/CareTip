import type { UserRole } from "@/types/auth";

export type DashboardRoute =
  | "/(app)/business"
  | "/(app)/employee"
  | "/(app)/admin";

export function getDashboardRouteForRole(role: UserRole | undefined | null): DashboardRoute {
  switch (role) {
    case "MANAGER":
      return "/(app)/business";
    case "EMPLOYEE":
      return "/(app)/employee";
    case "SUPER_ADMIN":
      return "/(app)/admin";
    default:
      return "/(app)/employee";
  }
}

/** In-app notification inbox — explicit user tap only; not a post-auth landing route. */
export function getNotificationsRouteForRole(
  role: UserRole | undefined | null,
):
  | "/(app)/business/notifications"
  | "/(app)/employee/notifications"
  | DashboardRoute {
  switch (role) {
    case "MANAGER":
      return "/(app)/business/notifications";
    case "EMPLOYEE":
      return "/(app)/employee/notifications";
    default:
      return getDashboardRouteForRole(role);
  }
}

export function roleLabel(role: UserRole | undefined | null): string {
  switch (role) {
    case "MANAGER":
      return "Business";
    case "EMPLOYEE":
      return "Employee";
    case "SUPER_ADMIN":
      return "Platform admin";
    default:
      return "Account";
  }
}
