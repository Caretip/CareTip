import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBerlinDateTime, physicalQrTimeline } from "@/app/lib/physicalQrOrderUi";
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
};

export function PhysicalQrOrderTimeline({ order }: { order: OrderLike }) {
  const { t, i18n } = useTranslation();
  const steps = physicalQrTimeline(order, t);

  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
              step.done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground",
            )}
            aria-hidden
          >
            {step.done ? <Check className="h-3 w-3" /> : null}
          </span>
          <div className="min-w-0">
            <p className={cn("text-sm font-medium", step.done ? "text-foreground" : "text-muted-foreground")}>
              {step.label}
            </p>
            <p className="text-xs text-muted-foreground">
              {step.at
                ? formatBerlinDateTime(step.at, i18n.language)
                : t("business.qrStudio.physical.orders.pending")}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
