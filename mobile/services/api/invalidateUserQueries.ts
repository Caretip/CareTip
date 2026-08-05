import type { QueryClient } from "@tanstack/react-query";
import type { UserQueryKeys } from "@/services/api/queryKeys";
import { refreshSession } from "@/services/auth/authService";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { clearBrandedQrImageCaches } from "@/utils/brandedQrImageCache";
import { bumpMediaCacheGeneration } from "@/utils/mediaCacheGeneration";
import { logAuthEvent } from "@/utils/authDebug";

/** Broad workspace refresh after resume / billing / verification / business_data. */
export function invalidateWorkspaceQueries(
  queryClient: QueryClient,
  qk: UserQueryKeys,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.businessProfile }),
    queryClient.invalidateQueries({ queryKey: qk.businessStats }),
    queryClient.invalidateQueries({ queryKey: qk.businessQr }),
    queryClient.invalidateQueries({ queryKey: qk.businessQrAnalytics }),
    queryClient.invalidateQueries({ queryKey: qk.businessFeedback }),
    queryClient.invalidateQueries({ queryKey: qk.businessActivity }),
    queryClient.invalidateQueries({ queryKey: qk.businessTips }),
    queryClient.invalidateQueries({ queryKey: [...qk.root, "business", "employees"] }),
    queryClient.invalidateQueries({ queryKey: qk.employeeMe }),
    queryClient.invalidateQueries({ queryKey: qk.employeeTips }),
    queryClient.invalidateQueries({ queryKey: qk.employeeTipList }),
    queryClient.invalidateQueries({ queryKey: qk.notifications }),
    queryClient.invalidateQueries({ queryKey: qk.notificationUnread }),
    queryClient.invalidateQueries({ queryKey: qk.accountSettings }),
    queryClient.invalidateQueries({ queryKey: [...qk.root, "brandedQr"] }),
  ]).then(() => undefined);
}

/** Refresh AuthUser (+ token) from POST /api/auth/refresh into Zustand. */
export async function syncAuthUserFromServer(): Promise<boolean> {
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || !auth.accessToken) return false;

  try {
    const session = await refreshSession();
    if (!session?.user) return false;
    useUserStore.getState().setUser(session.user);
    if (session.token) {
      useAuthStore.getState().setAuthenticated(session.token);
    }
    logAuthEvent("session.auth_user.synced", {
      userId: session.user.id,
      hasCompletedOnboarding: session.user.hasCompletedOnboarding,
      emailVerified: session.user.emailVerified,
    });
    return true;
  } catch (error) {
    logAuthEvent("session.auth_user.sync_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

/** Profile / branding changes — wipe branded PNG disk + RQ so QR Studio cannot paint old art. */
export async function invalidateBrandingArtifacts(
  queryClient: QueryClient,
  qk: UserQueryKeys,
  opts?: { bumpGeneration?: boolean },
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [...qk.root, "brandedQr"] });
  await queryClient.invalidateQueries({ queryKey: qk.businessQr });
  if (opts?.bumpGeneration !== false) {
    bumpMediaCacheGeneration();
  }
  try {
    await clearBrandedQrImageCaches();
  } catch {
    /* non-fatal */
  }
}

/**
 * After logo / avatar upload — refresh every surface that may show the image
 * and bust RN image cache so initials never stick without logout.
 */
export async function invalidateMediaSurfaces(
  queryClient: QueryClient,
  qk: UserQueryKeys,
  opts?: { syncAuthUser?: boolean },
): Promise<void> {
  bumpMediaCacheGeneration();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.businessProfile }),
    queryClient.invalidateQueries({ queryKey: qk.businessStats }),
    queryClient.invalidateQueries({ queryKey: qk.businessFeedback }),
    queryClient.invalidateQueries({ queryKey: qk.businessActivity }),
    queryClient.invalidateQueries({ queryKey: qk.businessTips }),
    queryClient.invalidateQueries({ queryKey: [...qk.root, "business", "employees"] }),
    queryClient.invalidateQueries({ queryKey: qk.employeeMe }),
    queryClient.invalidateQueries({ queryKey: qk.employeeTips }),
    queryClient.invalidateQueries({ queryKey: qk.employeeTipList }),
    queryClient.invalidateQueries({ queryKey: qk.notifications }),
    queryClient.invalidateQueries({ queryKey: qk.notificationUnread }),
  ]);
  // Generation already bumped above — only clear disk + RQ branding keys.
  await invalidateBrandingArtifacts(queryClient, qk, { bumpGeneration: false });
  if (opts?.syncAuthUser !== false) {
    await syncAuthUserFromServer();
  }
}
