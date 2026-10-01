import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CustomerJourneyLegalDialog } from "./CustomerJourneyLegalDialog";

type CustomerJourneyPrivacyNoticeProps = {
  className?: string;
};

export function CustomerJourneyPrivacyNotice({ className }: CustomerJourneyPrivacyNoticeProps) {
  const { t } = useTranslation();
  const [privacyOpen, setPrivacyOpen] = useState(false);

  return (
    <>
      <p className={cn("text-center text-xs leading-snug text-muted-foreground", className)}>
        <Trans
          i18nKey="tipFlow.privacyNotice.text"
          components={{
            policy: (
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                aria-label={t("tipFlow.privacyNotice.openPolicyAria")}
                onClick={() => setPrivacyOpen(true)}
              />
            ),
          }}
        />
      </p>
      <CustomerJourneyLegalDialog
        kind="privacy"
        open={privacyOpen}
        onOpenChange={setPrivacyOpen}
      />
    </>
  );
}
