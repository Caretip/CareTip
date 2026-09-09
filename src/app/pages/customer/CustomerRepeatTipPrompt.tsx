import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { customerFlowUi as cf } from "./customerFlowUi";

type CustomerRepeatTipPromptProps = {
  employeeName: string;
  employeeAvatar?: string | null;
  body: string;
  lastTipLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDisabled?: boolean;
};

export function CustomerRepeatTipPrompt({
  employeeName,
  employeeAvatar,
  body,
  lastTipLabel,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
}: CustomerRepeatTipPromptProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ProfileAvatar
          src={employeeAvatar}
          displayName={employeeName}
          variant="square"
          lightbox={false}
          className={`h-11 w-11 shrink-0 ${cf.employeePhotoSquare}`}
        />
        <div className="min-w-0">
          <p className="text-sm leading-snug text-muted-foreground">{body}</p>
          <p className="mt-1 text-xs font-medium text-foreground">{lastTipLabel}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className={`${cf.btnPrimaryLg} py-3 text-sm sm:flex-1`}
        >
          {primaryLabel}
        </button>
        <button type="button" onClick={onSecondary} className={`${cf.btnSecondaryLg} py-3 text-sm sm:flex-1`}>
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
