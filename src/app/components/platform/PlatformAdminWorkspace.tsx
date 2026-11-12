import type { CSSProperties, ReactNode } from "react";
import { Children } from "react";
import { cn } from "@/lib/utils";
import { ConsoleEmpty } from "./console/AdminConsole";

/** Section with a labelled header; content usually holds cards, tables or KPI grids. */
export function PlatformAdminSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = title ? `${id ?? "section"}-title` : undefined;
  return (
    <section id={id} className={cn("platform-admin-section flex min-w-0 flex-col gap-3", className)} aria-labelledby={headingId}>
      {(title || actions) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {title ? (
              <h2 id={headingId} className="ac-card__title" style={{ fontSize: "1.05rem" }}>
                {title}
              </h2>
            ) : null}
            {description ? <p className="ac-card__desc">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/** KPI band: each PlatformAdminMetricCell renders as a tile. */
export function PlatformAdminMetricStrip({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const count = Children.toArray(children).filter(Boolean).length;
  const cols = Math.min(Math.max(count, 2), count > 4 && count % 3 === 0 ? 3 : 4);
  return (
    <div
      className={cn("ac-kpis platform-admin-metric-strip--console", className)}
      style={{ "--ac-kpi-cols": cols } as CSSProperties}
      role="list"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function PlatformAdminFilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("ac-card flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4", className)}>{children}</div>
  );
}

export function PlatformAdminEmptyBlock({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ac-card", className)}>
      <ConsoleEmpty title={title} description={description} action={action} />
    </div>
  );
}
