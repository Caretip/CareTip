import { cn } from "@/lib/utils";
import { CareTipLogo } from "../../components/CareTipLogo";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneySupportFooter } from "./CustomerJourneySupportFooter";

type CustomerJourneyCareTipAttributionProps = {
  label: string;
  className?: string;
  /** compact — inline row for tight footers; default — trust strip */
  variant?: "strip" | "compact";
};

/**
 * Quaternary CareTip platform attribution — visible, consistent, never competes with venue branding.
 */
export function CustomerJourneyCareTipAttribution({
  label,
  className,
  variant = "strip",
}: CustomerJourneyCareTipAttributionProps) {
  return (
    <div
      className={cn(
        variant === "strip" ? cf.customerJourneyAttribution : cf.customerJourneyAttributionCompact,
        className,
      )}
      role="contentinfo"
      aria-label={label}
    >
      <CareTipLogo size="badge" className="shrink-0" />
      <span className={cf.customerJourneyAttributionLabel}>{label}</span>
    </div>
  );
}

/** Bottom-of-page support + attribution for pages that do not use `CustomerFlowShell`. */
export function CustomerJourneyAttributionFooter({ label }: { label: string }) {
  return <CustomerJourneySupportFooter label={label} />;
}
