import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PlatformProductFeedbackAdminStatus } from "@/app/lib/api";
import { adminStatusLabelKey, adminStatusTone } from "./productFeedbackPresentation";

const toneClass: Record<ReturnType<typeof adminStatusTone>, string> = {
  attention:
    "border-primary/30 bg-primary/10 text-primary dark:bg-primary/15",
  neutral: "border-border bg-muted/50 text-foreground",
  muted: "border-border/60 bg-muted/30 text-muted-foreground",
};

export function ProductFeedbackStatusBadge({
  status,
  className,
}: {
  status: PlatformProductFeedbackAdminStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const tone = adminStatusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tracking-wide",
        toneClass[tone],
        className,
      )}
    >
      {t(adminStatusLabelKey(status))}
    </span>
  );
}
