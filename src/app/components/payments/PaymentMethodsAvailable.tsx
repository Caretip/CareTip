import { useTranslation } from "react-i18next";
import { PaymentMethodMark } from "./payment-method-marks";
import type { PaymentMethodMarkId } from "./paymentLogoAssets";
import { customerFlowUi as cf } from "@/app/pages/customer/customerFlowUi";
import { cn } from "@/lib/utils";

const METHOD_IDS: PaymentMethodMarkId[] = ["apple-pay", "google-pay", "card"];

const METHOD_I18N: Record<PaymentMethodMarkId, { name: string; desc: string }> = {
  "apple-pay": { name: "applePay", desc: "applePayDesc" },
  "google-pay": { name: "googlePay", desc: "googlePayDesc" },
  card: { name: "card", desc: "cardDesc" },
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
    <ul className={cn("space-y-3", className)} aria-label={t("tipFlow.payment.methodsAria")}>
      {METHOD_IDS.map((id, index) => (
        <li
          key={id}
          className={cn(
            cf.paymentMethodRow,
            cf.paymentMethodOff,
            index === 2 && cf.paymentMethodOn,
            "cursor-default active:scale-[0.99]",
          )}
        >
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-[#fafaf8] p-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] sm:h-14 sm:w-14 dark:bg-muted/40",
            )}
            aria-hidden
          >
            <PaymentMethodMark id={id} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="font-semibold text-foreground">
              {t(`tipFlow.payment.methods.${METHOD_I18N[id].name}`)}
            </div>
            <div className="text-sm text-muted-foreground">
              {t(`tipFlow.payment.methods.${METHOD_I18N[id].desc}`)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
