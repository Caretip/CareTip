import { useTranslation } from "react-i18next";
import { CareIcon, type CareIconName } from "@/components/icons";
import { CareTipLogo, DASHBOARD_SIDEBAR_BRAND_CLASS } from "@/app/components/CareTipLogo";
import {
  dashboardSidebarNavLinkActive,
  dashboardSidebarNavLinkBase,
  dashboardSidebarNavLinkIdle,
} from "@/lib/theme/dashboardSidebarUi";
import { cn } from "@/lib/utils";

const SHOWCASE_NAV: ReadonlyArray<{
  labelKey: string;
  icon: CareIconName;
  active?: boolean;
}> = [
  { labelKey: "dashboardNav.business.overview", icon: "overview", active: true },
  { labelKey: "dashboardNav.business.tips", icon: "tipsActivity" },
  { labelKey: "dashboardNav.business.team", icon: "team" },
  { labelKey: "dashboardNav.business.qrStudio", icon: "tableQr" },
  { labelKey: "dashboardNav.business.locations", icon: "locations" },
  { labelKey: "dashboardNav.business.customers", icon: "inbox" },
  { labelKey: "dashboardNav.business.settings", icon: "settings" },
];

export function LandingDashboardShowcaseSidebar({
  compact = false,
}: {
  /** Tighter sidebar for embedded audience-benefits card. */
  compact?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "caretip-landing-dashboard-showcase__sidebar",
        compact && "caretip-landing-dashboard-showcase__sidebar--compact",
      )}
      aria-label={t("landing.dashboardShowcase.sidebar.ariaLabel")}
    >
      <div
        className={cn(
          DASHBOARD_SIDEBAR_BRAND_CLASS,
          "caretip-landing-dashboard-showcase__sidebar-brand",
        )}
      >
        <CareTipLogo
          size="sidebar"
          className={cn(compact && "caretip-landing-dashboard-showcase__sidebar-logo")}
        />
      </div>
      <nav className="caretip-landing-dashboard-showcase__sidebar-nav" aria-label={t("dashboardNav.business.overview")}>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {SHOWCASE_NAV.map((item) => (
            <li key={item.labelKey}>
              <span
                className={cn(
                  dashboardSidebarNavLinkBase,
                  "caretip-landing-dashboard-showcase__sidebar-link pointer-events-none select-none",
                  item.active ? dashboardSidebarNavLinkActive : dashboardSidebarNavLinkIdle,
                  item.active && "caretip-landing-dashboard-showcase__sidebar-link--active",
                )}
                aria-current={item.active ? "page" : undefined}
              >
                <CareIcon name={item.icon} size="md" className="shrink-0 opacity-90" aria-hidden />
                <span className="caretip-landing-dashboard-showcase__sidebar-label truncate">
                  {t(item.labelKey)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
