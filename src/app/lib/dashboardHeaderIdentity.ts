/**
 * Shell header identity. Never invent Platform Admin copy when role is unknown.
 * Authoritative role is `user.role` from the auth store (JWT/login/refresh), not the pathname.
 */

export type ShellHeaderUserLike = {
  role?: string | null;
  name?: string | null;
  email?: string | null;
} | null;

export type DashboardHeaderIdentity = {
  displayName: string;
  displayEmail: string;
  /** False while auth/role is unresolved — do not paint a fake Admin identity. */
  showProfileCluster: boolean;
};

export function isPlatformAdminHeaderRole(role: string | null | undefined): boolean {
  return role === "platform_admin" || role === "admin";
}

export function resolveDashboardHeaderIdentity(
  user: ShellHeaderUserLike,
  copy: { platformAdminName: string; platformAdminEmail: string },
): DashboardHeaderIdentity {
  const role = user?.role?.trim() || "";
  if (!user || !role) {
    return { displayName: "", displayEmail: "", showProfileCluster: false };
  }

  const name = user.name?.trim() ?? "";
  const email = user.email?.trim() ?? "";

  if (isPlatformAdminHeaderRole(role)) {
    return {
      displayName: name || copy.platformAdminName,
      displayEmail: email || copy.platformAdminEmail,
      showProfileCluster: true,
    };
  }

  if (!name && !email) {
    return { displayName: "", displayEmail: "", showProfileCluster: false };
  }

  return {
    displayName: name || email,
    displayEmail: email,
    showProfileCluster: true,
  };
}
