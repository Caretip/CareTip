import { motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Users } from "lucide-react";
import { BusinessLogoMark } from "../../components/business/BusinessLogoMark";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { CustomerJourneyCareTipAttribution } from "./CustomerJourneyCareTipAttribution";
import type { CustomerJourneyVenueBrand } from "./customerJourneyBrand";
import { guestBrandAccentColor } from "../../lib/businessBranding";
import { formatEur } from "../../lib/formatEur";
import {
  guestSuccessPageStyle,
  guestSuccessPrimaryButtonStyle,
} from "./guestBrandingPresentation";
import type { TipSuccessEmployeeProfile } from "./useTipSuccessEmployeeProfile";
import { customerFlowUi as cf } from "./customerFlowUi";
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
      className={cn(
        "customer-flow-success-hero relative mx-auto flex items-center justify-center",
        compact ? "mb-2.5 size-[4rem] sm:mb-3 sm:size-[4.5rem]" : "mb-3 size-[5rem] sm:mb-3.5 sm:size-[5.5rem]",
      )}
      initial={reduceMotion ? false : { scale: 0.82, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.08 }}
      aria-hidden
    >
      <span
        className={cn(
          "customer-flow-success-hero__icon flex items-center justify-center rounded-full",
          compact ? "size-[3.25rem] sm:size-[3.5rem]" : "size-[4rem] sm:size-[4.5rem]",
        )}
        style={{
          background: `linear-gradient(145deg, ${accent} 0%, #e9781c 55%, #c45f12 100%)`,
          boxShadow: `0 14px 32px -12px ${accent}88, 0 0 0 8px ${accent}14`,
        }}
      >
        <Check className={cn("text-white", compact ? "size-6 sm:size-7" : "size-8 sm:size-9")} strokeWidth={2.75} />
      </span>
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
  supportingText,
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
  const venueContextLine = venue.contextLine || supportingText?.trim() || null;
  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { y: 12, opacity: 0 },
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

  return (
    <div
      className={cn(
        "customer-flow customer-flow-success-page",
        embedded ? "customer-flow-success-page--embedded min-h-0" : "min-h-[100dvh]",
      )}
      style={guestSuccessPageStyle(branding)}
    >
      {!embedded ? (
        <div className="customer-flow-success-ambient" style={{ "--success-accent": accent } as CSSProperties} aria-hidden />
      ) : null}

      <div
        className={cn(
          "caretip-container relative z-[1] mx-auto flex w-full max-w-lg flex-col items-center justify-center px-4",
          embedded ? "py-4 sm:px-5 sm:py-5" : "min-h-[100dvh] justify-center py-5 sm:px-6 sm:py-8",
        )}
      >
        <motion.article
          className="customer-flow-success-surface w-full"
          style={{ "--success-accent": accent } as CSSProperties}
          {...fadeUp}
          transition={{ delay: 0.08, duration: 0.35 }}
        >
          <header className="customer-flow-success-surface__brand text-center">
            <BusinessLogoMark
              logoPathOrUrl={venue.logo ?? null}
              businessName={venue.name}
              size="header"
              className={cn("mx-auto", embedded ? "mb-1.5" : "mb-2")}
            />
            <p className="customer-flow-success-surface__venue">{venue.name}</p>
            {venueContextLine ? (
              <div className="customer-flow-success-surface__venue-context">{venueContextLine}</div>
            ) : null}
          </header>

          <motion.section
            className={cn("customer-flow-success-confirmation text-center", embedded ? "mt-3" : "mt-4")}
            aria-labelledby="tip-success-headline"
            {...fadeUp}
            transition={{ delay: 0.1, duration: 0.35 }}
          >
            <SuccessHeroIcon accent={accent} compact={embedded} />
            <p className="customer-flow-success-surface__status">{t("tipFlow.success.paymentSuccessful")}</p>
            <h2 id="tip-success-headline" className="customer-flow-success-surface__headline">
              {displayHeadline}
            </h2>
            <p className="customer-flow-success-surface__thankyou">{thankYouMessage}</p>
          </motion.section>

          <motion.section
            className={cn("customer-flow-success-recipient", embedded ? "mt-4" : "mt-5")}
            aria-label={t("tipFlow.success.recipientSummaryAria")}
            {...fadeUp}
            transition={{ delay: 0.16, duration: 0.35 }}
          >
            <p className="customer-flow-success-recipient__label">
              {t("tipFlow.success.recipientLabel")}
            </p>
            <div className="customer-flow-success-recipient__row">
              <ProfileAvatar
                src={employee.avatar}
                displayName={employee.name}
                className={cn(
                  "customer-flow-success-recipient__avatar shrink-0 ring-2",
                  embedded ? "h-10 w-10" : "h-11 w-11 sm:h-12 sm:w-12",
                )}
                lightbox={false}
              />
              <div className="min-w-0 text-left">
                <p className="customer-flow-success-recipient__name">{employee.name}</p>
                {employee.role ? (
                  <p className="customer-flow-success-recipient__role">{employee.role}</p>
                ) : null}
              </div>
            </div>
          </motion.section>

          {showReceipt && receiptNumber ? (
            <motion.div
              className={cn(embedded ? "mt-4" : "mt-5")}
              {...fadeUp}
              transition={{ delay: 0.22, duration: 0.35 }}
            >
              <CollapsibleReceipt
                receiptNumber={receiptNumber}
                tipAmount={tipAmount}
                embedded={embedded}
              />
            </motion.div>
          ) : tipAmount != null && tipAmount > 0 ? (
            <motion.p
              className={cn(
                "text-center text-sm text-muted-foreground",
                embedded ? "mt-4" : "mt-5",
              )}
              {...fadeUp}
              transition={{ delay: 0.22, duration: 0.35 }}
            >
              {t("tipFlow.success.tipAmount")}:{" "}
              <span className="font-semibold tabular-nums text-foreground">{formatEur(tipAmount)}</span>
            </motion.p>
          ) : null}

          <div className={cn(cf.completionActions, embedded ? "mt-5" : "mt-6")}>
            <button
              type="button"
              onClick={() => runAction("primary", onPrimary)}
              disabled={actionBusy != null || embedded}
              className={cn(
                "customer-flow-success-primary-btn",
                actionBusy === "primary" && "customer-flow-success-primary-btn--busy",
              )}
              style={guestSuccessPrimaryButtonStyle(branding)}
              tabIndex={embedded ? -1 : undefined}
              aria-disabled={embedded || actionBusy != null || undefined}
              aria-busy={actionBusy === "primary"}
            >
              {actionBusy === "primary" ? (
                <LoadingSpinner size="sm" className="shrink-0 text-white" />
              ) : (
                primaryIcon ?? <Users className="size-5 shrink-0" aria-hidden />
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
              {actionBusy === "secondary" ? (
                <LoadingSpinner size="sm" className="shrink-0" />
              ) : null}
              {secondaryLabel}
            </button>
          </div>
        </motion.article>

        {showAttribution && !embedded ? (
          <div className="mt-5 w-full max-w-md sm:mt-6">
            <CustomerJourneyCareTipAttribution label={t("tipFlow.common.poweredByCareTip")} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
