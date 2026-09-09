import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, Send, Star } from "lucide-react";
import { toast } from "sonner";
import { useTipFlow } from "../../context/TipFlowContext";
import { submitTipFeedback } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { clearCustomerFlowEntry } from "../../lib/customerFlowGuard";
import { customerFlowUi as cf } from "./customerFlowUi";
import { useVerifiedTipSession, isVerifiedTipSessionReady } from "../../hooks/useVerifiedTipSession";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { useCustomerVenueBrand } from "./customerJourneyBrand";

/** Canonical English values sent to the API; labels are translated in the UI. */
const FEEDBACK_TAGS = [
  { key: "excellentService", api: "Excellent service" },
  { key: "veryFriendly", api: "Very friendly" },
  { key: "fastProfessional", api: "Fast and professional" },
  { key: "attentive", api: "Attentive" },
  { key: "greatVibe", api: "Great vibe" },
  { key: "aboveBeyond", api: "Above and beyond" },
] as const;

export function RatingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { employeeName, reset, businessId: tipFlowBusinessId } = useTipFlow();

  const sessionId = searchParams.get("session_id")?.trim() ?? "";
  const isDevMockSession = DEV_BYPASS_ENABLED && (!sessionId || sessionId === DEV_MOCK.sessionId);
  const effectiveSessionId = isDevMockSession ? DEV_MOCK.sessionId : sessionId;

  const verification = useVerifiedTipSession(effectiveSessionId, {
    enabled: Boolean(effectiveSessionId.trim()),
    allowDevMock: isDevMockSession,
  });
  const sessionReady = isVerifiedTipSessionReady(verification);
  const readyContext = sessionReady ? verification.context : null;

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (isDevMockSession) return;
    if (!sessionId) {
      navigate("/", { replace: true });
    }
  }, [isDevMockSession, navigate, sessionId]);

  useEffect(() => {
    if (
      verification.phase === "expired" ||
      verification.phase === "unpaid" ||
      verification.phase === "failed"
    ) {
      toast.message(
        verification.phase === "failed"
          ? t("tipFlow.completion.paymentFailedTitle")
          : t("tipFlow.completion.notVerifiedTitle"),
        {
          description:
            verification.phase === "failed"
              ? t("tipFlow.completion.paymentFailedDesc")
              : t("tipFlow.completion.notVerifiedDesc"),
        },
      );
      navigate("/", { replace: true });
      return;
    }
    if (verification.phase === "timeout") {
      // Stripe may already have charged; tip ledger is late — do not call it "Payment not found".
      toast.message(t("tipFlow.completion.confirmDelayedTitle"), {
        description: t("tipFlow.completion.confirmDelayedDesc"),
      });
    }
  }, [navigate, t, verification.phase]);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const venueBrand = useCustomerVenueBrand(
    readyContext?.businessId ?? tipFlowBusinessId,
    t("tipFlow.common.venue"),
  );

  useEffect(() => {
    if (readyContext?.customerName) {
      setCustomerName(readyContext.customerName);
    }
  }, [readyContext?.customerName]);

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((item) => item !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const goToCompletion = (opts?: { feedbackSubmitted?: boolean }) => {
    if (!effectiveSessionId.trim()) {
      navigate("/", { replace: true });
      return;
    }

    const params = new URLSearchParams({ session_id: effectiveSessionId });
    if (opts?.feedbackSubmitted) params.set("feedbackSubmitted", "1");

    clearCustomerFlowEntry();
    reset();
    navigate(`/tip-complete?${params.toString()}`, { replace: true });
  };

  const handleSkip = () => {
    goToCompletion();
  };

  const handleSubmit = async () => {
    if (isDevMockSession) {
      goToCompletion({ feedbackSubmitted: true });
      return;
    }
    if (!sessionId) {
      toast.error(t("tipFlow.rating.missingSession"));
      navigate("/", { replace: true });
      return;
    }
    if (rating <= 0 && comment.trim().length === 0 && selectedTags.length === 0) {
      // Stay on page; Skip is available — no toast for empty optional feedback.
      return;
    }

    setSubmitting(true);
    try {
      await submitTipFeedback({
        sessionId,
        rating: rating > 0 ? rating : null,
        comment: comment.trim() ? comment.trim() : null,
        tags: selectedTags,
        customerName: customerName.trim() ? customerName.trim() : null,
      });
      goToCompletion({ feedbackSubmitted: true });
    } catch (err) {
      logClientError("RatingPage.submitTipFeedback", err);
      toast.error(toUserFriendlyMessage(err));
      setSubmitting(false);
    }
  };

  const displayEmployeeName =
    readyContext?.employee?.name ?? employeeName ?? t("tipFlow.common.aTeamMember");
  const showVerifyingPayment =
    Boolean(sessionId) &&
    (verification.phase === "pending" || verification.phase === "timeout");

  if (sessionId && (verification.phase === "loading" || verification.phase === "pending")) {
    return (
      <CustomerFlowShell
        venue={venueBrand}
        stepTitle={t("tipFlow.success.celebrationHeadline")}
        trustMessage={
          verification.phase === "pending"
            ? t("tipFlow.completion.processingSubtitle")
            : t("tipFlow.completion.tipSentTo", { name: displayEmployeeName })
        }
        loading
        loadingContext="stripeReturn"
        loadingRegistrationKey="rating-page-verification"
      />
    );
  }

  if (sessionId && verification.phase === "timeout") {
    return (
      <CustomerFlowShell
        venue={venueBrand}
        stepTitle={t("tipFlow.completion.confirmDelayedTitle")}
        trustMessage={t("tipFlow.completion.confirmDelayedDesc")}
      >
        <div className={`${cf.cardMuted} px-5 py-5 text-sm leading-relaxed text-muted-foreground sm:px-6`}>
          {t("tipFlow.completion.confirmDelayedBody")}
        </div>
      </CustomerFlowShell>
    );
  }

  return (
    <CustomerFlowShell
      withBottomCta
      venue={venueBrand}
      stepTitle={t("tipFlow.success.celebrationHeadline")}
      trustMessage={t("tipFlow.completion.tipSentTo", { name: displayEmployeeName })}
      bottomBar={
        <div className={cf.fixedBottomBar}>
          <div className={cf.fixedBottomInner}>
            <div className={cf.completionActions}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || showVerifyingPayment}
                className={`${cf.completionPrimaryBtn} disabled:pointer-events-none disabled:opacity-50`}
              >
                <Send className="size-5 shrink-0" aria-hidden />
                {submitting ? t("tipFlow.rating.submitting") : t("tipFlow.rating.submit")}
              </button>
              <button type="button" onClick={handleSkip} className={cf.completionTextAction}>
                {t("tipFlow.rating.skip")}
              </button>
            </div>
          </div>
        </div>
      }
    >
      {!sessionId ? (
        <p className="text-center text-sm text-muted-foreground">{t("tipFlow.rating.needsSession")}</p>
      ) : null}

      <section className="space-y-3 text-center" aria-label={t("tipFlow.rating.tapToRate")}>
        <h2 className={cf.surfaceSectionLabel}>{t("tipFlow.rating.tapToRate")}</h2>
        {showVerifyingPayment ? (
          <p className="text-xs text-muted-foreground">{t("common.loading.stripeReturn")}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              className={`${cf.starButton} ${star <= rating && rating > 0 ? cf.starButtonActive : ""}`}
              type="button"
              aria-label={t("tipFlow.rating.starAria", { n: star })}
              aria-pressed={star <= rating && rating > 0}
            >
              <Star
                className={[
                  "size-11 transition-colors sm:size-12",
                  star <= rating
                    ? "fill-primary text-primary"
                    : "text-muted-foreground/55",
                ].join(" ")}
              />
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-label={t("tipFlow.rating.quickCompliments")}>
        <h2 className={cf.surfaceSectionLabel}>{t("tipFlow.rating.quickCompliments")}</h2>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_TAGS.map(({ key, api }) => (
            <button
              key={api}
              onClick={() => handleTagToggle(api)}
              className={`${cf.tagPill} ${selectedTags.includes(api) ? cf.tagPillOn : cf.tagPillIdle}`}
              type="button"
              aria-pressed={selectedTags.includes(api)}
            >
              {t(`tipFlow.rating.tags.${key}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5 shrink-0 text-primary" aria-hidden />
          <h2 className={cf.surfaceSectionLabel}>{t("tipFlow.rating.optionalNote")}</h2>
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("tipFlow.rating.notePlaceholder")}
          rows={3}
          className={`${cf.inputField} resize-none leading-relaxed`}
        />
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="rating-customer-name">
            {t("tipFlow.rating.yourName")}
          </label>
          <input
            id="rating-customer-name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={t("tipFlow.rating.namePlaceholder")}
            className={`${cf.inputField} py-2.5 text-sm`}
          />
        </div>
      </section>
    </CustomerFlowShell>
  );
}
