import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { BillingTimelineEvent } from "../../../../lib/api";

const TIMELINE_ICON_TYPES = new Set([
  "subscription_created",
  "stripe_subscription_created",
  "checkout_session_completed",
]);

const TIER_RANK: Record<string, number> = {
  basic: 0,
  premium: 1,
  enterprise: 2,
};

function formatWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function eventLabelKey(auditType: string): string {
  return `business.billing.timeline.${auditType}`;
}

function resolveEventTitle(event: BillingTimelineEvent, t: TFunction): string {
  const payload = event.payload;
  const auditType = event.auditType;

  if (auditType === "stripe_subscription_updated") {
    const status = typeof payload?.status === "string" ? payload.status : null;
    if (status === "trialing") {
      return t("business.billing.timeline.trial_started");
    }
    if (status === "canceled") {
      return t("business.billing.timeline.cancellation");
    }
    if (payload?.cancelAtPeriodEnd === true) {
      return t("business.billing.timeline.cancellation_scheduled");
    }
  }

  if (auditType === "subscription_plan_changed" && payload) {
    const prev = typeof payload.previousTier === "string" ? payload.previousTier : null;
    const next = typeof payload.newTier === "string" ? payload.newTier : null;
    if (prev && next) {
      const prevRank = TIER_RANK[prev] ?? 0;
      const nextRank = TIER_RANK[next] ?? 0;
      if (nextRank > prevRank) {
        return t("business.billing.timeline.plan_upgraded");
      }
      if (nextRank < prevRank) {
        return t("business.billing.timeline.plan_downgraded");
      }
    }
  }

  if (auditType === "checkout_session_completed" && payload?.status === "trialing") {
    return t("business.billing.timeline.trial_started");
  }

  const labelKey = eventLabelKey(auditType);
  const label = t(labelKey);
  return label !== labelKey ? label : auditType;
}

export function BillingTimeline({ events }: { events: BillingTimelineEvent[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("de") ? "de-DE" : "en-GB";

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {t("business.billing.timelineEmpty")}
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const title = resolveEventTitle(event, t);
        const isMilestone = TIMELINE_ICON_TYPES.has(event.auditType);

        return (
          <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
            {index < events.length - 1 ? (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-border"
                aria-hidden
              />
            ) : null}
            <span
              className={`relative z-[1] mt-1 h-[22px] w-[22px] shrink-0 rounded-full border-2 ${
                isMilestone ? "border-primary bg-primary/10" : "border-border bg-muted"
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{formatWhen(event.occurredAt, locale)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
