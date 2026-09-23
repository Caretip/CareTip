import { useTranslation } from "react-i18next";
import { MerchantLegalAcceptanceCheckbox } from "@/app/components/legal/MerchantLegalAcceptanceCheckbox";
import { cn } from "@/lib/utils";

export function InstantPayoutTermsCheckbox(props: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** @deprecated No longer used — all legal documents are linked in the checkbox label. */
  termsPath?: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const id = props.id ?? "instant-payout-terms";
  return (
    <div className="space-y-1.5">
      <MerchantLegalAcceptanceCheckbox
        id={id}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
        dense
        className={cn(props.disabled && "pointer-events-none opacity-50")}
      />
      {!props.checked ? (
        <p id={`${id}-hint`} className="pl-6 text-xs text-muted-foreground">
          {t("payouts.instantTerms.required")}
        </p>
      ) : (
        <p id={`${id}-hint`} className="sr-only">
          {t("payouts.instantTerms.accepted")}
        </p>
      )}
    </div>
  );
}
