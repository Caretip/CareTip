import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
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
import { ProfileAvatar } from "../../components/ui/profile-avatar";

/** Canonical English values sent to the API; labels are translated in the UI. */
const FEEDBACK_TAGS = [
  { key: "excellentService", api: "Excellent service" },
  { key: "veryFriendly", api: "Very friendly" },
  { key: "fastProfessional", api: "Fast and professional" },
  { key: "attentive", api: "Attentive" },
] as const;

const COMMENT_MAX = 1500;

export function RatingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { employeeName, employeeAvatar, reset, businessId: tipFlowBusinessId } = useTipFlow();

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
  const venueFetched = useCustomerVenueBrand(
    readyContext?.businessId ?? tipFlowBusinessId,
    t("tipFlow.common.venue"),
  );
  const venueBrand = useMemo(
    () => ({ ...venueFetched, tagline: undefined, contextLine: undefined }),
    [venueFetched],
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
  const displayEmployeeAvatar = readyContext?.employee?.avatar ?? employeeAvatar ?? null;
  const showVerifyingPayment =
    Boolean(sessionId) &&
    (verification.phase === "pending" || verification.phase === "timeout");

  if (sessionId && (verification.phase === "loading" || verification.phase === "pending")) {
    return (
      <CustomerFlowShell
        venue={venueBrand}
        loading
        loadingContext="stripeReturn"
        loadingRegistrationKey="rating-page-verification"
      />
    );
  }

  if (sessionId && verification.phase === "timeout") {
    return (
      <CustomerFlowShell venue={venueBrand} stepTitle={t("tipFlow.completion.confirmDelayedTitle")}>
        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          {t("tipFlow.completion.confirmDelayedDesc")}
        </p>
      </CustomerFlowShell>
    );
  }

  return (
    <CustomerFlowShell venue={venueBrand} mainClassName={cf.mainCompact}>
      {!sessionId ? (
        <p className="text-center text-sm text-muted-foreground">{t("tipFlow.rating.needsSession")}</p>
      ) : null}

      <div className="flex flex-col items-center text-center">
        <ProfileAvatar
          src={displayEmployeeAvatar}
          displayName={displayEmployeeName}
          variant="square"
          lightbox={false}
          className={`h-16 w-16 sm:h-[4.25rem] sm:w-[4.25rem] ${cf.employeePhotoSquare}`}
        />
        <p className="mt-2.5 text-base font-semibold leading-tight text-foreground">{displayEmployeeName}</p>
      </div>

      <section className="space-y-2.5 text-center" aria-label={t("tipFlow.rating.experiencePrompt")}>
        <h2 className="text-sm font-medium text-foreground">{t("tipFlow.rating.experiencePrompt")}</h2>
        {showVerifyingPayment ? (
          <p className="text-xs text-muted-foreground">{t("common.loading.stripeReturn")}</p>
        ) : null}
        <div
          className="flex items-center justify-center gap-0.5 sm:gap-1"
          role="radiogroup"
          aria-label={t("tipFlow.rating.experiencePrompt")}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const selected = star <= rating && rating > 0;
            return (
              <button
                key={star}
                onClick={() => setRating(star)}
                className={cf.starButton}
                type="button"
                role="radio"
                aria-label={t("tipFlow.rating.starAria", { n: star })}
                aria-checked={selected}
              >
                <Star
                  className={[
                    "size-10 transition-colors sm:size-11",
                    selected ? "fill-primary text-primary" : "text-muted-foreground/50",
                  ].join(" ")}
                />
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label={t("tipFlow.rating.quickCompliments")}>
        {FEEDBACK_TAGS.map(({ key, api }) => {
          const on = selectedTags.includes(api);
          return (
            <button
              key={api}
              onClick={() => handleTagToggle(api)}
              className={`${cf.tagChip} ${on ? cf.tagChipOn : cf.tagChipIdle}`}
              type="button"
              aria-pressed={on}
            >
              {t(`tipFlow.rating.tags.${key}`)}
            </button>
          );
        })}
      </div>

      <div>
        <textarea
          id="rating-note"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
          placeholder={t("tipFlow.rating.notePlaceholder")}
          rows={2}
          maxLength={COMMENT_MAX}
          aria-label={t("tipFlow.rating.optionalNote")}
          className={`${cf.inputField} min-h-[4.5rem] resize-none py-2.5 text-sm leading-relaxed`}
        />
      </div>

      <div className={`${cf.completionActions} pt-1`}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || showVerifyingPayment}
          className={`${cf.completionPrimaryBtn} whitespace-nowrap disabled:pointer-events-none disabled:opacity-50`}
        >
          {submitting ? t("tipFlow.rating.submitting") : t("tipFlow.rating.submit")}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className={cf.completionTextAction}
          aria-label={t("tipFlow.rating.skipAria")}
        >
          {t("tipFlow.rating.skip")}
        </button>
      </div>
    </CustomerFlowShell>
  );
}
