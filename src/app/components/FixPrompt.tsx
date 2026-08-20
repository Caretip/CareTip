import { useCallback, useEffect, useId } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSetupPromptIntelligence } from "../hooks/useSetupPromptIntelligence";
import type { SetupPromptKind } from "../lib/setupNotificationIntelligence";

/** Dashboard setup prompts — lifecycle is server Class S intelligence. */
export const FIX_PROMPT_IDS = [
  "missingQR",
  "pendingVerification",
  "stripeConnect",
  "profilePhoto",
] as const;

export type FixPromptId = (typeof FIX_PROMPT_IDS)[number];

const ID_TO_KIND: Record<FixPromptId, SetupPromptKind> = {
  missingQR: "missing_employee_qr",
  pendingVerification: "onboarding_verification",
  stripeConnect: "stripe_connect",
  profilePhoto: "profile_photo",
};

export type FixPromptTone = "default" | "info";
export type FixPromptDensity = "default" | "compact";

export type FixPromptProps = {
  id: FixPromptId;
  issueActive: boolean;
  /** Fingerprint of the unresolved condition (e.g. not_ready, rejected). */
  conditionVersion: string;
  title: string;
  description?: string;
  density?: FixPromptDensity;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  secondaryTo?: string;
  onSecondaryClick?: () => void;
  /** @deprecated Ignored — dismiss is server-backed. Kept for call-site compatibility. */
  dismissPersistence?: "local" | "session";
  tone?: FixPromptTone;
  className?: string;
  enabled?: boolean;
};

export function FixPrompt({
  id,
  issueActive,
  conditionVersion,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  secondaryLabel,
  secondaryTo,
  onSecondaryClick,
  tone = "default",
  density = "default",
  className,
  enabled = true,
}: FixPromptProps) {
  const panelId = useId();
  const kind = ID_TO_KIND[id];
  const { loading, show, dismiss, markActioned } = useSetupPromptIntelligence({
    kind,
    conditionActive: issueActive,
    conditionVersion,
    enabled,
  });

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show, dismiss]);

  const handlePrimaryClick = useCallback(() => {
    markActioned();
    onAction?.();
  }, [markActioned, onAction]);

  if (loading || !show) return null;

  const hasSecondary = Boolean(secondaryLabel && (secondaryTo || onSecondaryClick));
  const hasPrimary = Boolean(actionLabel && (actionTo || onAction));
  const hasActions = hasSecondary || hasPrimary;
  const compact = density === "compact";

  const shell =
    tone === "info"
      ? compact
        ? "fix-prompt--info border-primary/20 bg-muted/30"
        : "border-2 border-primary/30 bg-muted/40"
      : compact
        ? "fix-prompt--default"
        : "border-2 border-primary bg-muted/50 shadow-sm";

  return (
    <div
      className={cn(
        "fix-prompt relative text-sm text-foreground",
        compact ? cn("fix-prompt--compact", shell) : cn("rounded-xl p-4 pt-3 pr-14 sm:pr-16", shell),
        className,
      )}
      role="region"
      aria-labelledby={panelId}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className={cn(
          "fix-prompt__dismiss absolute inline-flex items-center justify-center rounded-md",
          compact
            ? "right-1 top-1 min-h-[28px] min-w-[28px]"
            : "right-2 top-2 min-h-[32px] min-w-[32px]",
          "text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <X className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      </button>

      <div
        className={cn(
          "fix-prompt__body",
          compact
            ? cn(
                "flex flex-col gap-2",
                hasActions && "sm:flex-row sm:items-center sm:justify-between sm:gap-3",
              )
            : cn("flex flex-col gap-3 sm:gap-4", hasActions && "sm:flex-row sm:items-center sm:justify-between"),
        )}
      >
        <div className={cn("min-w-0 flex-1", compact && "fix-prompt__text")}>
          <p id={panelId} className={cn(compact ? "fix-prompt__title" : "font-semibold text-foreground")}>
            {title}
          </p>
          {description ? (
            <p className={cn(compact ? "fix-prompt__description" : "mt-1 text-muted-foreground")}>{description}</p>
          ) : null}
        </div>
        {hasActions ? (
          <div
            className={cn(
              "fix-prompt__actions flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end",
              compact && "gap-1.5",
            )}
          >
            {hasSecondary ? (
              secondaryTo ? (
                <Button variant="ghost" size="sm" className="h-9 justify-start px-2 sm:justify-center" asChild>
                  <Link to={secondaryTo!}>{secondaryLabel}</Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" type="button" className="h-9" onClick={onSecondaryClick}>
                  {secondaryLabel}
                </Button>
              )
            ) : null}
            {hasPrimary ? (
              actionTo ? (
                <Button className="h-9 shrink-0 bg-primary hover:bg-primary/90" asChild>
                  <Link to={actionTo} onClick={() => markActioned()}>
                    {actionLabel}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-9 shrink-0 bg-primary hover:bg-primary/90"
                  onClick={handlePrimaryClick}
                >
                  {actionLabel}
                </Button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
