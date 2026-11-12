/**
 * Admin Console primitives — the shared building blocks for every /platform-admin page.
 * Styling lives in src/styles/admin-console.css (`ac-*` classes, scoped under `.ac`).
 */
import type { CSSProperties, ElementType, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Inbox, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConsoleTone = "success" | "info" | "pending" | "attention" | "failure" | "dispute" | "neutral";

/* ───────────── page ───────────── */

export function ConsolePage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("ac platform-page min-w-0 overflow-x-hidden", className)}>
      <div className="ac-page">{children}</div>
    </div>
  );
}

export type ConsoleCrumb = { label: string; href?: string };

export function ConsoleHeader({
  icon: Icon,
  crumbs,
  title,
  description,
  meta,
  actions,
  back,
  status,
}: {
  icon?: ElementType;
  crumbs?: ConsoleCrumb[];
  title: ReactNode;
  description?: ReactNode;
  /** Small line under the description: freshness, ids, counts. */
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Status pill(s) shown next to the title. */
  status?: ReactNode;
}) {
  return (
    <header className="ac-header">
      <div className="ac-header__main">
        {back ? (
          <Link to={back.href} className="ac-back">
            <ArrowLeft aria-hidden />
            {back.label}
          </Link>
        ) : null}
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb">
            <ol className="ac-crumbs" style={{ listStyle: "none", padding: 0 }}>
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight aria-hidden /> : null}
                  {c.href ? <Link to={c.href}>{c.label}</Link> : <span>{c.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="ac-header__title-row">
          {Icon ? (
            <span className="ac-header__icon" aria-hidden>
              <Icon />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="ac-header__title">{title}</h1>
              {status}
            </div>
          </div>
        </div>
        {description ? <p className="ac-header__desc">{description}</p> : null}
        {meta ? <div className="ac-header__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="ac-header__aside">{actions}</div> : null}
    </header>
  );
}

/* ───────────── cards ───────────── */

export function ConsoleCard({
  title,
  description,
  icon: Icon,
  actions,
  footer,
  children,
  flush = false,
  plainHead = false,
  tone,
  className,
  bodyClassName,
  id,
  as: As = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ElementType;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Body without padding (tables, lists). */
  flush?: boolean;
  plainHead?: boolean;
  tone?: "accent" | "danger" | "muted";
  className?: string;
  bodyClassName?: string;
  id?: string;
  as?: ElementType;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <As id={id} className={cn("ac-card", tone && `ac-card--${tone}`, className)} aria-labelledby={title ? headingId : undefined}>
      {title || actions ? (
        <div className={cn("ac-card__head", plainHead && "ac-card__head--plain")}>
          <div className="min-w-0">
            {title ? (
              <h2 id={headingId} className="ac-card__title">
                {Icon ? <Icon aria-hidden /> : null}
                {title}
              </h2>
            ) : null}
            {description ? <p className="ac-card__desc">{description}</p> : null}
          </div>
          {actions ? <div className="ac-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? (
        <div className={cn("ac-card__body", flush && "ac-card__body--flush", bodyClassName)}>{children}</div>
      ) : null}
      {footer ? <div className="ac-card__foot">{footer}</div> : null}
    </As>
  );
}

export function ConsoleSectionLabel({ children }: { children: ReactNode }) {
  return <p className="ac-section-label">{children}</p>;
}

/* ───────────── KPI ───────────── */

export function ConsoleKpiGrid({
  children,
  columns = 4,
  label,
  className,
}: {
  children: ReactNode;
  columns?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("ac-kpis", className)}
      style={{ "--ac-kpi-cols": columns } as CSSProperties}
      role="list"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function ConsoleKpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
  cta,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ElementType;
  tone?: Exclude<ConsoleTone, "neutral" | "pending">;
  href?: string;
  cta?: string;
  loading?: boolean;
}) {
  const className = cn("ac-kpi", tone && `ac-kpi--${tone}`, loading && "ac-kpi--loading");
  const body = (
    <>
      <div className="ac-kpi__top">
        <p className="ac-kpi__label">{label}</p>
        {Icon ? (
          <span className="ac-kpi__icon" aria-hidden>
            <Icon />
          </span>
        ) : null}
      </div>
      <p className="ac-kpi__value" aria-busy={loading || undefined}>
        {loading ? "—" : value}
      </p>
      {hint ? <p className="ac-kpi__hint">{hint}</p> : null}
      {href && cta ? (
        <span className="ac-kpi__cta">
          {cta}
          <ArrowRight aria-hidden />
        </span>
      ) : null}
    </>
  );
  return href ? (
    <Link to={href} className={className} role="listitem">
      {body}
    </Link>
  ) : (
    <div className={className} role="listitem">
      {body}
    </div>
  );
}

/* ───────────── status ───────────── */

export function ConsoleStatus({
  tone = "neutral",
  children,
  size,
  title,
}: {
  tone?: ConsoleTone;
  children: ReactNode;
  size?: "lg";
  title?: string;
}) {
  return (
    <span className={cn("ac-status", `ac-status--${tone}`, size === "lg" && "ac-status--lg")} title={title}>
      <span>{children}</span>
    </span>
  );
}

export function ConsoleDot({ tone = "neutral" }: { tone?: ConsoleTone }) {
  return <span className={cn("ac-dot", `ac-dot--${tone}`)} aria-hidden />;
}

export function ConsoleCount({ value, tone }: { value: number | string; tone?: "attention" | "failure" }) {
  return <span className={cn("ac-count", tone && `ac-count--${tone}`)}>{value}</span>;
}

/* ───────────── toolbar ───────────── */

export type ConsoleSegmentOption<V extends string> = { value: V; label: string; count?: number };

export function ConsoleSegments<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<ConsoleSegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div className="ac-segments" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ac-segment"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {typeof o.count === "number" ? <span className="ac-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ConsoleSearch({
  value,
  onChange,
  placeholder,
  label,
  wide = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("ac-search", wide && "ac-search--wide")}>
      <Search aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
      />
    </div>
  );
}

export function ConsoleToolbar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <div className="ac-toolbar">
      <div className="min-w-0">{start}</div>
      {end ? <div className="ac-toolbar__end">{end}</div> : null}
    </div>
  );
}

/* ───────────── tables ───────────── */

/** Row props for a clickable table row (mouse + keyboard), without nesting interactive content. */
export function useRowLink() {
  const navigate = useNavigate();
  return (href: string) => ({
    "data-href": href,
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
      if (e.metaKey || e.ctrlKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      navigate(href);
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter") navigate(href);
    },
  });
}

export function ConsoleTable({
  children,
  stack = true,
  className,
  label,
}: {
  children: ReactNode;
  /** Rows become cards under 768px (cells need data-label). */
  stack?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <div className="ac-table-wrap">
      <table className={cn("ac-table", stack && "ac-table--stack", className)} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function ConsolePager({
  summary,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevDisabled,
  nextDisabled,
}: {
  summary: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="ac-pager">
      <span>{summary}</span>
      <div className="ac-pager__buttons">
        <button type="button" className="ac-btn ac-btn--secondary ac-btn--sm" onClick={onPrev} disabled={prevDisabled}>
          {prevLabel}
        </button>
        <button type="button" className="ac-btn ac-btn--secondary ac-btn--sm" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

/* ───────────── lists ───────────── */

export function ConsoleList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="ac-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function ConsoleListRow({
  title,
  subtitle,
  leading,
  end,
  href,
  chevron = Boolean(href),
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  end?: ReactNode;
  href?: string;
  chevron?: boolean;
}) {
  const body = (
    <>
      {leading}
      <div className="ac-list-row__main">
        <p className="ac-list-row__title">{title}</p>
        {subtitle ? <p className="ac-list-row__sub">{subtitle}</p> : null}
      </div>
      {end || chevron ? (
        <div className="ac-list-row__end">
          {end}
          {chevron ? <ChevronRight aria-hidden /> : null}
        </div>
      ) : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link to={href} className="ac-list-row">
          {body}
        </Link>
      ) : (
        <div className="ac-list-row">{body}</div>
      )}
    </li>
  );
}

export function ConsoleAvatar({ name, size }: { name?: string | null; size?: "sm" }) {
  const initials = (name ?? "?")
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return (
    <span className={cn("ac-avatar", size === "sm" && "ac-avatar--sm")} aria-hidden>
      {initials || "?"}
    </span>
  );
}

export type ConsoleDlItem = { label: ReactNode; value: ReactNode; full?: boolean; key?: string };

export function ConsoleDl({ items, columns = 2 }: { items: ConsoleDlItem[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("ac-dl", columns > 1 && `ac-dl--${columns}`)}>
      {items.map((item, i) => (
        <div key={item.key ?? i} className={item.full ? "ac-dl__full" : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ConsoleKv({ items }: { items: ConsoleDlItem[] }) {
  return (
    <dl className="ac-kv">
      {items.map((item, i) => (
        <div key={item.key ?? i}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────────── attention ───────────── */

export type ConsoleAttentionItem = {
  id: string;
  message: ReactNode;
  href: string;
  cta: string;
  severity: "critical" | "warning";
  icon?: ElementType;
};

export function ConsoleAttentionList({ items }: { items: ConsoleAttentionItem[] }) {
  return (
    <ul className="ac-attention">
      {items.map((item) => {
        const Icon = item.icon ?? AlertTriangle;
        return (
          <li key={item.id}>
            <Link
              to={item.href}
              className={cn("ac-attention__row", item.severity === "critical" && "ac-attention__row--critical")}
            >
              <span className="ac-attention__icon" aria-hidden>
                <Icon />
              </span>
              <span className="ac-attention__text">{item.message}</span>
              <span className="ac-attention__cta">
                {item.cta}
                <ArrowRight aria-hidden />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────── progress ───────────── */

export type ConsoleStepState = "done" | "current" | "upcoming" | "blocked";

export function ConsoleSteps({
  steps,
  label,
}: {
  steps: Array<{ key: string; label: string; state: ConsoleStepState; time?: string | null }>;
  label: string;
}) {
  return (
    <ol className="ac-steps" style={{ "--ac-steps": steps.length, listStyle: "none", padding: 0, margin: 0 } as CSSProperties} aria-label={label}>
      {steps.map((s) => (
        <li key={s.key} className={cn("ac-step", `ac-step--${s.state}`)} aria-current={s.state === "current" ? "step" : undefined}>
          <div className="ac-step__bar" />
          <p className="ac-step__label">{s.label}</p>
          {s.time ? <p className="ac-step__time">{s.time}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function ConsoleTimeline({
  items,
}: {
  items: Array<{ key: string; title: ReactNode; meta?: ReactNode; state: ConsoleStepState }>;
}) {
  return (
    <ol className="ac-timeline">
      {items.map((item) => (
        <li key={item.key} className={cn("ac-timeline__item", `ac-timeline__item--${item.state}`)}>
          <span className="ac-timeline__marker" aria-hidden>
            {item.state === "done" ? <Check /> : item.state === "blocked" ? <X /> : null}
          </span>
          <div className="min-w-0">
            <p className="ac-timeline__title">{item.title}</p>
            {item.meta ? <p className="ac-timeline__meta">{item.meta}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ───────────── feedback ───────────── */

export function ConsoleCallout({
  tone = "info",
  icon: Icon,
  title,
  children,
  action,
}: {
  tone?: "info" | "attention" | "failure" | "success" | "neutral";
  icon?: ElementType;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const I = Icon ?? AlertTriangle;
  return (
    <div className={cn("ac-callout", tone !== "neutral" && `ac-callout--${tone}`)} role={tone === "failure" ? "alert" : undefined}>
      <I aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="ac-callout__title">{title}</p> : null}
        {children ? <div className="ac-callout__body">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

export function ConsoleEmpty({
  icon: Icon = Inbox,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ElementType;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("ac-empty", compact && "ac-empty--compact")}>
      <span className="ac-empty__icon" aria-hidden>
        <Icon />
      </span>
      <p className="ac-empty__title">{title}</p>
      {description ? <p className="ac-empty__desc">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ConsoleSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ac-skeleton" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function ConsoleMeter({ value, max, brand }: { value: number; max: number; brand?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn("ac-meter", brand && "ac-meter--brand")} role="presentation">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Segmented proportion bar with a legend (status mixes). */
export function ConsoleSplitBar({
  parts,
  label,
}: {
  parts: Array<{ key: string; label: string; value: number; color: string }>;
  label: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="ac-split-bar" role="img" aria-label={label}>
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)
          : null}
      </div>
      <ul className="ac-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="ac-dot" style={{ background: p.color }} aria-hidden />
            {p.label} <b>{p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Theme-aware chart palette (brand orange first, then neutrals and semantic hues). */
export const CONSOLE_CHART = {
  brand: "#eb992c",
  ink: "hsl(var(--foreground))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
  success: "#1f9d55",
  info: "#2f6fdf",
  failure: "#d93025",
  dispute: "#7c4ddb",
  neutral: "#a8a29e",
} as const;

/* ───────────── tabs ───────────── */

export type ConsoleTab<V extends string> = { value: V; label: string; count?: number; icon?: ElementType };

/** Page-level tabs (ARIA tablist). Panels use id `${idBase}-panel-${value}`. */
export function ConsoleTabs<V extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: ReadonlyArray<ConsoleTab<V>>;
  value: V;
  onChange: (value: V) => void;
  label: string;
  idBase: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.value);
    document.getElementById(`${idBase}-tab-${next.value}`)?.focus();
  };
  return (
    <div className="ac-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            id={`${idBase}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            className="ac-tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {Icon ? <Icon aria-hidden /> : null}
            {tab.label}
            {typeof tab.count === "number" ? <span className="ac-count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ConsoleTabPanel({
  idBase,
  value,
  children,
}: {
  idBase: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      className="ac-stack ac-stack--lg"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
