import { useMemo } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { cn } from "@/lib/utils";

const TRUST_KEYS = ["gdpr", "auth", "rbac", "payments"] as const;

export function LandingTrustComplianceStrip({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();

  const items = useMemo(
    () => TRUST_KEYS.map((key) => t(`landing.trustStrip.${key}`)),
    [t, i18n.language],
  );

  return (
    <LandingReveal
      className={cn("caretip-trust-strip", className)}
      role="list"
      aria-label={t("landing.trustStrip.aria")}
    >
      {items.map((label) => (
        <span key={label} className="caretip-trust-strip__item" role="listitem">
          <Check className="caretip-trust-strip__check shrink-0" strokeWidth={2.75} aria-hidden />
          {label}
        </span>
      ))}
    </LandingReveal>
  );
}
