import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatBerlinDateTime,
  physicalQrStatusDotClasses,
  physicalQrTimeline,
  physicalQrTimelineStepTone,
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

export function PhysicalQrOrderTimeline({ order }: { order: OrderLike }) {
  const { t, i18n } = useTranslation();
  const steps = physicalQrTimeline(order, t);
  const activeIndex = steps.findIndex((step) => !step.done);

  return (
    <ol className="space-y-3">
      {steps.map((step, index) => {
        const tone = physicalQrTimelineStepTone(step.id);
        const isActive = activeIndex === index;
        return (
          <li key={step.id} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors",
                physicalQrStatusDotClasses(tone, { done: step.done, active: isActive }),
              )}
              aria-hidden
            >
              {step.done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  step.done || isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {step.at
                  ? formatBerlinDateTime(step.at, i18n.language)
                  : t("business.qrStudio.physical.orders.pending")}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
