import { useTranslation } from "react-i18next";

import { CountUpMetric } from "@/app/components/dashboard/CountUpMetric";
import { cn } from "@/lib/utils";

import type { ActivityCardSpec } from "./landingMotivationActivitySpecs";

type MotivationActivityCardContentProps = {
  card: ActivityCardSpec;
  badge: string;
  title: string;
  meta: string;
  time: string;
  animateMetrics?: boolean;
  compact?: boolean;
};

export function MotivationActivityCardTitle({
  card,
  title,
  animateMetrics = true,
}: {
  card: ActivityCardSpec;
  title: string;
  animateMetrics?: boolean;
}) {
  const { t } = useTranslation();
  const metric = card.titleMetric;

  if (!metric || !animateMetrics) {
    return <>{title}</>;
  }

  const before = metric.beforeKey ? t(metric.beforeKey) : "";
  const after = metric.afterKey ? t(metric.afterKey) : "";

  if (card.id === "tip") {
    return (
      <>
        <CountUpMetric value={metric.value} kind={metric.kind} durationMs={900} />
        {after}
      </>
    );
  }

  if (card.id === "dashboard") {
    return <>{title}</>;
  }

  if (card.id === "goal") {
    return (
      <>
        {before}
        <CountUpMetric value={metric.value} kind={metric.kind} durationMs={950} />
      </>
    );
  }

  return <>{title}</>;
}

export function MotivationActivityCardMeta({
  card,
  meta,
  animateMetrics = true,
}: {
  card: ActivityCardSpec;
  meta: string;
  animateMetrics?: boolean;
}) {
  const { t } = useTranslation();
  const metric = card.titleMetric;

  if (card.id === "dashboard" && metric && animateMetrics) {
    return (
      <>
        {t(metric.beforeKey!)}
        <CountUpMetric value={metric.value} kind={metric.kind} durationMs={850} />
        {metric.afterKey ? t(metric.afterKey) : null}
      </>
    );
  }

  if (card.id === "shift" && metric && animateMetrics) {
    return (
      <>
        {t(metric.beforeKey!)}
        <CountUpMetric value={metric.value} kind={metric.kind} durationMs={800} />
        {t(metric.afterKey!)}
      </>
    );
  }

  return <>{meta}</>;
}

export function MotivationActivityCardContent({
  card,
  badge,
  title,
  meta,
  time,
  animateMetrics = true,
  compact,
}: MotivationActivityCardContentProps) {
  return (
    <>
      <div className="caretip-motivation-activity__body-head">
        <p className="caretip-motivation-activity__badge">{badge}</p>
        <time className="caretip-motivation-activity__time" dateTime="PT0M">
          {time}
        </time>
      </div>
      <p
        className={cn(
          "caretip-motivation-activity__title",
          card.emphasis === "primary" && "caretip-motivation-activity__title--primary",
          compact && "caretip-motivation-activity__title--compact",
        )}
      >
        <MotivationActivityCardTitle card={card} title={title} animateMetrics={animateMetrics} />
      </p>
      <p className="caretip-motivation-activity__meta">
        <MotivationActivityCardMeta card={card} meta={meta} animateMetrics={animateMetrics} />
      </p>
    </>
  );
}
