import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { ContactIntentChooser } from "@/components/contact/ContactIntentChooser";
import { ContactDemoForm } from "@/components/contact/ContactDemoForm";
import { ContactSupportForm } from "@/components/contact/ContactSupportForm";
import { ContactSalesPanel } from "@/components/contact/ContactSalesPanel";
import type { ContactIntent } from "@/components/contact/contactTypes";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

function parseIntentParam(value: string | null): ContactIntent {
  if (value === "demo" || value === "support" || value === "sales") return value;
  if (value === "enterprise" || value === "partnerships") return "sales";
  return "choose";
}

export function ContactPage() {
  usePublicMountProbe("ContactPage");
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [intent, setIntent] = useState<ContactIntent>(() =>
    parseIntentParam(searchParams.get("intent")),
  );

  useEffect(() => {
    setIntent(parseIntentParam(searchParams.get("intent")));
  }, [searchParams]);

  const selectIntent = useCallback(
    (next: Exclude<ContactIntent, "choose">) => {
      setIntent(next);
      const nextParams = new URLSearchParams();
      nextParams.set("intent", next);
      const plan = searchParams.get("plan");
      if (next === "demo" && plan) nextParams.set("plan", plan);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const backToChooser = useCallback(() => {
    setIntent("choose");
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <PublicPageShell maxWidth="wide">
      <main id="contact" className={contactPageUi.page} aria-label={t("staticPages.contact.pageAria")}>
        {intent === "choose" ? <ContactIntentChooser onSelect={selectIntent} /> : null}
        {intent === "demo" ? (
          <ContactDemoForm
            onBack={backToChooser}
            onSwitchToSupport={() => selectIntent("support")}
            pricingPlan={searchParams.get("plan")}
          />
        ) : null}
        {intent === "support" ? (
          <ContactSupportForm
            onBack={backToChooser}
            onSwitchToDemo={() => selectIntent("demo")}
          />
        ) : null}
        {intent === "sales" ? (
          <ContactSalesPanel
            onBack={backToChooser}
            onSwitchToDemo={() => selectIntent("demo")}
            onSwitchToSupport={() => selectIntent("support")}
          />
        ) : null}
      </main>
    </PublicPageShell>
  );
}
