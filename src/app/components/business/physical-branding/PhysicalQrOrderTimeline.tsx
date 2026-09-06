import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatBerlinDateCompact,
  physicalQrTimeline,
} from "@/app/lib/physicalQrOrderUi";
import { cn } from "@/lib/utils";

type OrderLike = {
  placedAt: string;
  paidAt?: string | null;
  processingAt?: string | null;
  printingAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalAmount?: number | null;
};

export function PhysicalQrOrderTimeline({
  order,
  currentDetail,
}: {
  order: OrderLike;
  currentDetail?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const steps = physicalQrTimeline(order, t);
  const firstPending = steps.findIndex((step) => !step.done);
  const currentIndex = firstPending === -1 ? steps.length - 1 : firstPending;

  return (
    <ol className="pq-progress" aria-label={t("business.qrStudio.physical.orders.progress")}>
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const stateLabel = step.done
          ? t("business.qrStudio.physical.orders.stepComplete")
          : isActive
            ? t("business.qrStudio.physical.orders.stepCurrent")
            : t("business.qrStudio.physical.orders.pending");

        return (
          <li
            key={step.id}
            className={cn(
              "pq-progress__step",
              step.done && "pq-progress__step--done",
              isActive && "pq-progress__step--current",
              !step.done && !isActive && "pq-progress__step--pending",
            )}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="pq-progress__marker" aria-hidden>
              {step.done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>
            <div className="pq-progress__copy min-w-0">
              <p className="pq-progress__label">{step.label}</p>
              <p className="pq-progress__meta">
                <span className="sr-only">{stateLabel}. </span>
                {step.at
                  ? formatBerlinDateCompact(step.at, i18n.language)
                  : isActive
                    ? t("business.qrStudio.physical.orders.stepCurrent")
                    : t("business.qrStudio.physical.orders.pending")}
              </p>
              {isActive && currentDetail ? <p className="pq-progress__detail">{currentDetail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
