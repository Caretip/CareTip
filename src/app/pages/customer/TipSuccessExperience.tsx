import { motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { CustomerJourneyCareTipAttribution } from "./CustomerJourneyCareTipAttribution";
import type { CustomerJourneyVenueBrand } from "./customerJourneyBrand";
import { guestBrandAccentColor } from "../../lib/businessBranding";
import { formatEur } from "../../lib/formatEur";
import { guestSuccessPageStyle } from "./guestBrandingPresentation";
import type { TipSuccessEmployeeProfile } from "./useTipSuccessEmployeeProfile";
import { customerFlowUi as cf } from "./customerFlowUi";
import { usePublicHtmlBootHandoff } from "../../lib/usePublicHtmlBootHandoff";
import { cn } from "@/lib/utils";

export type TipSuccessExperienceProps = {
  venue: CustomerJourneyVenueBrand;
  employee: TipSuccessEmployeeProfile;
  thankYouMessage: string;
  /** Completion-focused line under the venue name (not the QR landing welcome). */
  supportingText?: string | null;
  headline?: string;
  tipAmount?: number | null;
  /** Customer-facing receipt reference from the server (e.g. CT-26-A8K4P9X2). */
  receiptNumber?: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryIcon?: ReactNode;
  showReceipt?: boolean;
  /** Compact layout for manager branding previews. */
  embedded?: boolean;
  showAttribution?: boolean;
};

function SuccessHeroIcon({ accent, compact }: { accent: string; compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn("mx-auto flex items-center justify-center", compact ? "mb-2" : "mb-3")}
      initial={reduceMotion ? false : { scale: 0.88, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 24, delay: 0.06 }}
      aria-hidden
    >
      <Check
        className={cn(compact ? "size-8" : "size-9 sm:size-10")}
        strokeWidth={2.5}
        style={{ color: accent }}
      />
    </motion.div>
  );
}

function CollapsibleReceipt({
  receiptNumber,
  tipAmount,
  embedded,
}: {
  receiptNumber: string;
  tipAmount?: number | null;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="customer-flow-success-receipt">
      <button
        type="button"
        className="customer-flow-success-receipt__link"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t("tipFlow.success.hideReceipt") : t("tipFlow.success.viewReceipt")}
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={t("tipFlow.success.receipt")}
        hidden={!open}
        className={cn("customer-flow-success-receipt__panel", open && "is-open")}
      >
        <p className={cn("customer-flow-success-receipt__number", embedded && "text-sm")}>
          {t("tipFlow.success.receiptReference", { code: receiptNumber })}
        </p>
        {tipAmount != null && tipAmount > 0 ? (
          <p className="customer-flow-success-receipt__amount">
            {t("tipFlow.success.tipAmount")}:{" "}
            <span className="tabular-nums font-semibold">{formatEur(tipAmount)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TipSuccessExperience({
  venue,
  employee,
  thankYouMessage,
  headline,
  tipAmount,
  receiptNumber,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryIcon,
  showReceipt = true,
  embedded = false,
  showAttribution = true,
}: TipSuccessExperienceProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [actionBusy, setActionBusy] = useState<"primary" | "secondary" | null>(null);
  const branding = venue.branding;
  const accent = guestBrandAccentColor(branding);
  const displayHeadline = headline ?? t("tipFlow.success.celebrationHeadline");
  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { y: 10, opacity: 0 },
        animate: { y: 0, opacity: 1 },
      };

  const runAction = useCallback(
    (which: "primary" | "secondary", fn: () => void) => {
      if (embedded || actionBusy) return;
      setActionBusy(which);
      fn();
    },
    [actionBusy, embedded],
  );

  usePublicHtmlBootHandoff(!embedded);

  return (
    <div
      {...(!embedded ? { "data-caretip-route-ready": "" } : {})}
      className={cn(
        "customer-flow customer-flow--compact customer-flow-success-page",
        embedded ? "customer-flow-success-page--embedded min-h-0" : "min-h-[100dvh]",
      )}
      style={guestSuccessPageStyle(branding)}
    >
      <div
        className={cn(
          "caretip-container relative z-[1] mx-auto flex w-full max-w-md flex-col items-center px-4",
          embedded ? "py-4 sm:px-5 sm:py-5" : "min-h-[100dvh] justify-center py-8 sm:px-6 sm:py-10",
        )}
      >
        <div
          className="customer-flow-success-surface w-full text-center"
          style={{ "--success-accent": accent } as CSSProperties}
        >
          <motion.section
            aria-labelledby="tip-success-headline"
            {...fadeUp}
            transition={{ delay: 0.06, duration: 0.3 }}
          >
            <SuccessHeroIcon accent={accent} compact={embedded} />
            <h1 id="tip-success-headline" className="customer-flow-success-surface__headline">
              {displayHeadline}
            </h1>
            <p className="customer-flow-success-surface__thankyou">{thankYouMessage}</p>
          </motion.section>

          <motion.section
            className={cn("customer-flow-success-recipient", embedded ? "mt-5" : "mt-7")}
            aria-label={t("tipFlow.success.recipientSummaryAria")}
            {...fadeUp}
            transition={{ delay: 0.12, duration: 0.3 }}
          >
            <ProfileAvatar
              src={employee.avatar}
              displayName={employee.name}
              variant="square"
              className={cn(
                "customer-flow-success-recipient__avatar mx-auto shrink-0",
                cf.employeePhotoSquare,
                embedded ? "h-14 w-14" : "h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]",
              )}
              lightbox={false}
            />
            <p className="customer-flow-success-recipient__name mt-2.5 truncate">{employee.name}</p>
            {employee.role ? (
              <p className="customer-flow-success-recipient__role truncate">{employee.role}</p>
            ) : null}
          </motion.section>

          {showReceipt && receiptNumber ? (
            <motion.div
              className={cn(embedded ? "mt-4" : "mt-5")}
              {...fadeUp}
              transition={{ delay: 0.16, duration: 0.3 }}
            >
              <CollapsibleReceipt
                receiptNumber={receiptNumber}
                tipAmount={tipAmount}
                embedded={embedded}
              />
            </motion.div>
          ) : tipAmount != null && tipAmount > 0 ? (
            <motion.p
              className={cn("text-center text-sm text-muted-foreground", embedded ? "mt-4" : "mt-5")}
              {...fadeUp}
              transition={{ delay: 0.16, duration: 0.3 }}
            >
              {t("tipFlow.success.tipAmount")}:{" "}
              <span className="font-semibold tabular-nums text-foreground">{formatEur(tipAmount)}</span>
            </motion.p>
          ) : null}

          <div className={cn(cf.completionActions, embedded ? "mt-5" : "mt-7")}>
            <button
              type="button"
              onClick={() => runAction("primary", onPrimary)}
              disabled={actionBusy != null || embedded}
              className={cn(
                "customer-flow-success-primary-btn",
                actionBusy === "primary" && "customer-flow-success-primary-btn--busy",
              )}
              style={{ backgroundColor: accent, borderColor: accent }}
              tabIndex={embedded ? -1 : undefined}
              aria-disabled={embedded || actionBusy != null || undefined}
              aria-busy={actionBusy === "primary"}
            >
              {actionBusy === "primary" ? (
                <LoadingSpinner size="sm" className="shrink-0 text-white" />
              ) : (
                primaryIcon
              )}
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={() => runAction("secondary", onSecondary)}
              disabled={actionBusy != null || embedded}
              className={cn(
                "customer-flow-success-secondary-btn",
                actionBusy === "secondary" && "customer-flow-success-secondary-btn--busy",
              )}
              tabIndex={embedded ? -1 : undefined}
              aria-disabled={embedded || actionBusy != null || undefined}
              aria-busy={actionBusy === "secondary"}
            >
              {actionBusy === "secondary" ? <LoadingSpinner size="sm" className="shrink-0" /> : null}
              {secondaryLabel}
            </button>
          </div>
        </div>

        {showAttribution && !embedded ? (
          <div className="mt-8 w-full max-w-md sm:mt-10">
            <CustomerJourneyCareTipAttribution label={t("tipFlow.common.poweredByCareTip")} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
