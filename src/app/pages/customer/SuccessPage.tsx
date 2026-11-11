import { guestTipRetryPathForSession } from "../../lib/repeatTip";
import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { useTipFlow } from "../../context/TipFlowContext";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { clearCustomerFlowEntry } from "../../lib/customerFlowGuard";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { TipPaymentProcessingView } from "./TipPaymentProcessingView";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { useVerifiedTipSession, isVerifiedTipSessionReady } from "../../hooks/useVerifiedTipSession";
import { useCustomerVenueBrand } from "./customerJourneyBrand";
import { resolveGuestThankYouMessage } from "../../lib/businessBranding";
import { TipSuccessExperience } from "./TipSuccessExperience";
import { useTipSuccessEmployeeProfile } from "./useTipSuccessEmployeeProfile";

export function SuccessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { amount, employeeName, reset } = useTipFlow();

  const sessionId = searchParams.get("session_id")?.trim() ?? "";
  const isDevMockSession = DEV_BYPASS_ENABLED && sessionId === DEV_MOCK.sessionId;
  const effectiveSessionId = isDevMockSession ? DEV_MOCK.sessionId : sessionId;

  const [verification, retryVerification] = useVerifiedTipSession(effectiveSessionId, {
    enabled: Boolean(effectiveSessionId.trim()),
    allowDevMock: isDevMockSession,
  });
  const verified = isVerifiedTipSessionReady(verification);

  const tipAmount = amount != null && Number.isFinite(amount) && amount > 0 ? amount : null;
  const displayEmployeeName =
    verification.phase === "ready"
      ? verification.context.employee?.name ?? employeeName
      : employeeName;
  const businessIdForVenue =
    verification.phase === "ready" ? verification.context.businessId : null;
  const venueBrand = useCustomerVenueBrand(businessIdForVenue, t("tipFlow.common.venue"));
  const employeeFallback = useMemo(
    () => ({
      name: displayEmployeeName ?? t("tipFlow.common.theTeamMember"),
      avatar:
        verification.phase === "ready" ? verification.context.employee?.avatar ?? null : null,
      role: null,
      bio: null,
    }),
    [displayEmployeeName, t, verification],
  );
  const employeeId =
    verification.phase === "ready" ? verification.context.employee?.id : null;
  const employee = useTipSuccessEmployeeProfile(employeeId, employeeFallback);

  useEffect(() => {
    if (!sessionId) {
      navigate("/", { replace: true });
    }
  }, [navigate, sessionId]);

  useEffect(() => {
    if (
      verification.phase === "expired" ||
      verification.phase === "unpaid" ||
      verification.phase === "failed" ||
      verification.phase === "error"
    ) {
      toast.message(
        verification.phase === "failed"
          ? t("tipFlow.completion.paymentFailedTitle")
          : t("tipFlow.completion.notVerifiedTitle"),
        {
          description:
            verification.phase === "failed"
              ? t("tipFlow.completion.paymentFailedDesc")
              : toUserFriendlyMessage(verification.phase === "error" ? verification.message : undefined),
        },
      );
      // Back to that tip screen so the guest can try again; homepage only without a saved checkout.
      // "error" means the status could not be read — the tip may have gone through, so never invite a
      // second payment then. Definite outcomes (failed / expired / unpaid) go back to that tip screen.
      const retryPath = verification.phase === "error" ? null : guestTipRetryPathForSession(sessionId);
      navigate(retryPath ?? "/", { replace: true });
    }
  }, [navigate, sessionId, t, verification]);

  const goToRating = () => {
    if (!sessionId) {
      navigate("/", { replace: true });
      return;
    }
    navigate(`/rating?session_id=${encodeURIComponent(sessionId)}`);
  };

  const leavePage = () => {
    clearCustomerFlowEntry();
    reset();
    navigate("/", { replace: true });
  };

  if (verification.phase === "loading" || verification.phase === "pending") {
    return (
      <CareTipPageLoader
        variant="wait"
        context="stripeReturn"
        registrationKey="success-page-verification"
      />
    );
  }

  if (verification.phase === "timeout") {
    return (
      <TipPaymentProcessingView
        employeeName={employeeName ?? undefined}
        title={t("tipFlow.completion.confirmDelayedTitle")}
        subtitle={t("tipFlow.completion.confirmDelayedDesc")}
        onRetry={retryVerification}
        onReturnHome={leavePage}
      />
    );
  }

  if (
    verification.phase === "expired" ||
    verification.phase === "unpaid" ||
    verification.phase === "failed" ||
    verification.phase === "error"
  ) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="stripeReturn"
        registrationKey="success-page-redirect"
      />
    );
  }

  if (!verified) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="stripeReturn"
        registrationKey="success-page-verification"
      />
    );
  }

  return (
    <TipSuccessExperience
      venue={venueBrand}
      employee={employee}
      thankYouMessage={resolveGuestThankYouMessage(
        venueBrand.branding,
        t("tipFlow.success.tipSentConfirmation"),
      )}
      headline={t("tipFlow.success.celebrationHeadline")}
      tipAmount={tipAmount}
      showReceipt={false}
      primaryLabel={t("tipFlow.success.leaveFeedback")}
      secondaryLabel={t("tipFlow.success.backHome")}
      onPrimary={goToRating}
      onSecondary={leavePage}
      primaryIcon={<Star className="size-5 shrink-0" aria-hidden />}
    />
  );
}
