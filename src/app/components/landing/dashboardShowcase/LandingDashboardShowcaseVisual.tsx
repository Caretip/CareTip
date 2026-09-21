import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { EmployeeProfilePhoto } from "@/app/components/ui/profile-avatar";
import { formatEur } from "@/app/lib/formatEur";
import { cn } from "@/lib/utils";
import {
  LANDING_DASHBOARD_SHOWCASE_EMPLOYEES,
  LANDING_DASHBOARD_SHOWCASE_KPIS,
  type LandingDashboardShowcaseEmployee,
} from "./landingDashboardShowcaseData";
import { LandingDashboardShowcaseSidebar } from "./LandingDashboardShowcaseSidebar";

export type LandingDashboardShowcaseVisualProps = {
  /** Compact product preview for editorial landing layouts. */
  variant?: "default" | "compact" | "editorial" | "premium";
  /** Cap visible employee rows in the marketing preview. */
  employeeLimit?: number;
  /** Optional caption under the frame (hidden for editorial by default). */
  showCaption?: boolean;
  /** Scales the premium dashboard to fit an audience-benefits card photo slot. */
  embeddedInCard?: boolean;
};

function ShowcaseStarRating({
  rating,
  className,
  premium = false,
  variant = "default",
}: {
  rating: number;
  className?: string;
  premium?: boolean;
  /** Secondary = small stars under the name; default = table / card emphasis. */
  variant?: "default" | "secondary";
}) {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  const secondary = variant === "secondary";

  return (
    <div
      className={cn(
        "flex items-center",
        secondary ? "gap-px" : "gap-0.5",
        className,
      )}
      aria-label={`${rating.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            secondary ? "h-2 w-2" : premium ? "h-3 w-3" : "h-3 w-3",
            i < rounded
              ? secondary
                ? "fill-muted-foreground/55 text-muted-foreground/55"
                : "fill-primary text-primary"
              : "text-muted-foreground/25",
          )}
          aria-hidden
        />
      ))}
      {!secondary ? (
        <span
          className={cn(
            "ml-0.5 font-semibold tabular-nums",
            premium ? "text-xs text-primary" : "text-xs text-foreground/85",
          )}
        >
          {rating.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </span>
      ) : null}
    </div>
  );
}

function ShowcaseLeaderboardTips({
  totalTips,
  tipCount,
  embeddedInCard,
}: {
  totalTips: number;
  tipCount: number;
  embeddedInCard?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "caretip-landing-dashboard-showcase__leaderboard-tips shrink-0 text-right",
        embeddedInCard && "caretip-landing-dashboard-showcase__leaderboard-tips--compact",
      )}
    >
      <p className="caretip-landing-dashboard-showcase__leaderboard-tips-amount tabular-nums">
        {formatEur(totalTips)}
      </p>
      <p className="caretip-landing-dashboard-showcase__leaderboard-tips-count tabular-nums">
        {tipCount} {t("landing.dashboardShowcase.employees.tipsShort")}
      </p>
    </div>
  );
}

function ShowcaseStatusBadge({
  status,
}: {
  status: LandingDashboardShowcaseEmployee["status"];
}) {
  const { t } = useTranslation();
  const active = status === "active";
  return (
    <span
      className={cn(
        "caretip-landing-dashboard-showcase__status inline-flex items-center gap-1.5 text-xs font-medium",
        active ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-muted-foreground/45",
        )}
        aria-hidden
      />
      {t(`landing.dashboardShowcase.employees.status.${status}`)}
    </span>
  );
}

function ShowcaseKpiRow({
  compact,
  premium = false,
  embeddedInCard = false,
}: {
  compact: boolean;
  premium?: boolean;
  embeddedInCard?: boolean;
}) {
  const { t } = useTranslation();
  const { totalTips, tipCount, activeEmployees, averageRating } = LANDING_DASHBOARD_SHOWCASE_KPIS;
  const hideHints = compact || embeddedInCard;

  return (
    <div className="business-period-summary business-dashboard-stats-grid--period w-full min-w-0">
      <div
        className={cn(
          "business-period-summary__row caretip-landing-dashboard-showcase__kpi-row",
          compact && "caretip-landing-dashboard-showcase__kpi-row--compact",
          premium && "caretip-landing-dashboard-showcase__kpi-row--premium",
          embeddedInCard && "caretip-landing-dashboard-showcase__kpi-row--embedded",
        )}
      >
        <div className="business-period-summary__metric business-period-summary__metric--primary">
          <p className="business-period-summary__label">
            {t("landing.dashboardShowcase.kpis.totalTips")}
          </p>
          <p className="business-period-summary__value">{formatEur(totalTips)}</p>
          {!hideHints ? (
            <p className="business-period-summary__hint">
              {t("landing.dashboardShowcase.kpis.tipCountHint", { count: tipCount })}
            </p>
          ) : null}
        </div>

        <div className="business-period-summary__metric">
          <p className="business-period-summary__label">
            {t("landing.dashboardShowcase.kpis.activeEmployees")}
          </p>
          <p className="business-period-summary__value">{activeEmployees}</p>
          {!hideHints ? (
            <p className="business-period-summary__hint">
              {t("landing.dashboardShowcase.kpis.activeEmployeesHint")}
            </p>
          ) : null}
        </div>

        <div className="business-period-summary__metric">
          <p className="business-period-summary__label">
            {t("landing.dashboardShowcase.kpis.averageRating")}
          </p>
          <p className="business-period-summary__value">
            {averageRating.toLocaleString("de-DE", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </p>
          {!hideHints ? (
            <p className="business-period-summary__hint">
              {t("landing.dashboardShowcase.kpis.averageRatingHint")}
            </p>
          ) : null}
        </div>

        {!compact && !premium ? (
          <div className="business-period-summary__metric caretip-landing-dashboard-showcase__kpi-metric--fourth">
            <p className="business-period-summary__label">
              {t("landing.dashboardShowcase.kpis.avgTip")}
            </p>
            <p className="business-period-summary__value">
              {formatEur(totalTips / tipCount, { minFrac: 2, maxFrac: 2 })}
            </p>
            <p className="business-period-summary__hint">
              {t("landing.dashboardShowcase.kpis.avgTipHint")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ShowcaseEmployeePreview({
  compact,
  premium = false,
  employeeLimit,
  embeddedInCard = false,
}: {
  compact: boolean;
  premium?: boolean;
  employeeLimit: number;
  embeddedInCard?: boolean;
}) {
  const { t } = useTranslation();
  const employees = LANDING_DASHBOARD_SHOWCASE_EMPLOYEES.slice(0, employeeLimit);

  if (compact || premium) {
    return (
      <div className={premium ? "caretip-landing-dashboard-showcase__curated-team" : undefined}>
        {premium ? (
          <div className="caretip-landing-dashboard-showcase__panel-head caretip-landing-dashboard-showcase__panel-head--premium">
            <h3 className="caretip-landing-dashboard-showcase__panel-title">
              {t("landing.dashboardShowcase.employees.title")}
            </h3>
            {!embeddedInCard ? (
              <p className="caretip-landing-dashboard-showcase__panel-sub">
                {t("landing.dashboardShowcase.employees.subtitle")}
              </p>
            ) : null}
          </div>
        ) : null}
        <ul
          className={cn(
            "caretip-landing-dashboard-showcase__leaderboard",
            premium && "caretip-landing-dashboard-showcase__leaderboard--premium",
          )}
        >
          {employees.map((employee, index) => (
            <li key={employee.id} className="caretip-landing-dashboard-showcase__leaderboard-row">
              <span className="caretip-landing-dashboard-showcase__leaderboard-rank" aria-hidden>
                {index + 1}
              </span>
              <EmployeeProfilePhoto
                src={employee.avatarUrl}
                displayName={employee.name}
                className={cn(
                  "shrink-0 caretip-landing-dashboard-showcase__leaderboard-avatar",
                  premium ? "h-9 w-9 sm:h-10 sm:w-10" : "h-9 w-9",
                )}
                lightbox={false}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate font-medium text-foreground",
                    premium ? "text-xs sm:text-sm" : "text-sm",
                  )}
                >
                  {employee.name}
                </p>
                <ShowcaseStarRating
                  rating={employee.rating}
                  variant="secondary"
                  className="mt-0.5"
                />
              </div>
              <ShowcaseLeaderboardTips
                totalTips={employee.totalTips}
                tipCount={employee.tipCount}
                embeddedInCard={embeddedInCard}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      className="caretip-landing-dashboard-showcase__panel caretip-landing-dashboard-showcase__panel--wide"
      aria-labelledby="caretip-landing-dashboard-team-title"
    >
      <div className="caretip-landing-dashboard-showcase__panel-head">
        <h3 id="caretip-landing-dashboard-team-title" className="caretip-landing-dashboard-showcase__panel-title">
          {t("landing.dashboardShowcase.employees.title")}
        </h3>
        <p className="caretip-landing-dashboard-showcase__panel-sub">
          {t("landing.dashboardShowcase.employees.subtitle")}
        </p>
      </div>

      <div className="caretip-landing-dashboard-showcase__table-wrap overflow-x-auto">
        <table className="caretip-landing-dashboard-showcase__table w-full min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">{t("landing.dashboardShowcase.employees.colEmployee")}</th>
              <th scope="col">{t("landing.dashboardShowcase.employees.colTotalTips")}</th>
              <th scope="col">{t("landing.dashboardShowcase.employees.colTipCount")}</th>
              <th scope="col">{t("landing.dashboardShowcase.employees.colAverageTip")}</th>
              <th scope="col">{t("landing.dashboardShowcase.employees.colRating")}</th>
              <th scope="col">{t("landing.dashboardShowcase.employees.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <div className="flex min-w-0 items-center gap-3">
                    <EmployeeProfilePhoto
                      src={employee.avatarUrl}
                      displayName={employee.name}
                      className="business-dashboard-top-performer-avatar h-10 w-10 shrink-0"
                      lightbox={false}
                    />
                    <span className="truncate font-medium text-foreground">{employee.name}</span>
                  </div>
                </td>
                <td className="tabular-nums">{formatEur(employee.totalTips)}</td>
                <td className="tabular-nums">{employee.tipCount}</td>
                <td className="tabular-nums">{formatEur(employee.averageTip)}</td>
                <td>
                  <ShowcaseStarRating rating={employee.rating} />
                </td>
                <td>
                  <ShowcaseStatusBadge status={employee.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="caretip-landing-dashboard-showcase__employee-cards lg:hidden">
        {employees.map((employee) => (
          <li key={employee.id} className="caretip-landing-dashboard-showcase__employee-card">
            <EmployeeProfilePhoto
              src={employee.avatarUrl}
              displayName={employee.name}
              className="h-11 w-11 shrink-0"
              lightbox={false}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{employee.name}</p>
              <ShowcaseStarRating rating={employee.rating} variant="secondary" className="mt-0.5" />
            </div>
            <ShowcaseLeaderboardTips totalTips={employee.totalTips} tipCount={employee.tipCount} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export const LandingDashboardShowcaseVisual = memo(function LandingDashboardShowcaseVisual({
  variant = "default",
  employeeLimit = 5,
  showCaption,
  embeddedInCard = false,
}: LandingDashboardShowcaseVisualProps) {
  const { t } = useTranslation();
  const compact = variant === "compact";
  const editorial = variant === "editorial";
  const premium = variant === "premium";
  const showChrome = !compact;
  const showWindowChrome = showChrome && !premium;
  const limit = Math.max(1, Math.min(employeeLimit, LANDING_DASHBOARD_SHOWCASE_EMPLOYEES.length));
  const captionVisible = showCaption ?? !(editorial || premium);

  return (
    <div
      className={cn(
        "caretip-landing-dashboard-showcase",
        compact && "caretip-landing-dashboard-showcase--compact",
        editorial && "caretip-landing-dashboard-showcase--editorial",
        premium && "caretip-landing-dashboard-showcase--premium",
        embeddedInCard && "caretip-landing-dashboard-showcase--in-card",
      )}
      aria-label={t("landing.dashboardShowcase.ariaLabel")}
    >
      <div className="caretip-landing-dashboard-showcase__frame">
        {showWindowChrome ? (
          <div className="caretip-landing-dashboard-showcase__window-chrome" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div
          className={cn(
            "caretip-landing-dashboard-showcase__app-layout",
            premium && "caretip-landing-dashboard-showcase__app-layout--premium",
            embeddedInCard && "caretip-landing-dashboard-showcase__app-layout--embedded",
          )}
        >
          {premium ? (
            <LandingDashboardShowcaseSidebar compact={embeddedInCard} />
          ) : null}
          <div className="caretip-dashboard-shell business-dashboard caretip-landing-dashboard-showcase__shell">
            {showChrome ? (
              <header className="caretip-landing-dashboard-showcase__header">
                <div className="min-w-0">
                  <p className="caretip-landing-dashboard-showcase__eyebrow">
                    {t("landing.dashboardShowcase.preview.eyebrow")}
                  </p>
                  <h4 className="caretip-landing-dashboard-showcase__title">
                    {t("landing.dashboardShowcase.preview.title")}
                  </h4>
                </div>
                <div className="caretip-landing-dashboard-showcase__header-meta">
                  {premium ? (
                    <span className="caretip-landing-dashboard-showcase__sample">
                      {t("landing.dashboardShowcase.preview.sampleData")}
                    </span>
                  ) : null}
                  <span className="caretip-landing-dashboard-showcase__period">
                    {t("landing.dashboardShowcase.preview.periodWeek")}
                  </span>
                </div>
              </header>
            ) : (
              <div className="caretip-landing-dashboard-showcase__compact-bar">
                <span className="caretip-landing-dashboard-showcase__compact-title">
                  {t("landing.dashboardShowcase.preview.title")}
                </span>
                <span className="caretip-landing-dashboard-showcase__period">
                  {t("landing.dashboardShowcase.preview.periodWeek")}
                </span>
              </div>
            )}

            <div className="caretip-landing-dashboard-showcase__body business-dashboard-overview">
              <ShowcaseKpiRow
                compact={compact && !editorial && !premium}
                premium={premium}
                embeddedInCard={embeddedInCard}
              />
              <ShowcaseEmployeePreview
                compact={compact && !premium}
                premium={premium}
                employeeLimit={limit}
                embeddedInCard={embeddedInCard}
              />
            </div>
          </div>
        </div>
        {editorial ? <div className="caretip-landing-dashboard-showcase__editorial-fade" aria-hidden /> : null}
      </div>

      {captionVisible ? (
        <p className="caretip-landing-dashboard-showcase__caption">
          {t("landing.dashboardShowcase.caption")}
        </p>
      ) : null}
    </div>
  );
});
