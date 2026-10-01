import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QrStudioDestinationFieldProps = {
  url: string;
  copied: boolean;
  onCopy: () => void;
  className?: string;
};

export function QrStudioDestinationField({
  url,
  copied,
  onCopy,
  className,
}: QrStudioDestinationFieldProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("qr-studio-destination", className)}>
      <p className="qr-studio-destination__label">{t("business.qrStudio.destination")}</p>
      <div className="qr-studio-destination__row">
        <code className="qr-studio-destination__url" title={url}>{url}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="qr-studio-destination__copy shrink-0"
          onClick={() => void onCopy()}
          aria-label={copied ? t("common.copied") : t("business.qrPage.copyUrlAria")}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          <span className="sr-only sm:not-sr-only sm:ml-1.5">
            {copied ? t("common.copied") : t("business.tablesPage.copy")}
          </span>
        </Button>
      </div>
    </div>
  );
}
