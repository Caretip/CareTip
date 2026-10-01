import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { qrStudioSubNavItems } from "@/app/components/business/businessDashboardNav";
import { cn } from "@/lib/utils";

/**
 * Compact QR Studio section switcher for mobile only (sidebar is collapsed).
 * Desktop relies on the global sidebar — no duplicate nav row.
 */
export function QrStudioMobileSectionSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const current =
    qrStudioSubNavItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ??
    qrStudioSubNavItems[0];

  return (
    <div className={cn("qr-studio-mobile-section lg:hidden", className)}>
      <label className="qr-studio-mobile-section__label" htmlFor="qr-studio-mobile-section">
        {t("business.qrStudio.title")}
      </label>
      <select
        id="qr-studio-mobile-section"
        className="qr-studio-mobile-section__select"
        value={current.href}
        onChange={(e) => navigate(e.target.value)}
        aria-label={t("business.qrStudio.mobileSectionAria")}
      >
        {qrStudioSubNavItems.map((item) => (
          <option key={item.href} value={item.href}>
            {t(item.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
