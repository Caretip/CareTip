import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { consumeSessionEndNotice, subscribeSessionEndNotice } from "../lib/sessionExpiredNotice";

const NOTICE_DURATION_MS = 8_000;

/**
 * Shows the queued "session ended" notice once, as soon as it is queued. Pass false where it would be
 * out of place (public and guest pages): it then waits for the login page, or lapses.
 */
export function useSessionEndNotice(enabled: boolean): void {
  const { t } = useTranslation();
  useEffect(() => {
    if (!enabled) return;
    const show = () => {
      const kind = consumeSessionEndNotice();
      if (!kind) return;
      const key = kind === "deactivated" ? "toastAccountDeactivated" : "toastSessionExpired";
      toast.message(t(`business.onboarding.${key}`), {
        id: "caretip-session-expired",
        duration: NOTICE_DURATION_MS,
      });
    };
    show();
    return subscribeSessionEndNotice(show);
  }, [enabled, t]);
}
