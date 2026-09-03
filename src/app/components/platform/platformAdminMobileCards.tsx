import { Link } from "react-router";
import { UserCog } from "lucide-react";
import { OnboardingVerificationStatusChip } from "../verification/VerificationWorkflowStatusChip";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { GlobalTransactionRow, PlatformAuditLogRow, PlatformBusinessRow } from "../../lib/api";
import type { RefundRecord } from "../../lib/platformRefunds";
import { formatEur, formatOptionalEur } from "../../lib/formatEur";
import { BusinessLogoMark } from "../business/BusinessLogoMark";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

function payoutStatusLabel(status: string, t: TFunction) {
  const key = `admin.globalTransactionsPage.payoutStatus.${status}`;
  const label = t(key);
  return label === key ? status.replace(/_/g, " ") : label;
}

/** Align with platform analytics day buckets (cross-business list has no per-row TZ). */
const PLATFORM_TX_TIMEZONE = "Europe/Berlin";

function formatTransactionAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: PLATFORM_TX_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

export function PlatformTransactionMobileCard({ row }: { row: GlobalTransactionRow }) {
  const { t, i18n } = useTranslation();
  const payoutClass =
    row.payoutStatus === "paid"
      ? "bg-success text-success-foreground"
      : row.payoutStatus === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
        : row.payoutStatus === "not_applicable"
          ? "bg-muted text-muted-foreground"
          : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";

  return (
    <article className={platformUi.mobileCard}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-mono text-xs text-muted-foreground">{row.id}</p>
        <span className={cn("inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", payoutClass)}>
          {payoutStatusLabel(row.payoutStatus, t)}
        </span>
      </div>
      {row.stripePaymentIntentId ? (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{row.stripePaymentIntentId}</p>
      ) : null}
      <p className="mt-2 text-sm font-semibold text-foreground">{row.businessName}</p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground" title={row.createdAt}>
        {formatTransactionAt(row.createdAt, i18n.language)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.globalTransactionsPage.colAmountEur")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatEur(row.amountEur)}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.globalTransactionsPage.colNetToStaff")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatOptionalEur(row.netToStaffEur)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-medium text-muted-foreground">
            {t("admin.globalTransactionsPage.colCaretipFee")}
          </dt>
          <dd className="mt-0.5 text-sm tabular-nums text-muted-foreground">
            {t("admin.globalTransactionsPage.feeCell", {
              percent: row.caretipFeePercent,
              fixed: (row.caretipFeeFixedCents / 100).toFixed(2),
              amount: formatOptionalEur(row.caretipFeeEur),
            })}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function refundStatusLabel(status: string, t: TFunction): string {
  const key = `admin.refundsPage.status.${status}`;
  const label = t(key);
  return label === key ? status.replace(/_/g, " ") : label;
}

export function PlatformRefundMobileCard({
  row,
  onView,
}: {
  row: RefundRecord;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const statusClass =
    row.status === "processed" || row.status === "succeeded" || row.status === "won"
      ? "bg-success/15 text-success"
      : row.status === "failed" || row.status === "lost" || row.status === "canceled"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
        : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";

  return (
    <article className={platformUi.mobileCard}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-xs font-semibold text-foreground">{row.refundId}</p>
        <span className={cn("inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", statusClass)}>
          {refundStatusLabel(row.status, t)}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{row.businessName}</p>
      <p className="mt-1 text-xs text-muted-foreground">{row.employeeName}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.refundsPage.colRefundAmount")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatEur(row.refundAmountEur)}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.refundsPage.colReason")}
          </dt>
          <dd className="mt-0.5 text-sm">{t(`admin.refundsPage.reason.${row.reason}`, { defaultValue: row.reason })}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onView}
        className="mt-3 text-xs font-medium text-primary hover:underline"
      >
        {t("admin.refundsPage.view")}
      </button>
    </article>
  );
}

export function PlatformAuditLogMobileCard({
  row,
  formatTime,
}: {
  row: PlatformAuditLogRow;
  formatTime: (iso: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <article className={platformUi.mobileCard}>
      <p className="text-xs text-muted-foreground">{formatTime(row.createdAt)}</p>
      <p className="mt-2 font-mono text-sm font-semibold text-foreground">{row.action}</p>
      <p className="mt-1 break-all text-xs text-muted-foreground">{row.userEmail}</p>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {row.metadata ?? t("format.notAvailable")}
      </p>
    </article>
  );
}

export function PlatformUserMobileCard({
  business: b,
  busy,
  onImpersonate,
}: {
  business: PlatformBusinessRow;
  busy: boolean;
  onImpersonate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className={platformUi.mobileCard}>
      <div className="flex gap-3">
        <BusinessLogoMark logoPathOrUrl={b.logoPath ?? null} businessName={b.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-base font-semibold text-foreground">{b.name}</h4>
          <p className="mt-1 truncate text-xs text-muted-foreground">{b.ownerEmail}</p>
          <div className="mt-2">
            <OnboardingVerificationStatusChip status={b.onboardingVerificationStatus} />
          </div>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onImpersonate}
        className="mt-4 inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:bg-accent/90 disabled:opacity-50"
      >
        <UserCog className="h-4 w-4" aria-hidden />
        {busy ? t("admin.userManagementPage.opening") : t("admin.userManagementPage.impersonateCta")}
      </button>
    </article>
  );
}

export function PlatformBusinessVerificationMobileCard({
  business: b,
  onApprove,
  onReject,
  onDelete,
  onEdit,
  onOpenFile,
  busy = false,
}: {
  business: PlatformBusinessRow;
  onApprove: () => void;
  onReject: () => void;
  onDelete?: () => void;
  onEdit: () => void;
  onOpenFile: (path: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <article className={platformUi.mobileCard}>
      <div className="flex gap-3">
        <BusinessLogoMark logoPathOrUrl={b.logoPath ?? null} businessName={b.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 truncate text-base font-semibold text-foreground">{b.name}</h4>
            <OnboardingVerificationStatusChip status={b.onboardingVerificationStatus} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{b.slug}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{b.ownerEmail}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.businessVerificationPage.colContact")}
          </dt>
          <dd className="mt-0.5 text-foreground">{b.contactEmail ?? t("format.notAvailable")}</dd>
          {b.contactPhone ? <dd className="text-muted-foreground">{b.contactPhone}</dd> : null}
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t("admin.businessVerificationPage.colLiveTips")}
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatEur(b.totalTipsEur ?? 0)}</dd>
          <dd className="text-muted-foreground">
            {t("admin.businessVerificationPage.tipsStaffSummary", {
              tips: b.successTipCount ?? 0,
              staff: b.staffCount ?? 0,
            })}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {b.logoPath ? (
          <button type="button" onClick={() => onOpenFile(b.logoPath!)} className="text-accent hover:underline">
            {t("admin.businessVerificationPage.fileLogo")}
          </button>
        ) : null}
        {b.verificationDocumentPath ? (
          <button
            type="button"
            onClick={() => onOpenFile(b.verificationDocumentPath!)}
            className="text-accent hover:underline"
          >
            {t("admin.businessVerificationPage.fileKycDoc")}
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link
          to={`/platform-admin/businesses/${b.id}`}
          className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("admin.businessVerificationPage.linkViewDetails")}
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("admin.businessVerificationPage.linkEditDetails")}
        </button>
        {b.onboardingVerificationStatus !== "approved" ? (
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t("admin.businessDetailPage.approveOnboarding")}
          </button>
        ) : null}
        {b.onboardingVerificationStatus === "submitted" ? (
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg border border-destructive px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {t("admin.businessDetailPage.rejectOnboarding")}
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {t("admin.onboardingVerificationPage.btnDelete")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
