import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function InstantPayoutTermsCheckbox(props: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  termsPath: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const id = props.id ?? "instant-payout-terms";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-foreground">
        <input
          id={id}
          type="checkbox"
          className={cn(
            "mt-0.5 size-4 shrink-0 rounded border-border text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onCheckedChange(e.target.checked)}
          aria-describedby={`${id}-hint`}
        />
        <span>
          {t("payouts.instantTerms.acceptPrefix")}{" "}
          <Link
            to={props.termsPath}
            className="font-medium text-primary underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("payouts.instantTerms.link")}
          </Link>{" "}
          {t("payouts.instantTerms.acceptSuffix")}
        </span>
      </label>
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
