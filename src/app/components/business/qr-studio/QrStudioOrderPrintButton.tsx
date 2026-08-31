import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { qrStudioPrintPath, type QrStudioCategory } from "@/app/lib/qrStudioNav";
import { cn } from "@/lib/utils";

type QrStudioOrderPrintButtonProps = {
  category: QrStudioCategory;
  className?: string;
};

export function QrStudioOrderPrintButton({ category, className }: QrStudioOrderPrintButtonProps) {
  const { t } = useTranslation();

  return (
    <Button variant="outline" size="sm" className={cn("shrink-0", className)} asChild>
      <Link to={qrStudioPrintPath(category)}>
        <Printer className="mr-2 h-4 w-4 shrink-0" aria-hidden />
        {t("business.qrStudio.nav.print")}
      </Link>
    </Button>
  );
}
