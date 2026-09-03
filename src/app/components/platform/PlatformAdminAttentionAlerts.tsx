import { Link } from "react-router";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type PlatformAdminAlert = {
  id: string;
  message: string;
  href: string;
  severity?: "warning" | "critical";
};

type PlatformAdminAttentionAlertsProps = {
  alerts: PlatformAdminAlert[];
  className?: string;
};

export function PlatformAdminAttentionAlerts({ alerts, className }: PlatformAdminAttentionAlertsProps) {
  const { t } = useTranslation();

  if (alerts.length === 0) return null;

  return (
    <section
      className={cn("border-b border-border/70 pb-6", className)}
      aria-labelledby="platform-attention-heading"
    >
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <h2 id="platform-attention-heading" className="text-sm font-semibold text-foreground">
          {t("admin.overview.alerts.title")}
        </h2>
      </div>
      <ul className="divide-y divide-border/60">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <Link
              to={alert.href}
              className={cn(
                "group flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-foreground",
                alert.severity === "critical" && "text-destructive",
              )}
            >
              <span className="min-w-0 text-foreground">{alert.message}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                {t("admin.overview.alerts.review")}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
