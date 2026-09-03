import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { PlatformBusinessRow } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { BusinessLogoMark } from "../business/BusinessLogoMark";
import { OnboardingVerificationStatusChip } from "../verification/VerificationWorkflowStatusChip";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

type PlatformBusinessMobileCardProps = {
  business: PlatformBusinessRow;
  className?: string;
};

export function PlatformBusinessMobileCard({ business: b, className }: PlatformBusinessMobileCardProps) {
  const { t } = useTranslation();

  return (
    <Link
      to={`/platform-admin/businesses/${b.id}`}
      className={cn(platformUi.mobileCard, "hover:bg-muted/30 active:bg-muted/50", className)}
    >
      <div className="flex gap-3">
        <BusinessLogoMark logoPathOrUrl={b.logoPath ?? null} businessName={b.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h4 className="min-w-0 truncate text-base font-semibold text-foreground">{b.name}</h4>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{b.slug}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{b.ownerEmail}</p>
          <div className="mt-3">
            <OnboardingVerificationStatusChip status={b.onboardingVerificationStatus} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="font-medium text-muted-foreground">{t("admin.colTipsEur")}</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatEur(b.totalTipsEur ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">{t("admin.colStaffLoc")}</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
                {b.staffCount ?? 0} / {b.locationCount ?? 0}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs font-medium text-primary">{t("admin.view")} →</p>
        </div>
      </div>
    </Link>
  );
}
