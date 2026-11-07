import { motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lock } from "lucide-react";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { BusinessLogoMark } from "../../components/business/BusinessLogoMark";
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
  extraActions?: ReactNode;
  showReceipt?: boolean;
  /** Compact layout for manager branding previews. */
  embedded?: boolean;
  showAttribution?: boolean;
};

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
  extraActions,
  showReceipt = false,
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
          className="customer-flow-success-surface tip-thanks w-full text-center"
          style={{ "--success-accent": accent } as CSSProperties}
        >
          {venue.logo || venue.name ? (
            <div className="tip-thanks__venue">
              {venue.logo ? (
                <BusinessLogoMark
                  logoPathOrUrl={venue.logo}
                  businessName={venue.name}
                  size="sm"
                  className="tip-thanks__venue-logo"
                />
              ) : null}
              <span className="truncate">{venue.name}</span>
            </div>
          ) : null}

          <motion.section
            aria-labelledby="tip-success-headline"
            {...fadeUp}
            transition={{ delay: 0.06, duration: 0.3 }}
          >
            <motion.div
              className={cn("tip-thanks__portrait", embedded && "tip-thanks__portrait--compact")}
              initial={reduceMotion ? false : { scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.04 }}
            >
              <ProfileAvatar
                src={employee.avatar}
                displayName={employee.name}
                variant="square"
                className="tip-thanks__photo"
                lightbox={false}
              />
              <span className="tip-thanks__badge" aria-hidden>
                <Check strokeWidth={3} />
              </span>
              <span className="tip-thanks__spark tip-thanks__spark--a" aria-hidden />
              <span className="tip-thanks__spark tip-thanks__spark--b" aria-hidden />
              <span className="tip-thanks__spark tip-thanks__spark--c" aria-hidden />
            </motion.div>
            <p className="tip-thanks__status">
              <span className="tip-thanks__status-dot" aria-hidden />
              {t("tipFlow.success.paymentSuccessful")}
            </p>
            <h1 id="tip-success-headline" className="customer-flow-success-surface__headline tip-thanks__headline">
              {displayHeadline}
            </h1>
            <p className="customer-flow-success-surface__thankyou tip-thanks__message">{thankYouMessage}</p>
          </motion.section>

          <motion.section
            className={cn("tip-thanks__card", embedded ? "mt-5" : "mt-7")}
            aria-label={t("tipFlow.success.recipientSummaryAria")}
            {...fadeUp}
            transition={{ delay: 0.12, duration: 0.3 }}
          >
            <div className="tip-thanks__row">
              <span className="tip-thanks__label">{t("tipFlow.success.recipientLabel")}</span>
              <span className="tip-thanks__value">
                <span className="truncate">{employee.name}</span>
                {employee.role ? <span className="tip-thanks__role truncate">{employee.role}</span> : null}
              </span>
            </div>
            {tipAmount != null && tipAmount > 0 ? (
              <div className="tip-thanks__row">
                <span className="tip-thanks__label">{t("tipFlow.success.tipAmount")}</span>
                <span className="tip-thanks__amount tabular-nums">{formatEur(tipAmount)}</span>
              </div>
            ) : null}
            {showReceipt && receiptNumber ? (
              <div className="tip-thanks__receipt">
                <CollapsibleReceipt receiptNumber={receiptNumber} tipAmount={tipAmount} embedded={embedded} />
              </div>
            ) : null}
            <p className="tip-thanks__secure">
              <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              {t("tipFlow.success.trustPoweredBy")}
            </p>
          </motion.section>

          {!embedded && !showReceipt ? (
            <p className="customer-flow-success-surface__email-note tip-thanks__note">
              {t("tipFlow.success.emailReceipt")}
            </p>
          ) : null}

          {extraActions}

          <div className={cn(cf.journeyCtaStack, "mx-auto w-full", embedded ? "mt-5" : "mt-7")}>
            <button
              type="button"
              onClick={() => runAction("primary", onPrimary)}
              disabled={actionBusy != null || embedded}
              className={cn(cf.btnPrimaryLg, actionBusy === "primary" && "opacity-90")}
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
              className={cn(cf.btnSecondaryLg, actionBusy === "secondary" && "opacity-90")}
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
