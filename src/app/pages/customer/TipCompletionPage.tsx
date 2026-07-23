import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { clearCustomerFlowEntry } from "../../lib/customerFlowGuard";
import { useTipFlow } from "../../context/TipFlowContext";
import { useVerifiedTipSession, isVerifiedTipSessionReady } from "../../hooks/useVerifiedTipSession";
import { TipPaymentProcessingView } from "./TipPaymentProcessingView";
import { useCustomerVenueBrand } from "./customerJourneyBrand";
import { resolveGuestThankYouMessage } from "../../lib/businessBranding";
import { TipSuccessExperience } from "./TipSuccessExperience";
import { useTipSuccessEmployeeProfile } from "./useTipSuccessEmployeeProfile";

export function TipCompletionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { reset, businessId: tipFlowBusinessId, employeeName: tipFlowEmployeeName, amount } = useTipFlow();

  const sessionId = searchParams.get("session_id")?.trim() ?? "";
  const feedbackSubmitted = searchParams.get("feedbackSubmitted") === "1";

  const verification = useVerifiedTipSession(sessionId);
  const ready = isVerifiedTipSessionReady(verification);
  const context = ready ? verification.context : null;

  const businessIdForVenue = context?.businessId ?? tipFlowBusinessId;
  const venueBrand = useCustomerVenueBrand(businessIdForVenue, t("tipFlow.common.venue"));

  const displayName =
    context?.employee?.name ?? tipFlowEmployeeName ?? t("tipFlow.common.aTeamMember");
  const employeeFallback = useMemo(
    () => ({
      name: displayName,
      avatar: context?.employee?.avatar ?? null,
      role: null,
      bio: null,
    }),
    [displayName, context?.employee?.avatar],
  );
  const employee = useTipSuccessEmployeeProfile(context?.employee?.id, employeeFallback);
  const tipAmount = amount != null && Number.isFinite(amount) && amount > 0 ? amount : null;
  const thankYouMessage = feedbackSubmitted
    ? t("tipFlow.success.tipAndFeedbackReceived")
    : resolveGuestThankYouMessage(venueBrand.branding, t("tipFlow.success.tipSentConfirmation"));

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
      navigate("/", { replace: true });
    }
  }, [navigate, verification.phase]);

  if (!sessionId) {
    return null;
  }

  if (verification.phase === "loading" || verification.phase === "pending") {
    return (
      <TipPaymentProcessingView
        venue={venueBrand}
        employeeName={tipFlowEmployeeName ?? undefined}
        title={t("tipFlow.completion.processingTitle")}
        subtitle={t("tipFlow.completion.processingSubtitle")}
      />
    );
  }

  if (verification.phase === "timeout") {
    return (
      <TipPaymentProcessingView
        venue={venueBrand}
        employeeName={tipFlowEmployeeName ?? undefined}
        title={t("tipFlow.completion.confirmDelayedTitle")}
        subtitle={t("tipFlow.completion.confirmDelayedDesc")}
      />
    );
  }

  if (!ready || !context) {
    return null;
  }

  const businessId = context.businessId;

  const tipAnother = () => {
    clearCustomerFlowEntry();
    reset();
    if (businessId) {
      navigate(`/qr-landing/${encodeURIComponent(businessId)}`, { replace: true });
      return;
    }
    navigate("/", { replace: true });
  };

  const exit = () => {
    clearCustomerFlowEntry();
    reset();
    navigate("/", { replace: true });
  };

  return (
    <TipSuccessExperience
      venue={venueBrand}
      employee={employee}
      thankYouMessage={thankYouMessage}
      headline={t("tipFlow.success.celebrationHeadline")}
      tipAmount={tipAmount}
      receiptNumber={context.receiptNumber}
      primaryLabel={t("tipFlow.completion.tipAnotherMember")}
      secondaryLabel={t("tipFlow.completion.exit")}
      onPrimary={tipAnother}
      onSecondary={exit}
    />
  );
}
