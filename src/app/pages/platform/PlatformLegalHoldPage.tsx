import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Search, Shield } from "lucide-react";
import {
  PlatformPage,
  PlatformPageHeader,
} from "../../components/platform/PlatformPageChrome";
import {
  PlatformLegalHoldPanel,
  type LegalHoldSubjectKind,
} from "../../components/platform/PlatformLegalHoldPanel";
import { platformUi } from "../../components/platform/platformDashboardUi";
import {
  searchPlatformLegalHoldSubjects,
  type PlatformLegalHoldSubjectHit,
} from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { cn } from "@/lib/utils";

function parseSubjectType(raw: string | null): LegalHoldSubjectKind {
  return raw === "user" ? "user" : "business";
}

type SelectedSubject = {
  id: string;
  label: string;
  secondary: string | null;
  subjectType: LegalHoldSubjectKind;
};

export function PlatformLegalHoldPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const initialType = parseSubjectType(params.get("type"));
  const initialId = (params.get("id") ?? "").trim();

  const [subjectType, setSubjectType] = useState<LegalHoldSubjectKind>(initialType);
  const [query, setQuery] = useState(initialId);
  const [idFallback, setIdFallback] = useState(initialId);
  const [hits, setHits] = useState<PlatformLegalHoldSubjectHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SelectedSubject | null>(
    initialId
      ? {
          id: initialId,
          label: initialId,
          secondary: null,
          subjectType: initialType,
        }
      : null,
  );
  const [loaded, setLoaded] = useState<SelectedSubject | null>(
    initialId
      ? {
          id: initialId,
          label: initialId,
          secondary: null,
          subjectType: initialType,
        }
      : null,
  );

  const canLoadSelected = useMemo(() => Boolean(selected?.id.trim()), [selected]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPlatformLegalHoldSubjects({ type: subjectType, q })
        .then((res) => {
          if (!cancelled) setHits(res.items ?? []);
        })
        .catch((e) => {
          if (!cancelled) {
            logClientError("PlatformLegalHoldPage.search", e);
            setHits([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, subjectType]);

  const selectHit = (hit: PlatformLegalHoldSubjectHit) => {
    const next: SelectedSubject = {
      id: hit.id,
      label: hit.label,
      secondary: hit.secondary,
      subjectType: hit.subjectType,
    };
    setSelected(next);
    setIdFallback(hit.id);
    setHits([]);
    setQuery(hit.label);
  };

  const applySelected = () => {
    if (!selected?.id.trim()) return;
    const next = {
      ...selected,
      id: selected.id.trim(),
      subjectType,
    };
    setLoaded(next);
    setParams({ type: next.subjectType, id: next.id });
  };

  const applyIdFallback = () => {
    const id = idFallback.trim();
    if (!id) return;
    const next: SelectedSubject = {
      id,
      label: selected?.id === id ? selected.label : id,
      secondary: selected?.id === id ? selected.secondary : null,
      subjectType,
    };
    setSelected(next);
    setLoaded(next);
    setParams({ type: subjectType, id });
  };

  const onSubjectTypeChange = (next: LegalHoldSubjectKind) => {
    setSubjectType(next);
    setHits([]);
    setSelected(null);
    setLoaded(null);
    setQuery("");
    setIdFallback("");
    setParams({});
  };

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={t("admin.legalHoldPage.title")}
        subtitle={t("admin.legalHoldPage.subtitle")}
      />

      <div className="space-y-6">
        <section
          className={cn(platformUi.contentCard, "space-y-4")}
          data-testid="legal-hold-lookup"
        >
          <p className="text-sm text-muted-foreground">{t("admin.legalHoldPage.lookupHint")}</p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block text-sm sm:w-44">
              <span className="text-muted-foreground">{t("admin.legalHoldPage.subjectType")}</span>
              <select
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={subjectType}
                onChange={(e) => onSubjectTypeChange(parseSubjectType(e.target.value))}
                data-testid="legal-hold-subject-type"
              >
                <option value="business">{t("admin.legalHoldPage.subject.business")}</option>
                <option value="user">{t("admin.legalHoldPage.subject.user")}</option>
              </select>
            </label>

            <div className="relative flex-1">
              <label className="block text-sm">
                <span className="text-muted-foreground">
                  {subjectType === "business"
                    ? t("admin.legalHoldPage.searchBusiness")
                    : t("admin.legalHoldPage.searchUser")}
                </span>
                <div className="relative mt-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    className="w-full min-h-[2.5rem] rounded-lg border border-border bg-background py-2 pl-10 pr-10 text-sm focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/12"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      subjectType === "business"
                        ? t("admin.legalHoldPage.searchBusinessPlaceholder")
                        : t("admin.legalHoldPage.searchUserPlaceholder")
                    }
                    data-testid="legal-hold-search-input"
                    autoComplete="off"
                  />
                  {searching ? (
                    <Loader2
                      className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
                      aria-hidden
                    />
                  ) : null}
                </div>
              </label>

              {hits.length > 0 ? (
                <ul
                  className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card shadow-md"
                  data-testid="legal-hold-search-results"
                  role="listbox"
                >
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                        onClick={() => selectHit(hit)}
                        data-testid={`legal-hold-search-hit-${hit.id}`}
                      >
                        <span className="font-medium text-foreground">{hit.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {[hit.secondary, hit.id].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <button
              type="button"
              className={cn(platformUi.btnPrimary, "px-4 py-2 text-sm disabled:opacity-50")}
              disabled={!canLoadSelected}
              onClick={applySelected}
              data-testid="legal-hold-load-btn"
            >
              {t("admin.legalHoldPage.load")}
            </button>
          </div>

          {selected ? (
            <div
              className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm"
              data-testid="legal-hold-selected-subject"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("admin.legalHoldPage.selectedSubject")}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {t(`admin.legalHoldPage.subject.${selected.subjectType}`)}: {selected.label}
              </p>
              {selected.secondary ? (
                <p className="text-xs text-muted-foreground">{selected.secondary}</p>
              ) : null}
              <p className="mt-0.5 text-xs text-muted-foreground break-all">
                {t("admin.legalHoldPage.subjectId")}: {selected.id}
              </p>
            </div>
          ) : null}

          <details className="text-sm" data-testid="legal-hold-id-fallback">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {t("admin.legalHoldPage.idLookupToggle")}
            </summary>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block flex-1 text-sm">
                <span className="text-muted-foreground">{t("admin.legalHoldPage.subjectId")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={idFallback}
                  onChange={(e) => setIdFallback(e.target.value)}
                  placeholder={t("admin.legalHoldPage.subjectIdPlaceholder")}
                  data-testid="legal-hold-subject-id"
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                disabled={!idFallback.trim()}
                onClick={applyIdFallback}
                data-testid="legal-hold-load-id-btn"
              >
                {t("admin.legalHoldPage.loadById")}
              </button>
            </div>
          </details>
        </section>

        {loaded ? (
          <PlatformLegalHoldPanel
            subjectType={loaded.subjectType}
            subjectId={loaded.id}
            subjectLabel={loaded.label}
          />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="legal-hold-empty">
            {t("admin.legalHoldPage.empty")}
          </p>
        )}
      </div>
    </PlatformPage>
  );
}
