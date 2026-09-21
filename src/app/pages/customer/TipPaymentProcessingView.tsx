import { useTranslation } from "react-i18next";
import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
import { customerFlowUi as cf } from "./customerFlowUi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerFlowShell } from "./CustomerFlowShell";
import type { CustomerJourneyVenueBrand } from "./customerJourneyBrand";
import { headerConfirmingTipFor } from "./customerJourneyHeaderCopy";

type TipPaymentProcessingViewProps = {
  title?: string;
  subtitle?: string;
  venue?: CustomerJourneyVenueBrand;
  /** When known, title reads "Confirming tip for {{name}}". */
  employeeName?: string | null;
  /** Restart backend verification polling after a timeout. */
  onRetry?: () => void;
  /** Leave the guest flow (e.g. return home). */
  onReturnHome?: () => void;
};

/** Post-checkout state while the backend confirms Stripe payment. */
export function TipPaymentProcessingView({
  title,
  subtitle,
  venue,
  employeeName,
  onRetry,
  onReturnHome,
}: TipPaymentProcessingViewProps) {
  const { t } = useTranslation();
  const unified = headerConfirmingTipFor(t, employeeName);
  const resolvedTitle = title ?? unified.stepTitle;
  const resolvedSubtitle = subtitle ?? unified.trustMessage;
  const resolvedVenue = venue ?? { name: t("tipFlow.common.venue"), logo: null };

  return (
    <CustomerFlowShell
      venue={resolvedVenue}
      stepTitle={resolvedTitle}
      trustMessage={resolvedSubtitle}
      mainClassName={`${cf.main} max-w-lg py-10 sm:py-14`}
    >
      <Card className={cf.completionCard}>
        <CardContent className="space-y-5 p-6 text-center sm:p-8">
          <div className="mx-auto flex justify-center py-1" aria-hidden>
            <CareTipBrandedLoaderMark compact showTagline={false} />
          </div>
          <p className="sr-only">{resolvedSubtitle}</p>
          {onRetry || onReturnHome ? (
            <div className="space-y-3 pt-2">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("tipFlow.completion.confirmDelayedBody")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                {onRetry ? (
                  <Button type="button" className="min-h-[44px]" onClick={onRetry}>
                    {t("common.tryAgain")}
                  </Button>
                ) : null}
                {onReturnHome ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={onReturnHome}
                  >
                    {t("tipFlow.common.goHome")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </CustomerFlowShell>
  );
}

