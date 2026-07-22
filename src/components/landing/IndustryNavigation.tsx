import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type IndustryNavigationProps = {
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  className?: string;
};

/**
 * Optional keyboard-adjacent controls — discreet, CareTip-toned.
 */
export function IndustryNavigation({
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevDisabled = false,
  nextDisabled = false,
  className,
}: IndustryNavigationProps) {
  return (
    <div className={cn("caretip-industry-nav", className)}>
      <button
        type="button"
        className="caretip-industry-nav__btn"
        onClick={onPrev}
        aria-label={prevLabel}
        disabled={prevDisabled}
      >
        <ChevronUp strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="caretip-industry-nav__btn"
        onClick={onNext}
        aria-label={nextLabel}
        disabled={nextDisabled}
      >
        <ChevronDown strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
