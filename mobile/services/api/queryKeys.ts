import { useMemo } from "react";
import { useUserStore } from "@/store/userStore";

/**
 * Phase 2.2 — private React Query keys are namespaced by immutable AuthUser.id.
 * Shape: ["u", userId, ...domain]
 *
 * Do not use email or businessId as the namespace.
 * Public (unauthenticated) keys live in `publicQueryKeys` — no user prefix.
 */

const NO_USER_SCOPE = "__none__";

export type UserQueryKeys = ReturnType<typeof createUserQueryKeys>;

export function createUserQueryKeys(userId: string) {
  const root = ["u", userId] as const;

  return {
    /** Prefix for removeQueries / broad user wipe (Phase 2.1 clear remains primary). */
    root,

    businessProfile: [...root, "business", "profile"] as const,
    /** Prefix — append timeframe / params for concrete keys. */
    businessStats: [...root, "business", "stats"] as const,
    businessQrAnalytics: [...root, "business", "qr-analytics"] as const,
    businessFeedback: [...root, "business", "feedback"] as const,
    businessActivity: [...root, "business", "activity"] as const,
    businessQr: [...root, "business", "qr"] as const,
    businessTips: [...root, "business", "tips"] as const,
    businessEmployees: (businessId: string) =>
      [...root, "business", "employees", businessId] as const,

    employeeMe: [...root, "employees", "me"] as const,
    employeeTips: [...root, "employees", "tips"] as const,
    employeeTipList: [...root, "employees", "tipList"] as const,

    notifications: [...root, "notifications"] as const,
    notificationUnread: [...root, "notifications", "unread"] as const,

    accountSettings: [...root, "settings", "account"] as const,
    twoFactor: [...root, "settings", "2fa"] as const,
    oauthAccounts: [...root, "settings", "oauth-accounts"] as const,

    brandedQr: (mode: "employee" | "manager", targetUrl: string) =>
      [...root, "brandedQr", mode, targetUrl] as const,

    tipDetail: (audience: "business" | "employee", tipId: string) =>
      [...root, "tip-detail", audience, tipId] as const,
  } as const;
}

/** Public / unauthenticated documents — intentionally not user-scoped. */
export const publicQueryKeys = {
  legalDocument: (kind: string, lang: string) => ["legal-document", kind, lang] as const,
} as const;

export function useAuthUserId(): string | null {
  return useUserStore((s) => s.user?.id ?? null);
}

/** Non-hook access (realtime bridge, async helpers). Null when logged out. */
export function getUserQueryKeys(): UserQueryKeys | null {
  const userId = useUserStore.getState().user?.id;
  if (!userId) return null;
  return createUserQueryKeys(userId);
}

/**
 * Private key factory for the current AuthUser.id.
 * When logged out, returns a inert `__none__` scope — pair with `enabled: Boolean(useAuthUserId())`.
 */
export function useUserQueryKeys(): UserQueryKeys {
  const userId = useAuthUserId();
  return useMemo(() => createUserQueryKeys(userId ?? NO_USER_SCOPE), [userId]);
}
