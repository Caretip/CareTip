import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import type { TipActivityRow, TipStatus } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import { cn } from "@/lib/utils";
import { businessUi } from "./businessDashboardUi";

type TipActivityMobileCardProps = {
  tip: TipActivityRow;
  showStaffColumn: boolean;
  statusLabel: (s: TipStatus | string) => string;
  /** BCP 47 locale tag (e.g. en, de) — not a date-fns locale object. */
  dateLocale: string;
  dataTimezone: string | null;
  unknownStaffLabel: string;
  youLabel: string;
  userRole?: string;
};

export function TipActivityMobileCard({
  tip,
  showStaffColumn,
  statusLabel,
  dateLocale,
  dataTimezone,
  unknownStaffLabel,
  youLabel,
  userRole,
}: TipActivityMobileCardProps) {
  const { t } = useTranslation();
  const locationDetail = tip.tableName
    ? `${t("business.tipsActivity.csvTablePrefix")} ${tip.tableName}`
    : tip.locationName
      ? `${t("business.tipsActivity.csvLocationPrefix")} ${tip.locationName}`
      : t("business.tipsActivity.noLocationDetail");

  return (
    <article className={businessUi.mobileCard}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-semibold tabular-nums text-foreground">{formatEur(tip.amount)}</p>
        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold">
          {statusLabel(tip.status)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
        {showStaffColumn ? (
          <div>
            <dt className="font-medium uppercase tracking-wide text-muted-foreground">
              {t("business.tipsActivity.thStaff")}
            </dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {tip.staffName ?? (userRole === "employee" ? youLabel : unknownStaffLabel)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.tipsActivity.thLocationTable")}
          </dt>
          <dd className="mt-0.5 text-sm text-muted-foreground">{locationDetail}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.tipsActivity.thDateTime")}
          </dt>
          <dd className="mt-0.5 text-sm text-muted-foreground">
            {formatVenueDateTime(tip.createdAt, resolveBusinessTimezone(dataTimezone), dateLocale)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

type TableItemMobileCardProps = {
  name: string;
  locationName: string;
  guestUrl: string;
  onCopy: () => void;
  copyLabel: string;
  copied?: boolean;
  qrDataUrl?: string;
  extraActions?: ReactNode;
};

export function TableItemMobileCard({
  name,
  locationName,
  guestUrl,
  onCopy,
  copyLabel,
  copied = false,
  qrDataUrl,
  extraActions,
}: TableItemMobileCardProps) {
  const { t } = useTranslation();

  return (
    <article className={businessUi.mobileCard}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{locationName}</p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copyLabel}
        </button>
      </div>
      {qrDataUrl ? (
        <div className="mt-3 flex justify-center rounded-xl border border-black/[0.08] bg-white p-2">
          <img src={qrDataUrl} alt="" className="h-28 w-28 object-contain" />
        </div>
      ) : null}
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("business.tablesPage.thGuestLink")}
        </p>
        <code className="mt-1 block break-all text-xs text-muted-foreground">{guestUrl}</code>
      </div>
      {extraActions ? <div className="mt-3 flex flex-wrap gap-2">{extraActions}</div> : null}
    </article>
  );
}

export type EmployeeGoalRow = {
  employeeId: string;
  name: string;
  goalPeriod: string;
  goalAmount: number;
  currentAmount: number;
  percent: number;
  status: string;
};

type EmployeeGoalMobileCardProps = {
  goal: EmployeeGoalRow;
  periodLabel: string;
  statusLabel: string;
  statusClassName: string;
};

export function EmployeeGoalMobileCard({
  goal,
  periodLabel,
  statusLabel,
  statusClassName,
}: EmployeeGoalMobileCardProps) {
  const { t } = useTranslation();

  return (
    <article className={businessUi.mobileCard}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold text-foreground">{goal.name}</p>
        <span className={cn("shrink-0 text-xs font-semibold", statusClassName)}>{statusLabel}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.dashboard.tablePeriod")}
          </dt>
          <dd className="mt-0.5 text-sm text-muted-foreground">{periodLabel}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.dashboard.tableProgress")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{goal.percent}%</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.dashboard.tableTarget")}
          </dt>
          <dd className="mt-0.5 text-sm tabular-nums">{formatEur(goal.goalAmount)}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.dashboard.tableCurrent")}
          </dt>
          <dd className="mt-0.5 text-sm tabular-nums">{formatEur(goal.currentAmount)}</dd>
        </div>
      </dl>
    </article>
  );
}
