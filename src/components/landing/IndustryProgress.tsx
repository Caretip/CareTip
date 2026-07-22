import { cn } from "@/lib/utils";

export type IndustryProgressProps = {
  index: number;
  total: number;
  labels: string[];
  onSelect: (index: number) => void;
  className?: string;
};

/**
 * Subtle progress — index counter + dots for orientation.
 */
export function IndustryProgress({
  index,
  total,
  labels,
  onSelect,
  className,
}: IndustryProgressProps) {
  const current = String(index + 1).padStart(2, "0");
  const max = String(total).padStart(2, "0");

  return (
    <div className={cn("caretip-industry-progress", className)}>
      <p className="caretip-industry-progress__count" aria-hidden>
        <span className="caretip-industry-progress__current">{current}</span>
        <span className="caretip-industry-progress__sep">/</span>
        <span className="caretip-industry-progress__total">{max}</span>
      </p>

      <div
        className="caretip-industry-progress__dots"
        role="tablist"
        aria-label="Industries"
      >
        {Array.from({ length: total }, (_, i) => (
          <button
            key={labels[i] ?? i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={labels[i] ?? `Industry ${i + 1}`}
            className={cn(
              "caretip-industry-progress__dot",
              i === index && "caretip-industry-progress__dot--active",
            )}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}
