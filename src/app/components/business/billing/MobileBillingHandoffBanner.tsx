import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const MOBILE_BILLING_HANDOFF_BANNER_KEY = "caretip.mobileBillingHandoff";

export function markMobileBillingHandoffBanner(): void {
  try {
    sessionStorage.setItem(MOBILE_BILLING_HANDOFF_BANNER_KEY, "1");
  } catch {
    /* private mode / unavailable */
  }
}

function readHandoffFlag(): boolean {
  try {
    return sessionStorage.getItem(MOBILE_BILLING_HANDOFF_BANNER_KEY) === "1";
  } catch {
    return false;
  }
}

function clearHandoffFlag(): void {
  try {
    sessionStorage.removeItem(MOBILE_BILLING_HANDOFF_BANNER_KEY);
  } catch {
    /* ignore */
  }
}

/** Shown after Mobile → Web billing handoff so managers know they can stay or return. */
export function MobileBillingHandoffBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(readHandoffFlag());
  }, []);

  const dismiss = useCallback(() => {
    clearHandoffFlag();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground",
      )}
    >
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{t("business.billing.mobileHandoff.title")}</p>
        <p className="text-muted-foreground leading-relaxed">
          {t("business.billing.mobileHandoff.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("business.billing.mobileHandoff.dismiss")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
