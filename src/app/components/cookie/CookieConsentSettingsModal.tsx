import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { Button } from "../ui/button";
import { DialogPortal } from "../ui/dialog";
import { cn } from "@/lib/utils";
import { cookieConsentClasses as cc } from "./cookieConsentPresentation";

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
    <div className="rounded-2xl border border-border/80 bg-muted/15 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <label htmlFor={id} className="text-sm font-semibold text-foreground">
            {title}
          </label>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
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
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
    <DialogPrimitive.Root open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogPortal>
        <DialogPrimitive.Overlay className={cc.backdrop} />
        <DialogPrimitive.Content
          className={cn(cc.panel, "max-w-lg")}
          aria-labelledby="cookie-settings-title"
          aria-describedby="cookie-settings-intro"
        >
          <div className={cc.scroll}>
            <DialogPrimitive.Title id="cookie-settings-title" className={cc.title}>
              {t("cookieConsent.settings.title")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description id="cookie-settings-intro" className={cn(cc.body, "mt-4")}>
              {t("cookieConsent.settings.intro")}
            </DialogPrimitive.Description>

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

            <p className={cc.privacy}>
              <Link to="/privacy" className={cc.privacyLink}>
                {t("cookieConsent.banner.privacyPolicy")}
              </Link>
            </p>

            <div className={cn(cc.actions, "mt-6")}>
              <Button
                type="button"
                variant="default"
                size="lg"
                className={cn(cc.action, "font-bold")}
                onClick={() => savePreferences({ analytics, functional, marketing })}
              >
                {t("cookieConsent.settings.save")}
              </Button>
              <Button type="button" variant="outline" size="lg" className={cc.action} onClick={acceptAll}>
                {t("cookieConsent.banner.acceptAll")}
              </Button>
              <Button type="button" variant="ghost" size="lg" className={cc.action} onClick={rejectNonEssential}>
                {t("cookieConsent.banner.reject")}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
