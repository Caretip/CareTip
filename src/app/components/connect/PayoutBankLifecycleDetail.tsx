import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  formatConnectPayoutAmount,
  formatConnectPayoutDate,
  payoutMethodI18nKey,
  sanitizePayoutFailureDisplay,
} from "../../lib/connectPayoutDisplay";
import {
  buildPayoutTimelineSteps,
  resolvePayoutInitiationPresentation,
  type PayoutInitiationKind,
} from "../../lib/connectPayoutTimeline";
import type { ConnectPayoutStatus } from "../../lib/api";
import { ConnectPayoutStatusBadge } from "./ConnectPayoutBadges";
import { cn } from "@/lib/utils";

export type PayoutBankLifecycleModel = {
  amountCents: number;
  currency: string;
  status: ConnectPayoutStatus | string;
  stripeCreatedAt: string;
  arrivalDate?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  canceledAt?: string | null;
  method?: string | null;
  payoutType?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  destinationLast4?: string | null;
  stripePayoutId?: string | null;
  initiationKind?: PayoutInitiationKind;
  bankPayoutSchedule?: string | null;
};

function formatDateOnly(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatDateRange(startIso: string, endIso: string, locale: string): string {
  const start = formatDateOnly(startIso, locale);
  const end = formatDateOnly(endIso, locale);
  if (start === end) return start;
  return `${start} – ${end}`;
}

function maskPayoutId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed.startsWith("po_")) return trimmed;
  if (trimmed.length <= 10) return trimmed;
  return `po_…${trimmed.slice(-4)}`;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-border/60 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function payoutTypeLabel(type: string | null | undefined, t: (k: string) => string): string | null {
  const raw = String(type ?? "").toLowerCase();
  if (raw === "bank_account") return t("business.billing.payouts.timeline.typeBankAccount");
  if (raw === "card") return t("business.billing.payouts.timeline.typeCard");
  return null;
}

export function PayoutBankLifecycleDetail({
  payout,
  locale,
  i18nPrefix = "business.billing.payouts",
}: {
  payout: PayoutBankLifecycleModel;
  locale: string;
  /** i18n root for timeline + status copy (business or employee namespace). */
  i18nPrefix?: string;
}) {
  const { t } = useTranslation();
  const steps = buildPayoutTimelineSteps(payout);
  const initiation = resolvePayoutInitiationPresentation({
    method: payout.method,
    initiationKind: payout.initiationKind ?? null,
    bankPayoutSchedule: payout.bankPayoutSchedule,
  });
  const failure =
    String(payout.status).toLowerCase() === "failed"
      ? sanitizePayoutFailureDisplay(payout.failureMessage) ||
        payout.failureCode ||
        t(`${i18nPrefix}.failedFallback`)
      : null;
  const showBankNote =
    payout.method !== "instant" &&
    initiation !== "instant" &&
    ["pending", "in_transit", "paid"].includes(String(payout.status).toLowerCase());

  const scheduleKey =
    payout.bankPayoutSchedule &&
    t(`business.billing.payouts.schedule.options.${payout.bankPayoutSchedule}`, {
      defaultValue: payout.bankPayoutSchedule,
    });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
        </p>
        <ConnectPayoutStatusBadge status={payout.status} />
        <p className="text-xs text-muted-foreground">{t(`${i18nPrefix}.timeline.statusLead`)}</p>
      </div>

      <ol className="caretip-payout-timeline space-y-0" aria-label={t(`${i18nPrefix}.timeline.aria`)}>
        {steps.map((step, index) => {
          const isFirst = index === 0;
          const titleKey = `${i18nPrefix}.timeline.step.${step.kind}`;
          let detail: string | null = null;
          if (step.kind === "initiated" && step.at) {
            detail = formatConnectPayoutDate(step.at, locale);
          } else if (step.kind === "completed" && step.at) {
            detail = formatDateOnly(step.at, locale);
          } else if (step.kind === "expected_arrival" && step.at) {
            detail = formatDateOnly(step.at, locale);
          } else if (step.kind === "in_transit" && step.rangeStart && step.rangeEnd) {
            detail = formatDateRange(step.rangeStart, step.rangeEnd, locale);
          } else if ((step.kind === "failed" || step.kind === "canceled") && step.at) {
            detail = formatConnectPayoutDate(step.at, locale);
          }

          return (
            <li
              key={`${step.kind}-${index}`}
              className={cn(
                "caretip-payout-timeline__step relative pl-5 pb-4 last:pb-0",
                isFirst ? "caretip-payout-timeline__step--current" : null,
              )}
            >
              <span className="caretip-payout-timeline__marker" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t(titleKey)}</p>
              {detail ? <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">{detail}</p> : null}
              {step.kind === "initiated" && initiation === "caretip_scheduled" && scheduleKey ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`${i18nPrefix}.timeline.scheduledByCareTip`, { schedule: scheduleKey })}
                </p>
              ) : null}
              {step.kind === "initiated" && initiation === "instant" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`${i18nPrefix}.timeline.instantCareTip`)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {showBankNote ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t(`${i18nPrefix}.timeline.bankProcessingNote`)}</p>
      ) : null}

      {failure ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {failure}
        </p>
      ) : null}

      <dl className="rounded-lg border border-border/70 bg-muted/20 px-3">
        {payout.destinationLast4 ? (
          <MetaRow label={t(`${i18nPrefix}.timeline.to`)}>
            {t(`${i18nPrefix}.timeline.destinationMasked`, { last4: payout.destinationLast4 })}
          </MetaRow>
        ) : null}
        <MetaRow label={t(`${i18nPrefix}.colAmount`)}>
          <span className="font-medium tabular-nums">
            {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
          </span>
        </MetaRow>
        {payoutTypeLabel(payout.payoutType, t) ? (
          <MetaRow label={t(`${i18nPrefix}.timeline.type`)}>{payoutTypeLabel(payout.payoutType, t)}</MetaRow>
        ) : null}
        <MetaRow label={t(`${i18nPrefix}.colMethod`)}>{t(payoutMethodI18nKey(payout.method))}</MetaRow>
        {payout.stripePayoutId ? (
          <MetaRow label={t(`${i18nPrefix}.timeline.payoutId`)}>
            <span className="font-mono text-xs break-all" title={payout.stripePayoutId}>
              {maskPayoutId(payout.stripePayoutId)}
            </span>
          </MetaRow>
        ) : null}
      </dl>
    </div>
  );
}
