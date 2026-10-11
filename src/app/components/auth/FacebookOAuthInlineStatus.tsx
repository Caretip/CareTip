import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import type { FacebookOAuthAttemptState } from "@/app/lib/facebookProviderAttempt";
import {
  facebookShowsConnectingStatus,
  facebookShowsFailureStatus,
} from "@/app/lib/facebookProviderAttempt";

type FacebookOAuthInlineStatusProps = {
  state: FacebookOAuthAttemptState;
  onRetry: () => void;
  onContinueWithEmail: () => void;
};

export function FacebookOAuthInlineStatus({
  state,
  onRetry,
  onContinueWithEmail,
}: FacebookOAuthInlineStatusProps) {
  const { t } = useTranslation();
  const [troubleshooting, setTroubleshooting] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  const connecting = facebookShowsConnectingStatus(state);
  const failure = facebookShowsFailureStatus(state);

  useEffect(() => {
    if (!failure) {
      setTroubleshooting(false);
      return;
    }
    regionRef.current?.focus();
  }, [failure, state.attemptId]);

  if (!connecting && !failure) return null;

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      className="caretip-facebook-oauth-inline"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {connecting ? (
        <div className="caretip-facebook-oauth-inline__row caretip-facebook-oauth-inline__row--connecting">
          <Loader2 className="caretip-facebook-oauth-inline__icon caretip-facebook-oauth-inline__icon--spin" aria-hidden />
          <p className="caretip-facebook-oauth-inline__text">{t("auth.oauth.facebookConnecting")}</p>
        </div>
      ) : null}
      {failure ? (
        <div className="caretip-facebook-oauth-inline__panel">
          <div className="caretip-facebook-oauth-inline__row caretip-facebook-oauth-inline__row--error">
            <AlertCircle className="caretip-facebook-oauth-inline__icon caretip-facebook-oauth-inline__icon--warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="caretip-facebook-oauth-inline__title">{t("auth.oauth.facebookStallTitle")}</p>
              <p className="caretip-facebook-oauth-inline__text">{t("auth.oauth.facebookStallMessage")}</p>
            </div>
          </div>
          <div className="caretip-facebook-oauth-inline__actions">
            <Button type="button" size="sm" className="h-9 flex-1" onClick={onRetry}>
              {t("auth.oauth.facebookRetry")}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-9 flex-1" onClick={onContinueWithEmail}>
              {t("auth.oauth.facebookRecoveryContinueEmail")}
            </Button>
          </div>
          <button
            type="button"
            className="caretip-facebook-oauth-inline__link"
            aria-expanded={troubleshooting}
            aria-controls="facebook-oauth-inline-help"
            onClick={() => setTroubleshooting((open) => !open)}
          >
            {t("auth.oauth.facebookRecoveryTroubleshoot")}
          </button>
          {troubleshooting ? (
            <div id="facebook-oauth-inline-help" className="caretip-facebook-oauth-inline__help">
              <p>{t("auth.oauth.facebookRecoverySteps")}</p>
              <p className="mt-1.5 text-muted-foreground">{t("auth.oauth.facebookRecoveryIncognito")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
