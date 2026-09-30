import { useTranslation } from "react-i18next";
import { localizeFeedbackTag } from "@/app/lib/feedbackTagLabels";

export function FeedbackTagRankList({
  entries,
  emptyLabel,
}: {
  entries: Array<[string, number]>;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const max = Math.max(1, ...entries.map(([, c]) => c));

  if (entries.length === 0) {
    return (
      <div className="caretip-feedback-insight-empty">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className="caretip-feedback-rank-list">
      {entries.map(([tag, count]) => (
        <li key={tag} className="caretip-feedback-rank-list__item">
          <div className="caretip-feedback-rank-list__row">
            <span className="caretip-feedback-rank-list__label truncate">
              {localizeFeedbackTag(tag, t)}
            </span>
            <span className="caretip-feedback-rank-list__count tabular-nums">{count}</span>
          </div>
          <div className="caretip-feedback-rank-list__track" aria-hidden>
            <div
              className="caretip-feedback-rank-list__bar"
              style={{ width: `${Math.round((count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
