import { Trans, useTranslation } from "react-i18next";
import { CARETIP_LEGAL_LINKS } from "@/app/lib/caretipLegalLinks";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  className?: string;
  id?: string;
  /** When true, show compact styling for mobile web / dense forms */
  dense?: boolean;
};

/**
 * Mandatory merchant B2B legal acceptance checkbox with individually linked documents.
 * Terms + Privacy → CareTip-hosted IT-Recht pages; DPA + PLV → CareTip PDFs.
 */
export function MerchantLegalAcceptanceCheckbox({
  checked,
  onCheckedChange,
  className,
  id = "merchant-legal-acceptance",
  dense = false,
}: Props) {
  const { t } = useTranslation();

  const linkClass =
    "underline underline-offset-2 text-primary font-medium hover:opacity-90";

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 text-sm text-muted-foreground cursor-pointer select-none",
        dense && "gap-2.5 text-[13px] leading-snug",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary",
          dense && "mt-1",
        )}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span>
        <Trans
          i18nKey="auth.merchantLegalAcceptance.label"
          components={{
            terms: (
              <a
                href={CARETIP_LEGAL_LINKS.terms.path}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                onClick={(e) => e.stopPropagation()}
              />
            ),
            dpa: (
              <a
                href={CARETIP_LEGAL_LINKS.dpa.path}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                onClick={(e) => e.stopPropagation()}
              />
            ),
            plv: (
              <a
                href={CARETIP_LEGAL_LINKS.plv.path}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                onClick={(e) => e.stopPropagation()}
              />
            ),
            privacy: (
              <a
                href={CARETIP_LEGAL_LINKS.privacy.path}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          }}
        />
        <span className="sr-only">{t("auth.merchantLegalAcceptance.requiredHint")}</span>
      </span>
    </label>
  );
}
