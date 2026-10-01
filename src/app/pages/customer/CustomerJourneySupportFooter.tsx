import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CARETIP_SUPPORT_EMAIL } from "@/app/lib/caretipContactEmails";
import { cn } from "@/lib/utils";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyCareTipAttribution } from "./CustomerJourneyCareTipAttribution";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";

type CustomerJourneySupportFooterProps = {
  label: string;
  className?: string;
};

export function CustomerJourneySupportFooter({
  label,
  className,
}: CustomerJourneySupportFooterProps) {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className={cn(cf.customerJourneyAttributionFooter, className)}>
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setHelpOpen(true)}
        >
          {t("tipFlow.support.helpLink")}
        </button>
        <CustomerJourneyCareTipAttribution label={label} />
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("tipFlow.support.helpTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div>
              <h3 className="font-semibold text-foreground">{t("tipFlow.support.faq.refundQuestion")}</h3>
              <p className="mt-1.5 leading-relaxed">
                {t("tipFlow.support.faq.refundAnswerPrefix")}
                <a
                  href={`mailto:${CARETIP_SUPPORT_EMAIL}`}
                  className="font-semibold text-primary underline underline-offset-2 hover:text-primary/90"
                >
                  {CARETIP_SUPPORT_EMAIL}
                </a>
                {t("tipFlow.support.faq.refundAnswerSuffix")}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
