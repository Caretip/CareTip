import { cn } from "@/lib/utils";

export type HospitalityFeatureItem = {
  title: string;
  text: string;
};

type HospitalityFeatureListProps = {
  features: HospitalityFeatureItem[];
  className?: string;
};

/** Numbered editorial outcomes for #built-for-hospitality — no checks or cards. */
export function HospitalityFeatureList({ features, className }: HospitalityFeatureListProps) {
  if (features.length === 0) return null;

  return (
    <ol className={cn("caretip-hospitality-outcomes", className)}>
      {features.map((feature, index) => {
        const n = String(index + 1).padStart(2, "0");
        return (
          <li key={`${n}-${feature.title}`} className="caretip-hospitality-outcomes__item">
            <span className="caretip-hospitality-outcomes__index" aria-hidden>
              {n}
            </span>
            <div className="caretip-hospitality-outcomes__body">
              <h3 className="caretip-hospitality-outcomes__title">{feature.title}</h3>
              <p className="caretip-hospitality-outcomes__desc">{feature.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
