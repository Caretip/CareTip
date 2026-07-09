import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lock, Receipt, ShieldCheck, Users } from "lucide-react";
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

function SuccessParticles({ accent }: { accent: string }) {
  const spots = [
    { left: "12%", top: "18%", delay: "0s", size: 6 },
    { left: "82%", top: "14%", delay: "0.4s", size: 5 },
    { left: "74%", top: "72%", delay: "0.8s", size: 7 },
    { left: "18%", top: "78%", delay: "1.1s", size: 4 },
    { left: "48%", top: "8%", delay: "0.6s", size: 5 },
  ];
  return (
    <div className="customer-flow-success-particles pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {spots.map((s, i) => (
        <span
          key={i}
          className="customer-flow-success-particle"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
            background: accent,
          }}
        />
      ))}
    </div>
  );
}

function SuccessHeroIcon({ accent, compact }: { accent: string; compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn(
        "customer-flow-success-hero relative mx-auto flex items-center justify-center",
        compact ? "mb-3 size-[4.5rem] sm:mb-4 sm:size-[5rem]" : "mb-4 size-[6rem] sm:mb-5 sm:size-[6.5rem]",
      )}
      initial={reduceMotion ? false : { scale: 0.82, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.08 }}
      aria-hidden
    >
      <span className="customer-flow-success-ripple customer-flow-success-ripple--1" style={{ borderColor: `${accent}40` }} />
      <span className="customer-flow-success-ripple customer-flow-success-ripple--2" style={{ borderColor: `${accent}28` }} />
      <span
        className="customer-flow-success-hero__glow"
        style={{ background: `radial-gradient(circle, ${accent}55 0%, transparent 70%)` }}
      />
      <span
        className={cn(
          "customer-flow-success-hero__icon flex items-center justify-center rounded-full",
          compact ? "size-[3.5rem] sm:size-[3.75rem]" : "size-[4.75rem] sm:size-[5.25rem]",
        )}
        style={{
          background: `linear-gradient(145deg, ${accent} 0%, #e9781c 55%, #c45f12 100%)`,
          boxShadow: `0 18px 40px -14px ${accent}88, 0 0 0 10px ${accent}14`,
        }}
      >
        <Check className={cn("text-white", compact ? "size-7 sm:size-8" : "size-10 sm:size-11")} strokeWidth={2.75} />
      </span>
    </motion.div>
  );
}

export function TipSuccessExperience({
  venue,
  employee,
  thankYouMessage,
  supportingText: _supportingText,
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
        initial: { y: 16, opacity: 0 },
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
        <>
          <div className="customer-flow-success-ambient" style={{ "--success-accent": accent } as React.CSSProperties} aria-hidden />
          <SuccessParticles accent={accent} />
        </>
      ) : null}

      <div
        className={cn(
          "caretip-container relative z-[1] mx-auto flex w-full max-w-lg flex-col items-center justify-center px-4",
          embedded ? "py-4 sm:px-5 sm:py-5" : "min-h-[100dvh] justify-center py-6 sm:px-6 sm:py-10",
        )}
      >
        <motion.article
          className="customer-flow-success-card w-full"
          style={{ "--success-accent": accent } as React.CSSProperties}
          {...fadeUp}
          transition={{ delay: 0.12, duration: 0.45 }}
        >
          <header className="customer-flow-success-card__brand text-center">
            <BusinessLogoMark
              logoPathOrUrl={venue.logo ?? null}
              businessName={venue.name}
              size="header"
              className={cn("mx-auto", embedded ? "mb-2" : "mb-2.5")}
            />
            <h1 className="customer-flow-success-card__venue">{venue.name}</h1>
          </header>

          <motion.section
            className={cn("customer-flow-success-confirmation text-center", embedded ? "mt-4" : "mt-4 sm:mt-5")}
            aria-labelledby="tip-success-headline"
            {...fadeUp}
            transition={{ delay: 0.14, duration: 0.4 }}
          >
            <SuccessHeroIcon accent={accent} compact={embedded} />
            <h2 id="tip-success-headline" className="customer-flow-success-card__headline">
              {displayHeadline}
            </h2>
            <p className="customer-flow-success-card__thankyou">{thankYouMessage}</p>
          </motion.section>

          <motion.section
            className={cn("customer-flow-success-recipient", embedded ? "mt-4" : "mt-5 sm:mt-6")}
            aria-label={t("tipFlow.success.recipientSummaryAria")}
            {...fadeUp}
            transition={{ delay: 0.22, duration: 0.4 }}
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

          {(tipAmount != null && tipAmount > 0) || showReceipt ? (
            <motion.div
              className={cn("customer-flow-success-summary", embedded ? "mt-5" : "mt-6 sm:mt-7")}
              {...fadeUp}
              transition={{ delay: 0.4, duration: 0.4 }}
            >
              {tipAmount != null && tipAmount > 0 ? (
                <div className="customer-flow-success-summary__amount-row">
                  <span className="customer-flow-success-summary__amount-label">
                    {t("tipFlow.success.tipAmount")}
                  </span>
                  <span className="customer-flow-success-summary__amount">{formatEur(tipAmount)}</span>
                </div>
              ) : null}
              <ul className="customer-flow-success-summary__meta">
                <li>
                  <ShieldCheck className="size-4 shrink-0 text-emerald-600/80 dark:text-emerald-400/90" aria-hidden />
                  {t("tipFlow.success.paymentCompleted")}
                </li>
                <li>
                  <Lock className="size-4 shrink-0 text-emerald-600/80 dark:text-emerald-400/90" aria-hidden />
                  {t("tipFlow.success.trustPoweredBy")}
                </li>
                {showReceipt && receiptNumber ? (
                  <li className="customer-flow-success-summary__receipt">
                    <Receipt className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate text-sm tabular-nums">
                      {t("tipFlow.success.receiptReference", { code: receiptNumber })}
                    </span>
                  </li>
                ) : null}
              </ul>
            </motion.div>
          ) : null}

          <div className={cn(cf.completionActions, embedded ? "mt-6" : "mt-7 sm:mt-8")}>
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

          {!embedded ? (
            <footer className="customer-flow-success-trust mt-6 text-center sm:mt-7">
              <p>{t("tipFlow.success.trustPoweredBy")}</p>
              <p>{t("tipFlow.success.trustCompleted")}</p>
            </footer>
          ) : null}
        </motion.article>

        {showAttribution && !embedded ? (
          <div className="mt-6 w-full max-w-md sm:mt-7">
            <CustomerJourneyCareTipAttribution label={t("tipFlow.common.poweredByCareTip")} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
