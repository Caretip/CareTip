/**
 * Platform Admin — Legal Hold panel (Slice G APIs only).
 * Does not invent categories or retention rules; uses backend validation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  PLATFORM_LEGAL_HOLD_CATEGORIES,
  clearPlatformBusinessLegalHold,
  clearPlatformUserLegalHold,
  fetchPlatformBusinessLegalHold,
  fetchPlatformUserLegalHold,
  setPlatformBusinessLegalHold,
  setPlatformUserLegalHold,
  type PlatformLegalHoldState,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { platformUi } from "./platformDashboardUi";
import { cn } from "@/lib/utils";

export type LegalHoldSubjectKind = "user" | "business";

type PlatformLegalHoldPanelProps = {
  subjectType: LegalHoldSubjectKind;
  subjectId: string;
  /** Optional label shown in the header (e.g. business name). */
  subjectLabel?: string;
  className?: string;
};

function formatSetAt(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PlatformLegalHoldPanel({
  subjectType,
  subjectId,
  subjectLabel,
  className,
}: PlatformLegalHoldPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("de") ? "de-DE" : "en-GB";
  const [state, setState] = useState<PlatformLegalHoldState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const id = subjectId.trim();
  const categories = useMemo(() => [...PLATFORM_LEGAL_HOLD_CATEGORIES], []);
  const isActive = Boolean(state?.legalHold);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const next =
        subjectType === "user"
          ? await fetchPlatformUserLegalHold(id)
          : await fetchPlatformBusinessLegalHold(id);
      setState(next);
      setReason(next.legalHold ? (next.legalHoldReason ?? "") : "");
      setSelected(next.legalHold ? (next.legalHoldCategories ?? []) : []);
    } catch (e) {
      logClientError("PlatformLegalHoldPanel.load", e);
      toast.error(toUserFriendlyMessage(e));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [id, subjectType]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCategory = (cat: string) => {
    setSelected((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const onPlaceHold = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error(t("admin.legalHoldPage.reasonRequired"));
      return;
    }
    if (selected.length === 0) {
      toast.error(t("admin.legalHoldPage.categoriesRequired"));
      return;
    }
    const confirmed = window.confirm(t("admin.legalHoldPage.confirmSet"));
    if (!confirmed) return;

    setSaving(true);
    try {
      const next =
        subjectType === "user"
          ? await setPlatformUserLegalHold(id, {
              reason: trimmedReason,
              categories: selected,
            })
          : await setPlatformBusinessLegalHold(id, {
              reason: trimmedReason,
              categories: selected,
            });
      setState(next);
      setReason(next.legalHoldReason ?? "");
      setSelected(next.legalHoldCategories ?? []);
      toast.success(t("admin.legalHoldPage.setSuccess"));
    } catch (e) {
      logClientError("PlatformLegalHoldPanel.set", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onClearHold = async () => {
    const confirmed = window.confirm(t("admin.legalHoldPage.confirmClear"));
    if (!confirmed) return;

    setSaving(true);
    try {
      const next =
        subjectType === "user"
          ? await clearPlatformUserLegalHold(id)
          : await clearPlatformBusinessLegalHold(id);
      setState(next);
      setReason("");
      setSelected([]);
      toast.success(t("admin.legalHoldPage.clearSuccess"));
    } catch (e) {
      logClientError("PlatformLegalHoldPanel.clear", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!id) return null;

  return (
    <section
      className={cn(platformUi.contentCard, "space-y-4", className)}
      data-testid="platform-legal-hold-panel"
      data-subject-type={subjectType}
      data-subject-id={id}
      data-hold-active={isActive ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 text-primary shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {t("admin.legalHoldPage.panelTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.legalHoldPage.panelHint")}
          </p>
          {subjectLabel ? (
            <p className="mt-2 text-sm font-medium text-foreground" data-testid="legal-hold-subject-label">
              {t(`admin.legalHoldPage.subject.${subjectType}`)}: {subjectLabel}
            </p>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("admin.legalHoldPage.loading")}
        </div>
      ) : (
        <>
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              isActive
                ? "border-amber-500/30 bg-amber-500/10 text-foreground"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
            data-testid="legal-hold-status-badge"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isActive ? "bg-amber-600" : "bg-muted-foreground/50",
              )}
              aria-hidden
            />
            <span className="font-medium" data-testid="legal-hold-status">
              {isActive
                ? t("admin.legalHoldPage.statusActive")
                : t("admin.legalHoldPage.statusInactive")}
            </span>
          </div>

          {isActive ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("admin.legalHoldPage.reason")}</dt>
                <dd className="font-medium break-words mt-0.5" data-testid="legal-hold-reason">
                  {state?.legalHoldReason?.trim()
                    ? state.legalHoldReason
                    : t("admin.legalHoldPage.none")}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("admin.legalHoldPage.categories")}</dt>
                <dd className="mt-1.5" data-testid="legal-hold-categories">
                  {state?.legalHoldCategories?.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {state.legalHoldCategories.map((cat) => (
                        <li
                          key={cat}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium"
                        >
                          {cat}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="font-medium">{t("admin.legalHoldPage.none")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.legalHoldPage.setAt")}</dt>
                <dd className="font-medium mt-0.5" data-testid="legal-hold-set-at">
                  {formatSetAt(state?.legalHoldSetAt ?? null, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.legalHoldPage.setBy")}</dt>
                <dd className="font-medium break-all mt-0.5" data-testid="legal-hold-set-by">
                  {state?.legalHoldSetByUserId ?? t("admin.legalHoldPage.none")}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="legal-hold-inactive-hint">
              {t("admin.legalHoldPage.inactiveHint")}
            </p>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            {!isActive ? (
              <>
                <label className="block text-sm">
                  <span className="text-muted-foreground">
                    {t("admin.legalHoldPage.reasonInput")}
                  </span>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[72px]"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={2000}
                    data-testid="legal-hold-reason-input"
                    disabled={saving}
                  />
                </label>

                <fieldset className="space-y-2" disabled={saving}>
                  <legend className="text-sm text-muted-foreground">
                    {t("admin.legalHoldPage.categoriesInput")}
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {categories.map((cat) => (
                      <label
                        key={cat}
                        className="flex items-center gap-2 text-xs sm:text-sm rounded-md border border-border px-2 py-1.5 bg-background/60"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(cat)}
                          onChange={() => toggleCategory(cat)}
                          data-testid={`legal-hold-cat-${cat}`}
                        />
                        <span>{cat}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    className={cn(platformUi.btnPrimary, "px-4 py-2 text-sm disabled:opacity-50")}
                    disabled={saving}
                    onClick={() => void onPlaceHold()}
                    data-testid="legal-hold-set-btn"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      t("admin.legalHoldPage.setHold")
                    )}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                    disabled={saving}
                    onClick={() => void load()}
                  >
                    {t("admin.legalHoldPage.refresh")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  disabled={saving}
                  onClick={() => void onClearHold()}
                  data-testid="legal-hold-clear-btn"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    t("admin.legalHoldPage.clearHold")
                  )}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  disabled={saving}
                  onClick={() => void load()}
                >
                  {t("admin.legalHoldPage.refresh")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
