import { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";
import {
  getPwaInstallDeferred,
  subscribePwaInstallDeferred,
  type PwaBeforeInstallPromptEvent,
} from "@/app/lib/pwaInstallDeferred";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

const STORAGE_KEY = "caretip-pwa-install-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shows install affordance when the browser supports it (Android/desktop Chromium)
 * or brief iOS “Add to Home Screen” guidance. Hidden when already installed or dismissed.
 */
export function PwaInstallPrompt() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<PwaBeforeInstallPromptEvent | null>(() =>
    readDismissed() || isStandalone() ? null : getPwaInstallDeferred()
  );
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    if (isStandalone() || readDismissed()) return;

    const onChange = () => {
      if (readDismissed() || isStandalone()) {
        setDeferred(null);
        return;
      }
      setDeferred(getPwaInstallDeferred());
    };

    const unsub = subscribePwaInstallDeferred(onChange);

    if (isIosSafari()) {
      setIosHint(true);
    }

    return unsub;
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setDeferred(null);
    setIosHint(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
  }, [deferred]);

  if (isStandalone() || dismissed) return null;

  if (deferred) {
    return (
      <div
        className="caretip-pwa-install-banner fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md sm:rounded-xl sm:border"
        role="region"
        aria-label={t("pwaInstall.regionAria")}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Download className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t("pwaInstall.title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("pwaInstall.body")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={install}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary-hover"
              >
                {t("pwaInstall.install")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
              >
                {t("pwaInstall.notNow")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("pwaInstall.dismiss")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (iosHint) {
    return (
      <div
        className="caretip-pwa-install-banner fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md sm:rounded-xl sm:border"
        role="region"
        aria-label={t("pwaInstall.iosRegionAria")}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t("pwaInstall.iosTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <Trans
                i18nKey="pwaInstall.iosBody"
                components={{
                  share: <span className="font-medium" />,
                  homescreen: <span className="font-medium" />,
                }}
              />
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            >
              {t("pwaInstall.gotIt")}
            </button>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("pwaInstall.dismiss")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
