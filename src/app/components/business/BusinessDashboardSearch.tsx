import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CreditCard,
  LayoutGrid,
  Search,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBusinessSearch } from "@/app/hooks/useBusinessSearch";
import {
  highlightMatchSegments,
  type BusinessSearchCategory,
  type BusinessSearchHit,
} from "@/app/lib/businessSearchIndex";

const CATEGORY_ORDER: BusinessSearchCategory[] = [
  "employees",
  "qrTables",
  "recentTips",
  "recentActivity",
  "billing",
  "payouts",
];

const CATEGORY_ICON: Record<BusinessSearchCategory, typeof Search> = {
  employees: Users,
  qrTables: LayoutGrid,
  recentTips: Wallet,
  recentActivity: Activity,
  billing: CreditCard,
  payouts: Wallet,
};

const inputClassName =
  "h-11 w-full min-w-0 rounded-xl border border-border/80 bg-card py-2 pl-10 pr-9 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-[#e9781c] focus:outline-none focus:ring-2 focus:ring-[#e9781c]/20";

function HighlightedText({ text, query }: { text: string; query: string }) {
  const parts = highlightMatchSegments(text, query);
  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark
            key={`${part.text}-${i}`}
            className="rounded-sm bg-[#e9781c]/15 px-0.5 font-medium text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${i}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

type BusinessDashboardSearchProps = {
  className?: string;
  /** Compact strip for mobile panel under header row. */
  variant?: "desktop" | "mobile";
  autoFocus?: boolean;
  onNavigate?: () => void;
};

export function BusinessDashboardSearch({
  className,
  variant = "desktop",
  autoFocus = false,
  onNavigate,
}: BusinessDashboardSearchProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { query, setQuery, debouncedQuery, results, isSearching } = useBusinessSearch();

  const grouped = useMemo(() => {
    const map = new Map<BusinessSearchCategory, BusinessSearchHit[]>();
    for (const hit of results) {
      const list = map.get(hit.category) ?? [];
      list.push(hit);
      map.set(hit.category, list);
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: map.get(category) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [results]);

  const flatResults = results;
  const showDropdown = open && debouncedQuery.trim().length > 0;

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [autoFocus]);

  useEffect(() => {
    setActiveIndex(flatResults.length > 0 ? 0 : -1);
  }, [debouncedQuery, flatResults.length]);

  useEffect(() => {
    if (!showDropdown) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showDropdown]);

  const goTo = useCallback(
    (hit: BusinessSearchHit) => {
      setOpen(false);
      setQuery("");
      onNavigate?.();
      navigate(hit.href);
    },
    [navigate, onNavigate, setQuery],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (showDropdown) setOpen(false);
      else setQuery("");
      return;
    }
    if (!showDropdown || flatResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? flatResults.length - 1 : i - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && flatResults[activeIndex]) {
      event.preventDefault();
      goTo(flatResults[activeIndex]);
    }
  };

  const categoryLabel = (category: BusinessSearchCategory) =>
    t(`business.globalSearch.categories.${category}`);

  let runningIndex = -1;

  return (
    <div
      ref={rootRef}
      className={cn(
        "caretip-business-dashboard-search relative min-w-0",
        variant === "desktop" && "hidden w-full max-w-[420px] lg:block",
        variant === "mobile" && "w-full",
        className,
      )}
      role="search"
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t("business.globalSearch.placeholder")}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label={t("business.globalSearch.aria")}
        aria-controls={listboxId}
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 && flatResults[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        className={inputClassName}
      />
      {query ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("business.globalSearch.clearAria")}
          onClick={() => {
            setQuery("");
            setOpen(false);
            inputRef.current?.focus();
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("business.globalSearch.resultsAria")}
          className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 max-h-[min(70vh,24rem)] overflow-y-auto rounded-xl border border-border/80 bg-card p-1.5 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.28),0_2px_8px_rgba(15,23,42,0.06)]"
        >
          {isSearching && flatResults.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("business.globalSearch.searching")}
            </p>
          ) : flatResults.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
                <Search className="h-4 w-4" aria-hidden />
              </span>
              <p className="text-sm font-medium text-foreground">
                {t("business.globalSearch.emptyTitle")}
              </p>
              <p className="text-xs text-muted-foreground">{t("business.globalSearch.emptyHint")}</p>
            </div>
          ) : (
            grouped.map((group) => {
              const Icon = CATEGORY_ICON[group.category];
              return (
                <section key={group.category} className="mb-1 last:mb-0">
                  <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {categoryLabel(group.category)}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((hit) => {
                      runningIndex += 1;
                      const index = runningIndex;
                      const active = index === activeIndex;
                      return (
                        <li key={hit.id} role="presentation">
                          <button
                            type="button"
                            id={`${listboxId}-option-${index}`}
                            role="option"
                            aria-selected={active}
                            className={cn(
                              "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                              active ? "bg-[#e9781c]/10" : "hover:bg-muted/70",
                            )}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => goTo(hit)}
                          >
                            <span
                              className={cn(
                                "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                                active
                                  ? "bg-[#e9781c]/15 text-[#e9781c]"
                                  : "bg-muted text-muted-foreground",
                              )}
                              aria-hidden
                            >
                              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                <HighlightedText
                                  text={hit.titleKey ? t(hit.titleKey) : hit.title}
                                  query={debouncedQuery}
                                />
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                <HighlightedText
                                  text={hit.subtitleKey ? t(hit.subtitleKey) : hit.subtitle}
                                  query={debouncedQuery}
                                />
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

type BusinessSearchChromeValue = {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const BusinessSearchChromeContext = createContext<BusinessSearchChromeValue | null>(null);

export function BusinessDashboardSearchProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const value = useMemo(() => ({ mobileOpen, setMobileOpen }), [mobileOpen]);
  return (
    <BusinessSearchChromeContext.Provider value={value}>{children}</BusinessSearchChromeContext.Provider>
  );
}

function useBusinessSearchChrome() {
  const ctx = useContext(BusinessSearchChromeContext);
  if (!ctx) {
    throw new Error("BusinessDashboardSearch mobile chrome requires BusinessDashboardSearchProvider");
  }
  return ctx;
}

export const BusinessDashboardSearchMobileToggle = memo(function BusinessDashboardSearchMobileToggle() {
  const { t } = useTranslation();
  const { mobileOpen, setMobileOpen } = useBusinessSearchChrome();

  return (
    <button
      type="button"
      className={cn(
        "caretip-dashboard-header-icon-btn caretip-dashboard-header-search-toggle lg:hidden",
        mobileOpen && "bg-muted",
      )}
      onClick={() => setMobileOpen(!mobileOpen)}
      aria-label={mobileOpen ? t("business.globalSearch.closeAria") : t("business.globalSearch.aria")}
      aria-expanded={mobileOpen}
    >
      {mobileOpen ? (
        <X className="h-4 w-4 text-foreground" aria-hidden />
      ) : (
        <Search className="h-4 w-4 text-foreground" aria-hidden />
      )}
    </button>
  );
});

export function BusinessDashboardSearchPanel() {
  const { mobileOpen, setMobileOpen } = useBusinessSearchChrome();
  if (!mobileOpen) return null;

  return (
    <div className="caretip-dashboard-header-search-panel border-t border-border/80 bg-background px-3 py-2.5 lg:hidden">
      <BusinessDashboardSearch
        variant="mobile"
        autoFocus
        onNavigate={() => setMobileOpen(false)}
      />
    </div>
  );
}
