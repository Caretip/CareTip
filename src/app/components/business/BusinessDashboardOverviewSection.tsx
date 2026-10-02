import type { ReactNode } from "react";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

type BusinessDashboardOverviewSectionProps = {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lighter sections (goals, feedback) vs primary period block */
  tone?: "primary" | "secondary";
};

export function BusinessDashboardOverviewSection({
  id,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  tone = "primary",
}: BusinessDashboardOverviewSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "business-overview-section",
        tone === "primary" && "business-overview-section--primary",
        tone === "secondary" && "business-overview-section--secondary",
        className,
      )}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <header className="business-overview-section__head">
        <div className="business-overview-section__lead min-w-0">
          {eyebrow ? <p className={dashboardWorkspaceUi.eyebrow}>{eyebrow}</p> : null}
          <h2 id={id ? `${id}-heading` : undefined} className={dashboardWorkspaceUi.sectionTitle}>
            {title}
          </h2>
          {description ? (
            <p className={cn(dashboardWorkspaceUi.pageDescription, "business-overview-section__desc !mt-1")}>
              {description}
            </p>
          ) : null}
          {actions ? (
            <div className="business-overview-section__meta">{actions}</div>
          ) : null}
        </div>
      </header>
      <div className="business-overview-section__body">{children}</div>
    </section>
  );
}
