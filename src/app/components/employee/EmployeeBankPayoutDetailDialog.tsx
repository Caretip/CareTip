import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { EmployeeStripeBankPayoutItem } from "../../lib/api";
import { PayoutBankLifecycleDetail } from "../connect/PayoutBankLifecycleDetail";

export function EmployeeBankPayoutDetailDialog({
  open,
  onOpenChange,
  payout,
  bankPayoutSchedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payout: EmployeeStripeBankPayoutItem | null;
  bankPayoutSchedule: string | null;
}) {
  const { t, i18n } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="employee-bank-payout-detail-desc">
        <DialogHeader>
          <DialogTitle>{t("employee.payouts.bankHistory.detailTitle")}</DialogTitle>
          <DialogDescription id="employee-bank-payout-detail-desc">
            {t("employee.payouts.bankHistory.detailLead")}
          </DialogDescription>
        </DialogHeader>
        {payout ? (
          <PayoutBankLifecycleDetail
            locale={i18n.language}
            payout={{
              amountCents: payout.amountCents,
              currency: payout.currency,
              status: payout.status,
              stripeCreatedAt: payout.createdAt,
              arrivalDate: payout.arrivalDate,
              method: payout.method,
              payoutType: payout.payoutType ?? null,
              failureCode: payout.failureCode ?? null,
              failureMessage: payout.failureMessage ?? null,
              destinationLast4: payout.destinationLast4 ?? null,
              stripePayoutId: payout.stripePayoutId ?? null,
              initiationKind: payout.initiationKind ?? null,
              bankPayoutSchedule,
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
