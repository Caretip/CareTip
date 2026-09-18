import { useTranslation } from "react-i18next";
import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
import { customerFlowUi as cf } from "./customerFlowUi";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerFlowShell } from "./CustomerFlowShell";
import type { CustomerJourneyVenueBrand } from "./customerJourneyBrand";
import { headerConfirmingTipFor } from "./customerJourneyHeaderCopy";

type TipPaymentProcessingViewProps = {
  title?: string;
  subtitle?: string;
  venue?: CustomerJourneyVenueBrand;
  /** When known, title reads "Confirming tip for {{name}}". */
  employeeName?: string | null;
};

/** Post-checkout state while the backend confirms Stripe payment. */
export function TipPaymentProcessingView({
  title,
  subtitle,
  venue,
  employeeName,
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
        </CardContent>
      </Card>
    </CustomerFlowShell>
  );
}

