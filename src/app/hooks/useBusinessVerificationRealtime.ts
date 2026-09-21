import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "./useAuth";
import { fetchBusinessProfile, hasClientAccessToken } from "../lib/api";
import { useSocketInstance } from "./useSocket";
import { logClientError } from "../lib/clientLog";
import { isApiAuthSessionError } from "../lib/apiError";
import { isAuthenticatedWithAccessToken } from "../lib/authRestore";
import type { OnboardingVerificationStatus } from "../lib/api";
import { resolveOnboardingVerificationOutcomeToast } from "../lib/onboardingVerificationOutcomeNotification";

/**
 * Syncs split verification fields and surfaces onboarding outcome toasts once per
 * new approved/rejected result (acked in localStorage until status returns to draft/submitted).
 * KYC toasts are suppressed while document upload remains behind MVP flag.
 *
 * Uses useSocketInstance (not status) so reconnect flags do not re-render the host tree.
 */
export function useBusinessVerificationRealtime(enabled: boolean): void {
  const { t } = useTranslation();
  const { user, updateUser, authStatus } = useAuth();
  const apiReady = isAuthenticatedWithAccessToken(user, authStatus);
  const { socket } = useSocketInstance(enabled && apiReady);

  useEffect(() => {
    if (!enabled || !apiReady || !user || user.role !== "business" || user.impersonation) return;
    if (!hasClientAccessToken()) return;

    const sync = async () => {
      try {
        const p = await fetchBusinessProfile({ silent: true });
        const next = p.onboardingVerificationStatus as OnboardingVerificationStatus | undefined;
        const businessId = user.businessId ?? p.id;

        updateUser({
          onboardingVerificationStatus: p.onboardingVerificationStatus,
        });

        const outcome = resolveOnboardingVerificationOutcomeToast({
          businessId,
          next,
        });

        if (outcome === "approved") {
          toast.success(t("business.onboardingVerification.approvedToastTitle"), {
            description: t("business.onboardingVerification.approvedToastBody"),
            duration: 8000,
          });
        } else if (outcome === "rejected") {
          toast.error(t("business.onboardingVerification.rejectedToastTitle"), {
            description: t("business.onboardingVerification.rejectedToastBody"),
            duration: 10000,
          });
        }
      } catch (err) {
        if (isApiAuthSessionError(err)) return;
        logClientError("useBusinessVerificationRealtime", err);
      }
    };

    void sync();

    if (!socket) return;
    const onUpdate = () => void sync();
    socket.on("verification_updated", onUpdate);
    socket.on("platform_verification_updated", onUpdate);
    return () => {
      socket.off("verification_updated", onUpdate);
      socket.off("platform_verification_updated", onUpdate);
    };
  }, [apiReady, enabled, socket, t, updateUser, user?.businessId, user?.id, user?.impersonation, user?.role]);
}
