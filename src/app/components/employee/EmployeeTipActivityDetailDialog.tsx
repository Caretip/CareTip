import { useTranslation } from "react-i18next";
import type { EmployeePayableActivityItem } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import {
  employeeTipActivityKind,
  employeeTipActivityReference,
  employeeTipActivityVenueLabel,
} from "../../lib/employeeTipActivityPresentation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type EmployeeTipActivityDetailDialogProps = {
  row: EmployeePayableActivityItem | null;
  timezone: string | null;
  locale: string;
  onClose: () => void;
};

export function EmployeeTipActivityDetailDialog({
  row,
  timezone,
  locale,
  onClose,
}: EmployeeTipActivityDetailDialogProps) {
  const { t } = useTranslation();
  if (!row) return null;

  const kind = employeeTipActivityKind(row);
  const tz = resolveBusinessTimezone(timezone);
  const grossEur = (row.grossCents ?? 0) / 100;
  const feeEur = (row.platformFeeCents ?? 0) / 100;
  const directEarningsEur = Math.max(0, row.payableCents - row.refundedCents) / 100;
  const earningsEur =
    row.routingMode === "business_distribution" ? 0 : directEarningsEur;
  const venue = employeeTipActivityVenueLabel(row);
  const ref = employeeTipActivityReference(row);

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(90vh,32rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`employee.tipActivity.event.${kind}`)}</DialogTitle>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("employee.tipActivity.detail.amount")}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatEur(grossEur)}</dd>
          </div>
          {venue ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("employee.tipActivity.detail.location")}
              </dt>
              <dd className="mt-0.5">{venue}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("employee.tipActivity.detail.date")}
            </dt>
            <dd className="mt-0.5">
              {formatVenueDateTime(row.transactionCreatedAt ?? row.createdAt, tz, locale)}
            </dd>
          </div>
          {row.platformFeeCents != null ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("employee.tipActivity.detail.fee")}
              </dt>
              <dd className="mt-0.5 tabular-nums">{formatEur(feeEur)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("employee.tipActivity.detail.earnings")}
            </dt>
            <dd className="mt-0.5 tabular-nums font-medium">{formatEur(earningsEur)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("employee.tipActivity.detail.routing")}
            </dt>
            <dd className="mt-0.5">
              {row.routingMode === "business_distribution"
                ? t("employee.tipActivity.detail.routingBusiness")
                : t("employee.tipActivity.detail.routingStripe")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("employee.tipActivity.detail.status")}
            </dt>
            <dd className="mt-0.5">{t(`employee.payouts.activityStatus.${kind}`)}</dd>
          </div>
          {ref ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("employee.tipActivity.detail.reference")}
              </dt>
              <dd className="mt-0.5 font-mono text-xs">{ref}</dd>
            </div>
          ) : null}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
