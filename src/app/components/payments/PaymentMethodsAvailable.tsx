import { useTranslation } from "react-i18next";
import { PaymentMethodMark } from "./payment-method-marks";
import type { PaymentMethodMarkId } from "./paymentLogoAssets";
import { customerFlowUi as cf } from "@/app/pages/customer/customerFlowUi";
import { cn } from "@/lib/utils";

const METHOD_IDS: PaymentMethodMarkId[] = ["apple-pay", "google-pay", "card"];

const METHOD_I18N: Record<PaymentMethodMarkId, string> = {
  "apple-pay": "applePay",
  "google-pay": "googlePay",
  card: "card",
};

type PaymentMethodsAvailableProps = {
  className?: string;
};

/**
 * Informational payment methods list — selection happens on Stripe Checkout.
 * Not interactive; avoids implying a pre-checkout method choice.
 */
export function PaymentMethodsAvailable({ className }: PaymentMethodsAvailableProps) {
  const { t } = useTranslation();

  return (
    <ul className={cn("space-y-2.5", className)} aria-label={t("tipFlow.payment.methodsAria")}>
      {METHOD_IDS.map((id) => (
        <li key={id} className={cn(cf.paymentMethodRow, cf.paymentMethodOff, "cursor-default")}>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-[#fafaf8] p-1.5 sm:h-11 sm:w-11 dark:bg-muted/40",
            )}
            aria-hidden
          >
            <PaymentMethodMark id={id} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="font-semibold text-foreground">
              {t(`tipFlow.payment.methods.${METHOD_I18N[id]}`)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
