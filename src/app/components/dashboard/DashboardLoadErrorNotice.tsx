import { useTranslation } from "react-i18next";

type DashboardLoadErrorNoticeProps = {
  message: string;
  onRetry: () => void;
};

/** A dashboard read failed: say so and offer a retry, rather than leaving a skeleton or an empty chart. */
export function DashboardLoadErrorNotice({ message, onRetry }: DashboardLoadErrorNoticeProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <p className="font-medium">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium text-primary underline underline-offset-2"
      >
        {t("dashboard.tryAgain")}
      </button>
    </div>
  );
}
