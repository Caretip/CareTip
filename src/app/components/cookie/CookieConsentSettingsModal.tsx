import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { cn } from "@/lib/utils";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

type CategoryKey = "analytics" | "functional" | "marketing";

function CategoryToggle({
  id,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <label htmlFor={id} className="text-sm font-semibold text-foreground">
            {title}
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => !disabled && onChange(!checked)}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            disabled ? "cursor-not-allowed opacity-60" : "hover:opacity-90",
            checked ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </div>
  );
}

export function CookieConsentSettingsModal() {
  const { t } = useTranslation();
  const { consent, settingsOpen, closeSettings, savePreferences, acceptAll, rejectNonEssential } =
    useCookieConsent();

  const [analytics, setAnalytics] = useState(false);
  const [functional, setFunctional] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setAnalytics(consent?.analytics ?? false);
    setFunctional(consent?.functional ?? false);
    setMarketing(consent?.marketing ?? false);
  }, [settingsOpen, consent]);

  if (!settingsOpen) return null;

  const categories: { key: CategoryKey; titleKey: string; descKey: string; value: boolean; set: (v: boolean) => void }[] =
    [
      {
        key: "analytics",
        titleKey: "cookieConsent.settings.categories.analytics.title",
        descKey: "cookieConsent.settings.categories.analytics.description",
        value: analytics,
        set: setAnalytics,
      },
      {
        key: "functional",
        titleKey: "cookieConsent.settings.categories.functional.title",
        descKey: "cookieConsent.settings.categories.functional.description",
        value: functional,
        set: setFunctional,
      },
      {
        key: "marketing",
        titleKey: "cookieConsent.settings.categories.marketing.title",
        descKey: "cookieConsent.settings.categories.marketing.description",
        value: marketing,
        set: setMarketing,
      },
    ];

  return (
    <div
      className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={closeSettings}
      onKeyDown={(e) => e.key === "Escape" && closeSettings()}
    >
      <div
        className="relative max-h-[min(90vh,42rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
        role="dialog"
        aria-labelledby="cookie-settings-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeSettings}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("cookieConsent.settings.close")}
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="cookie-settings-title" className="pr-8 text-lg font-semibold text-foreground">
          {t("cookieConsent.settings.title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("cookieConsent.settings.intro")}</p>

        <div className="mt-5 space-y-3">
          <CategoryToggle
            id="cookie-essential"
            title={t("cookieConsent.settings.categories.essential.title")}
            description={t("cookieConsent.settings.categories.essential.description")}
            checked
            disabled
            onChange={() => {}}
          />
          {categories.map((cat) => (
            <CategoryToggle
              key={cat.key}
              id={`cookie-${cat.key}`}
              title={t(cat.titleKey)}
              description={t(cat.descKey)}
              checked={cat.value}
              onChange={cat.set}
            />
          ))}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          <Link to="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("cookieConsent.banner.privacyPolicy")}
          </Link>
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className={cn(caretipBtnPrimary, "w-full sm:flex-1")}
            onClick={() => savePreferences({ analytics, functional, marketing })}
          >
            {t("cookieConsent.settings.save")}
          </button>
          <button type="button" className={cn(caretipBtnSecondary, "w-full sm:flex-1")} onClick={acceptAll}>
            {t("cookieConsent.banner.acceptAll")}
          </button>
          <button type="button" className={cn(caretipBtnSecondary, "w-full sm:flex-1")} onClick={rejectNonEssential}>
            {t("cookieConsent.banner.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
