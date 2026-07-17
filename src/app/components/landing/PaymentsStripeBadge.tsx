import { cn } from "@/lib/utils";
import { poweredByStripeBadgeUrl } from "@/app/components/landing/landingPaymentBrandAssets";

type PaymentsStripeBadgeProps = {
  /** Kept for API compatibility; official badge image is used. */
  label?: string;
  className?: string;
};

/** Official Powered by Stripe badge — no custom lockup or pill chrome. */
export function PaymentsStripeBadge({ className }: PaymentsStripeBadgeProps) {
  return (
    <img
      src={poweredByStripeBadgeUrl}
      alt="Powered by Stripe"
      className={cn("caretip-payments-accepted__stripe-badge", className)}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}
