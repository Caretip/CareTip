import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { QrStudioOrderPrintButton } from "./QrStudioOrderPrintButton";
import type { QrStudioCategory } from "@/app/lib/qrStudioNav";
import { cn } from "@/lib/utils";

type QrStudioPageShellProps = {
  sectionLabelKey: string;
  /** Page headline when different from the nav section label (e.g. Main venue QR). */
  titleKey?: string;
  descriptionKey: string;
  printCategory?: QrStudioCategory;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function QrStudioPageShell({
  sectionLabelKey,
  titleKey,
  descriptionKey,
  printCategory,
  headerActions,
  children,
  className,
}: QrStudioPageShellProps) {
  const { t } = useTranslation();
  const headlineKey = titleKey ?? sectionLabelKey;

  return (
    <div className={cn("qr-studio-page min-w-0", className)}>
      <header className="qr-studio-page__header">
        <p className="qr-studio-page__crumb">
          <span>{t("business.qrStudio.title")}</span>
          <span className="qr-studio-page__crumb-sep" aria-hidden>/</span>
          <span className="text-foreground">{t(sectionLabelKey)}</span>
        </p>
        <div className="qr-studio-page__header-row">
          <div className="min-w-0">
            <h1 className="qr-studio-page__title">{t(headlineKey)}</h1>
            <p className="qr-studio-page__desc">{t(descriptionKey)}</p>
          </div>
          <div className="qr-studio-page__header-actions">
            {headerActions}
            {printCategory ? (
              <QrStudioOrderPrintButton category={printCategory} className="w-full sm:w-auto" />
            ) : null}
          </div>
        </div>
      </header>
      <div className="qr-studio-page__body">{children}</div>
    </div>
  );
}
