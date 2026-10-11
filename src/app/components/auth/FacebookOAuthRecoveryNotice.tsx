import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";

type FacebookOAuthRecoveryNoticeProps = {
  open: boolean;
  troubleshooting: boolean;
  onContinueWithEmail: () => void;
  onTroubleshootingChange: (open: boolean) => void;
};

export function FacebookOAuthRecoveryNotice({
  open,
  troubleshooting,
  onContinueWithEmail,
  onTroubleshootingChange,
}: FacebookOAuthRecoveryNoticeProps) {
  const { t } = useTranslation();
  const troubleshootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && troubleshooting) troubleshootRef.current?.focus();
  }, [open, troubleshooting]);

  if (!open) return null;

  return (
    <div className="mt-3 w-full text-left" role="status" aria-live="polite">
      <div className="rounded-xl border border-border bg-card px-3.5 py-3 text-card-foreground shadow-sm">
        <p className="text-sm font-semibold leading-snug text-foreground">
          {t("auth.oauth.facebookRecoveryTitle")}
        </p>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          {t("auth.oauth.facebookRecoveryMessage")}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Button type="button" className="w-full" onClick={onContinueWithEmail}>
            {t("auth.oauth.facebookRecoveryContinueEmail")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            aria-expanded={troubleshooting}
            aria-controls="facebook-oauth-recovery-help"
            onClick={() => onTroubleshootingChange(!troubleshooting)}
          >
            {t("auth.oauth.facebookRecoveryTroubleshoot")}
          </Button>
        </div>
        {troubleshooting ? (
          <div
            id="facebook-oauth-recovery-help"
            ref={troubleshootRef}
            tabIndex={-1}
            className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 outline-none"
          >
            <p className="text-sm leading-relaxed text-foreground">
              {t("auth.oauth.facebookRecoverySteps")}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("auth.oauth.facebookRecoveryIncognito")}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => onTroubleshootingChange(false)}
            >
              {t("auth.oauth.facebookRecoveryBack")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
