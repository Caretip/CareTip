import { cn } from "@/lib/utils";
import {
  getLandingPaymentBrands,
  poweredByStripeBadgeUrl,
} from "@/app/components/landing/landingPaymentBrandAssets";

type PaymentsAcceptedMarksProps = {
  className?: string;
  methodsAria: string;
  stripeAria?: string;
};

/**
 * Accepted payment brands + smaller Powered by Stripe badge.
 * Official SVGs only — no effects, pills, or recreation.
 */
export function PaymentsAcceptedMarks({
  className,
  methodsAria,
  stripeAria,
}: PaymentsAcceptedMarksProps) {
  const brands = getLandingPaymentBrands();

  return (
    <div className={cn("caretip-payments-accepted", className)}>
      <ul className="caretip-payments-accepted__methods" aria-label={methodsAria}>
        {brands.map((brand) => (
          <li key={brand.id} className="caretip-payments-accepted__item">
            <img
              src={brand.src}
              alt={brand.label}
              className={cn(
                "caretip-payments-accepted__logo",
                `caretip-payments-accepted__logo--${brand.id}`,
              )}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </li>
        ))}
      </ul>

      <div className="caretip-payments-accepted__stripe" aria-label={stripeAria}>
        <img
          src={poweredByStripeBadgeUrl}
          alt="Powered by Stripe"
          className="caretip-payments-accepted__stripe-badge"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </div>
    </div>
  );
}
