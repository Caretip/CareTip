import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Eye, RefreshCw, Scale } from "lucide-react";
import {
  fetchDisputeEvidenceSuggestion,
  fetchPlatformDispute,
  fetchPlatformDisputes,
  fetchPlatformDisputeSummary,
  cancelPlatformDisputeRecovery,
  fetchPlatformDisputeRecoveryContext,
  recoverPlatformDispute,
  retryPlatformDisputeRecovery,
  type DisputeRecoveryContext,
  saveDisputeEvidenceDraft,
  submitDisputeEvidence,
  syncPlatformDispute,
  updatePlatformDisputeInternal,
  type EvidenceSuggestion,
  type PlatformDisputeDetail,
  type DisputeExplanation,
  type PlatformDisputeListItem,
  type PlatformDisputeView,
} from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { DashboardListSkeleton } from "../../../components/dashboard/DashboardSectionLoading";
import {
  PlatformAdminStatusBadge,
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../../components/platform/PlatformPageChrome";
import type { PlatformAdminStatusTone } from "../../../components/platform/PlatformAdminDesignPrimitives";
import { platformUi } from "../../../components/platform/platformDashboardUi";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../../components/shared/ListFilterLoadError";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";

const PAGE_SIZE = 25;
const VIEWS: PlatformDisputeView[] = [
  "open",
  "needs_evidence",
  "deadline_soon",
  "awaiting_decision",
  "won",
  "lost",
  "funds_withdrawn",
  "funds_reinstated",
  "recovery_attention",
  "sync_errors",
  "all",
];
const INVESTIGATION = ["new", "investigating", "evidence_in_preparation", "awaiting_stripe_decision", "closed"];
const EVIDENCE_FIELDS = [
  "product_description",
  "customer_name",
  "customer_email_address",
  "service_date",
  "shipping_tracking_number",
  "refund_policy_disclosure",
  "refund_refusal_explanation",
  "customer_purchase_ip",
  "uncategorized_text",
];

function money(cents: number | null | undefined, currency = "eur", locale = "de-DE"): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function when(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  } catch {
    return iso;
  }
}

function stripeTone(status: string): PlatformAdminStatusTone {
  if (status === "won" || status === "warning_closed") return "success";
  if (status === "lost") return "failure";
  if (status.endsWith("needs_response")) return "attention";
  if (status.endsWith("under_review")) return "pending";
  return "neutral";
}

function recoveryTone(status: string): PlatformAdminStatusTone {
  if (status === "recovered" || status === "not_required") return "success";
  if (status === "failed") return "failure";
  if (status === "review_required" || status === "partially_recovered") return "attention";
  if (status === "in_progress") return "pending";
  return "neutral";
}

export function PlatformDisputesPage() {
  const { t, i18n } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get("view") as PlatformDisputeView | null) ?? "open";
  const q = sp.get("q") ?? "";
  const page = Math.max(0, Number(sp.get("page") ?? "0") || 0);
  const openId = sp.get("dispute");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [items, setItems] = useState<PlatformDisputeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => window.clearTimeout(id);
  }, [q]);

  const patchParams = useCallback(
    (next: Record<string, string | null>) => {
      const copy = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === "") copy.delete(k);
        else copy.set(k, v);
      }
      setSp(copy, { replace: true });
    },
    [sp, setSp],
  );

  const load = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [list, counts] = await Promise.all([
        fetchPlatformDisputes({ view, q: debouncedQ || undefined, take: PAGE_SIZE, skip: page * PAGE_SIZE }),
        fetchPlatformDisputeSummary(),
      ]);
      if (g !== gen.current) return;
      setItems(list.items);
      setTotal(list.total);
      setSummary(counts);
    } catch (e) {
      if (g !== gen.current) return;
      logClientError("PlatformDisputesPage", e);
      setLoadError(toUserFriendlyMessage(e));
      setItems([]);
      setTotal(0);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [view, debouncedQ, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const footer =
    !loading && !loadError && total > PAGE_SIZE ? (
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="min-h-[40px] rounded-lg border border-border px-3 text-xs" disabled={page === 0} onClick={() => patchParams({ page: page > 1 ? String(page - 1) : null })}>
          {t("admin.refundsPage.prevPage")}
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {page + 1} / {pageCount}
        </span>
        <button type="button" className="min-h-[40px] rounded-lg border border-border px-3 text-xs" disabled={page + 1 >= pageCount} onClick={() => patchParams({ page: String(page + 1) })}>
          {t("admin.refundsPage.nextPage")}
        </button>
      </div>
    ) : undefined;

  const row = (d: PlatformDisputeListItem) => (
    <tr key={d.id} className={platformUi.tableRow}>
      <td className={`${platformUi.tableTd} font-mono text-xs`} title={d.stripeDisputeId}>
        {d.stripeDisputeId.slice(0, 14)}…{d.livemode ? "" : ` (${t("admin.disputesPage.testMode")})`}
      </td>
      <td className={platformUi.tableTd}>{d.businessName ?? "—"}</td>
      <td className={platformUi.tableTd}>{t(`admin.disputesPage.subject.${d.subjectKind}`)}</td>
      <td className={`${platformUi.tableTd} text-right tabular-nums`}>{money(d.amountCents, d.currency, i18n.language)}</td>
      <td className={platformUi.tableTd}>
        <PlatformAdminStatusBadge label={t(`admin.disputesPage.stripeStatus.${d.stripeStatus}`, { defaultValue: d.stripeStatus })} tone={stripeTone(d.stripeStatus)} />
      </td>
      <td className={`${platformUi.tableTd} whitespace-nowrap text-xs`}>{when(d.evidenceDueBy, i18n.language)}</td>
      <td className={platformUi.tableTd}>
        <PlatformAdminStatusBadge label={t(`admin.disputesPage.recovery.${d.recoveryStatus}`)} tone={recoveryTone(d.recoveryStatus)} />
      </td>
      <td className={platformUi.tableTd}>
        <button type="button" onClick={() => patchParams({ dispute: d.id })} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {t("admin.refundsPage.view")}
        </button>
      </td>
    </tr>
  );

  return (
    <PlatformPage>
      <PlatformPageHeader icon={Scale} title={t("admin.disputesPage.title")} subtitle={t("admin.disputesPage.subtitle")} />
      <p className="text-xs text-muted-foreground">{t("admin.disputesPage.authorityNote")}</p>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t("admin.disputesPage.viewsAria")}>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => patchParams({ view: v, page: null })}
            className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${view === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/50"}`}
          >
            {t(`admin.disputesPage.view.${v}`)}
            {summary[v] != null ? <span className="ml-1.5 tabular-nums">{summary[v]}</span> : null}
          </button>
        ))}
      </div>

      <PlatformSearchField
        value={q}
        onChange={(next) => patchParams({ q: next.trim() || null, page: null })}
        placeholder={t("admin.disputesPage.searchPlaceholder")}
        ariaLabel={t("admin.disputesPage.searchPlaceholder")}
      />

      <PlatformResponsiveData
        footer={footer}
        mobile={
          loading ? (
            <DashboardListSkeleton rows={5} minHeightClass="min-h-[12rem]" />
          ) : loadError ? (
            <ListFilterLoadError message={loadError} kind="api" onRetry={() => void load()} />
          ) : items.length === 0 ? (
            <EmptyState compact title={t("admin.disputesPage.emptyTitle")} description={t("admin.disputesPage.emptyDescription")} />
          ) : (
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => patchParams({ dispute: d.id })} className="w-full rounded-xl border border-border p-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{d.businessName ?? t(`admin.disputesPage.subject.${d.subjectKind}`)}</span>
                      <span className="tabular-nums text-sm">{money(d.amountCents, d.currency, i18n.language)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <PlatformAdminStatusBadge label={t(`admin.disputesPage.stripeStatus.${d.stripeStatus}`, { defaultValue: d.stripeStatus })} tone={stripeTone(d.stripeStatus)} />
                      <PlatformAdminStatusBadge label={t(`admin.disputesPage.recovery.${d.recoveryStatus}`)} tone={recoveryTone(d.recoveryStatus)} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t("admin.disputesPage.colDue")}: {when(d.evidenceDueBy, i18n.language)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )
        }
        desktop={
          <table className={platformUi.table}>
            <thead>
              <tr className={platformUi.tableHeadRow}>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colDispute")}</th>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colBusiness")}</th>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colSubject")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.disputesPage.colAmount")}</th>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colStripeStatus")}</th>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colDue")}</th>
                <th className={platformUi.tableTh}>{t("admin.disputesPage.colRecovery")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <DashboardListSkeleton rows={6} minHeightClass="min-h-[12rem]" />
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <ListFilterLoadError message={loadError} kind="api" onRetry={() => void load()} compact />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState compact title={t("admin.disputesPage.emptyTitle")} description={t("admin.disputesPage.emptyDescription")} />
                  </td>
                </tr>
              ) : (
                items.map(row)
              )}
            </tbody>
          </table>
        }
      />

      <Dialog open={Boolean(openId)} onOpenChange={(open) => !open && patchParams({ dispute: null })}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {openId ? <DisputeDetail id={openId} onChanged={() => void load()} /> : null}
        </DialogContent>
      </Dialog>
    </PlatformPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all text-sm">{children}</dd>
    </div>
  );
}

function DisputeDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [d, setD] = useState<PlatformDisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [investigation, setInvestigation] = useState("new");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [savedHash, setSavedHash] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchPlatformDispute(id);
      setD(next);
      setNotes(next.internalNotes ?? "");
      setInvestigation(next.investigationStatus);
      setDraft(next.evidenceDraft ?? {});
      setSavedHash(next.evidenceDraftHash);
      setError(null);
    } catch (e) {
      setError(toUserFriendlyMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
      onChanged();
      if (success) setNotice(success);
    } catch (e) {
      logClientError(`PlatformDisputes.${label}`, e);
      setError(toUserFriendlyMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const canSubmit = useMemo(
    () =>
      Boolean(d) &&
      (d!.stripeStatus === "needs_response" || d!.stripeStatus === "warning_needs_response") &&
      !d!.evidencePastDue &&
      Boolean(savedHash) &&
      reviewed,
    [d, savedHash, reviewed],
  );

  if (!d) {
    // The dialog always needs a title for screen readers, also while the dispute is loading.
    return (
      <>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("admin.disputesPage.title")}</DialogTitle>
          <DialogDescription>{t("admin.disputesPage.detailSubtitle")}</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <DashboardListSkeleton rows={4} minHeightClass="min-h-[10rem]" />}
      </>
    );
  }
  const lang = i18n.language;
  const draftDirty = JSON.stringify(draft) !== JSON.stringify(d.evidenceDraft ?? {});

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-base">{d.stripeDisputeId}</DialogTitle>
        <DialogDescription>{t("admin.disputesPage.detailSubtitle")}</DialogDescription>
      </DialogHeader>

      {error ? <p role="alert" className="rounded-lg border border-destructive/40 p-2 text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-border p-2 text-sm">{notice}</p> : null}

      {d.explanation ? <DisputeSummary e={d.explanation} lang={lang} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">{t("admin.disputesPage.stripeSection")}</span>
          <PlatformAdminStatusBadge label={t(`admin.disputesPage.stripeStatus.${d.stripeStatus}`, { defaultValue: d.stripeStatus })} tone={stripeTone(d.stripeStatus)} />
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void run("sync", () => syncPlatformDispute(d.id), t("admin.disputesPage.synced"))}
            className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("admin.disputesPage.syncNow")}
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t("admin.disputesPage.colAmount")}>{money(d.amountCents, d.currency, lang)}</Field>
          <Field label={t("admin.disputesPage.reason")}>{d.stripeReason ?? "—"}</Field>
          <Field label={t("admin.disputesPage.colDue")}>{when(d.evidenceDueBy, lang)}{d.evidencePastDue ? ` · ${t("admin.disputesPage.pastDue")}` : ""}</Field>
          <Field label={t("admin.disputesPage.submissions")}>{d.evidenceSubmissionCount}</Field>
          <Field label={t("admin.disputesPage.withdrawn")}>{money(d.fundsWithdrawnCents, d.currency, lang)}</Field>
          <Field label={t("admin.disputesPage.reinstated")}>{money(d.fundsReinstatedCents, d.currency, lang)}</Field>
          <Field label={t("admin.disputesPage.disputeFee")}>{money(d.disputeFeeCents, d.currency, lang)}</Field>
          <Field label={t("admin.disputesPage.lastSync")}>{when(d.lastStripeSyncAt, lang)}</Field>
          {d.lastSyncError ? <Field label={t("admin.disputesPage.syncError")}>{d.lastSyncError}</Field> : null}
        </dl>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{t("admin.disputesPage.paymentSection")}</span>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t("admin.disputesPage.colSubject")}>{t(`admin.disputesPage.subject.${d.subjectKind}`)}</Field>
          <Field label={t("admin.disputesPage.colBusiness")}>{d.business?.name ?? "—"}</Field>
          <Field label={t("admin.disputesPage.employee")}>{d.employee?.name ?? "—"}</Field>
          <Field label="Charge">{d.stripeChargeId ?? "—"}</Field>
          <Field label="PaymentIntent">{d.stripePaymentIntentId ?? "—"}</Field>
          <Field label={t("admin.disputesPage.chargeAmount")}>
            {money(d.chargeAmountCents, d.currency, lang)}
            {d.chargeAmountRefundedCents ? ` · ${t("admin.disputesPage.refunded")} ${money(d.chargeAmountRefundedCents, d.currency, lang)}` : ""}
          </Field>
          <Field label={t("admin.disputesPage.transfer")}>{d.destinationTransferId ?? d.payable?.stripeTransferId ?? "—"}</Field>
          <Field label={t("admin.disputesPage.destination")}>{d.destinationAccountId ?? "—"}</Field>
          <Field label={t("admin.disputesPage.applicationFee")}>{money(d.applicationFeeCents, d.currency, lang)}</Field>
        </dl>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{t("admin.disputesPage.internalSection")}</span>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t("admin.disputesPage.investigation")}
          <select className="min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm text-foreground" value={investigation} onChange={(e) => setInvestigation(e.target.value)}>
            {INVESTIGATION.map((s) => (
              <option key={s} value={s}>
                {t(`admin.disputesPage.investigationStatus.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t("admin.disputesPage.notes")}
          <textarea className="min-h-[72px] rounded-lg border border-border bg-background p-2 text-sm text-foreground" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void run("internal", () => updatePlatformDisputeInternal(d.id, { investigationStatus: investigation, internalNotes: notes || null }), t("admin.disputesPage.saved"))}
          className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium"
        >
          {t("admin.disputesPage.saveInternal")}
        </button>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{t("admin.disputesPage.evidenceSection")}</span>
        <p className="text-xs text-muted-foreground">{t("admin.disputesPage.evidenceNote")}</p>
        {d.evidenceSubmittedAt ? <p className="text-sm">{t("admin.disputesPage.submittedAt", { at: when(d.evidenceSubmittedAt, lang) })}</p> : null}
        {d.evidenceVerifiedAt ? (
          <p className="text-xs text-muted-foreground">
            {d.evidenceVerificationMismatch.length
              ? t("admin.disputesPage.verificationMismatch", { fields: d.evidenceVerificationMismatch.join(", ") })
              : t("admin.disputesPage.verificationMatched")}
          </p>
        ) : null}
        {d.evidenceLastError ? <p role="alert" className="text-sm text-destructive">{d.evidenceLastError}</p> : null}
        <button
          type="button"
          disabled={busy != null}
          onClick={() =>
            void run("suggest", async () => {
              const s: EvidenceSuggestion = await fetchDisputeEvidenceSuggestion(d.id);
              setDraft((prev) => ({ ...s.draft, ...prev }));
              setSources(s.sources);
            })
          }
          className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium"
        >
          {t("admin.disputesPage.prefill")}
        </button>
        {EVIDENCE_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t(`admin.disputesPage.evidenceField.${field}`)}
            {sources[field] ? <span className="font-normal">{t("admin.disputesPage.source", { source: sources[field] })}</span> : null}
            <textarea
              className={`rounded-lg border border-border bg-background p-2 text-sm text-foreground ${field === "uncategorized_text" || field === "product_description" ? "min-h-[96px]" : "min-h-[40px]"}`}
              value={draft[field] ?? ""}
              onChange={(e) => {
                setReviewed(false);
                setDraft((prev) => ({ ...prev, [field]: e.target.value }));
              }}
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy != null}
            onClick={() =>
              void run("draft", async () => {
                const out = await saveDisputeEvidenceDraft(d.id, draft);
                setSavedHash(out.hash);
                setReviewed(false);
              }, t("admin.disputesPage.draftSaved"))
            }
            className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium"
          >
            {t("admin.disputesPage.saveDraft")}
          </button>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={reviewed} disabled={draftDirty || !savedHash} onChange={(e) => setReviewed(e.target.checked)} />
            {t("admin.disputesPage.reviewedConfirm")}
          </label>
          <button
            type="button"
            disabled={busy != null || !canSubmit || draftDirty}
            onClick={() => void run("submit", () => submitDisputeEvidence(d.id, savedHash!), t("admin.disputesPage.submitted"))}
            className="min-h-[40px] rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("admin.disputesPage.submitEvidence")}
          </button>
        </div>
      </section>

      <RecoveryPanel d={d} busy={busy} run={run} />
    </>
  );
}

/** Recovery: approval, the Stripe-read breakdown, attempts, retry and cancel. Never automatic. */
/**
 * "What happened / what Stripe confirmed / where the money is / what next / what to do", in plain
 * language. Everything comes from the server; this only translates codes. Facts CareTip cannot know
 * are labelled as such instead of being guessed.
 */
function DisputeSummary({ e, lang }: { e: DisputeExplanation; lang: string }) {
  const { t } = useTranslation();
  const k = (key: string, params?: Record<string, unknown>) => t(`admin.disputesPage.summary.${key}`, params ?? {});
  const fmt = (params?: Record<string, string | number>) => {
    if (!params) return {};
    const out: Record<string, string | number> = { ...params };
    if (typeof params.amountCents === "number") out.amount = money(params.amountCents, String(params.currency ?? e.happened.currency), lang);
    if (typeof params.at === "string") out.at = when(params.at, lang);
    return out;
  };
  return (
    <section className={`space-y-3 rounded-xl border p-4 ${e.needsAttention ? "border-amber-400/70" : "border-border"}`} aria-label={k("title")}>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{k("happenedTitle")}</h3>
        <p className="mt-1 text-sm">
          {k(`happened.${e.happened.subject}`, {
            amount: money(e.happened.amountCents, e.happened.currency, lang),
            business: e.happened.businessName ?? "—",
            employee: e.happened.employeeName ?? "—",
            defaultValue: k("happened.unattributed", { amount: money(e.happened.amountCents, e.happened.currency, lang) }),
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {e.happened.paymentDate ? k("paymentDate", { date: when(e.happened.paymentDate, lang) }) : k("paymentDateUnknown")}
        </p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{k("confirmedTitle")}</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {e.confirmed.map((c) => (
            <li key={c.code}>{k(`confirmed.${c.code}`, fmt(c.params))}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">{k("lastChecked", { at: when(e.verification.lastStripeSyncAt, lang) })}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{k("moneyTitle")}</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {e.money.map((m, i) => (
            <li key={`${m.code}-${i}`}>
              <span className="font-medium">{k(`location.${m.location}`)}:</span>{" "}
              {k(`money.${m.code}`, m.amountCents != null ? { amount: money(m.amountCents, m.currency ?? e.happened.currency, lang) } : {})}{" "}
              <span className="text-xs text-muted-foreground">({k(`source.${m.source}`)})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{k("nextTitle")}</h3>
        <p className="mt-1 text-sm font-medium">{k(`next.${e.nextStep}`)}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{k("actionTitle")}</h3>
        <p className="mt-1 text-sm">{k(`action.${e.adminAction}`)}</p>
      </div>
    </section>
  );
}

function RecoveryPanel({
  d,
  busy,
  run,
}: {
  d: PlatformDisputeDetail;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [ctx, setCtx] = useState<DisputeRecoveryContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [retryConfirm, setRetryConfirm] = useState(false);
  const [amountEur, setAmountEur] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const recoverable =
    d.stripeStatus === "lost" &&
    d.recoveryTargetCents > 0 &&
    (d.subjectKind === "tip_destination_business" || d.subjectKind === "tip_destination_employee" || d.subjectKind === "tip_platform_hold");
  const approvalActive = Boolean(d.recoveryApprovedAt) && !d.recoveryCancelledAt;
  const done = d.recoveryStatus === "recovered";
  const loadContext = async () => {
    setCtxError(null);
    try {
      setCtx(await fetchPlatformDisputeRecoveryContext(d.id));
    } catch (e) {
      setCtxError(toUserFriendlyMessage(e));
    }
  };
  const amountCents = amountEur.trim() ? Math.round(Number(amountEur.replace(",", ".")) * 100) : undefined;
  const feeCents = d.applicationFeeCents ?? null;

  return (
    <section className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{t("admin.disputesPage.recoverySection")}</span>
        <PlatformAdminStatusBadge label={t(`admin.disputesPage.recovery.${d.recoveryStatus}`)} tone={recoveryTone(d.recoveryStatus)} />
      </div>
      <p className="text-sm">{t("admin.disputesPage.recovered", { amount: money(d.recoveredCents, d.currency, lang) })}</p>
      {d.stripeStatus === "lost" ? (
        <p className="text-sm">{t("admin.disputesPage.exposure", { amount: money(d.recoveryExposureCents, d.currency, lang), target: money(d.recoveryTargetCents, d.currency, lang) })}</p>
      ) : null}
      {d.recoveryNote ? <p className="text-xs text-muted-foreground">{d.recoveryNote}</p> : null}
      {d.payable ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.disputesPage.payableLine", {
            model: d.payable.chargeModel,
            transferred: money(d.payable.transferredCents, d.currency, lang),
            reversed: money(d.payable.reversedCents, d.currency, lang),
          })}
        </p>
      ) : null}

      <div className="rounded-lg border border-border p-3 text-xs">
        <p className="font-semibold">{t("admin.disputesPage.approvalTitle")}</p>
        {d.recoveryApprovedAt ? (
          <p className="mt-1">
            {t("admin.disputesPage.approvedLine", {
              amount: money(d.recoveryApprovedCents, d.currency, lang),
              by: d.recoveryApprovedByEmail ?? "—",
              at: when(d.recoveryApprovedAt, lang),
              policy: d.recoveryPolicyVersion ?? "—",
            })}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">{t("admin.disputesPage.notApproved")}</p>
        )}
        {d.recoveryCancelledAt ? (
          <p className="mt-1">{t("admin.disputesPage.cancelled", { at: when(d.recoveryCancelledAt, lang), reason: d.recoveryCancelReason ?? "" })}</p>
        ) : null}
        {approvalActive && d.recoveryNextRetryAt ? (
          <p className="mt-1">{t("admin.disputesPage.nextRetry", { at: when(d.recoveryNextRetryAt, lang), count: d.recoveryRetryCount + 1, max: 20 })}</p>
        ) : null}
        {d.recoveryLastFailureCode ? <p className="mt-1">{t("admin.disputesPage.lastFailure", { code: d.recoveryLastFailureCode })}</p> : null}
      </div>

      {recoverable ? (
        <div className="rounded-lg border border-border p-3 text-xs">
          <p className="font-semibold">{t("admin.disputesPage.breakdownTitle")}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label={t("admin.disputesPage.disputedAmount")}>{money(d.amountCents, d.currency, lang)}</Field>
            <Field label={t("admin.disputesPage.beneficiaryShare")}>{money(d.recoveryTargetCents, d.currency, lang)}</Field>
            <Field label={t("admin.disputesPage.feeAllocation")}>{money(feeCents, d.currency, lang)}</Field>
            <Field label={t("admin.disputesPage.refundsIssued")}>{money(d.chargeAmountRefundedCents ?? 0, d.currency, lang)}</Field>
            {ctx && ctx.recoverable ? (
              <>
                <Field label={t("admin.disputesPage.transferAmount")}>{money(ctx.transferAmountCents, ctx.currency, lang)}</Field>
                <Field label={t("admin.disputesPage.transferReversed")}>{money(ctx.transferReversedCents, ctx.currency, lang)}</Field>
                <Field label={t("admin.disputesPage.otherReversals")}>
                  {money(ctx.otherReversals.reduce((sum, rv) => sum + rv.amountCents, 0), ctx.currency, lang)}
                </Field>
                <Field label={t("admin.disputesPage.connectedAvailable")}>
                  {ctx.connectedAvailableCents == null ? t("admin.disputesPage.balanceUnknown") : money(ctx.connectedAvailableCents, ctx.currency, lang)}
                </Field>
              </>
            ) : null}
          </dl>
          <button type="button" onClick={() => void loadContext()} className="mt-2 min-h-[36px] rounded-lg border border-border px-2.5 text-xs font-medium">
            {t("admin.disputesPage.loadContext")}
          </button>
          {ctxError ? <p role="alert" className="mt-1 text-destructive">{ctxError}</p> : null}
        </div>
      ) : null}

      {d.recoveryAttempts.length ? (
        <div className="text-xs">
          <p className="font-semibold">{t("admin.disputesPage.attemptsTitle")}</p>
          <ul className="mt-1 space-y-1">
            {d.recoveryAttempts.map((a) => (
              <li key={a.id} className="font-mono">
                {when(a.createdAt, lang)} · {t(`admin.disputesPage.trigger_${a.trigger}`, { defaultValue: a.trigger })} · {money(a.amountCents, d.currency, lang)} · {a.status}
                {a.connectedAvailableCents != null ? ` · ${t("admin.disputesPage.availableShort")} ${money(a.connectedAvailableCents, d.currency, lang)}` : ""}
                {a.stripeReversalId ? ` · ${a.stripeReversalId}` : ""}
                {a.errorCode ? ` · ${a.errorCode}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recoverable && !done && !approvalActive ? (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t("admin.disputesPage.approveAmount")}
            <input inputMode="decimal" value={amountEur} onChange={(e) => setAmountEur(e.target.value)} className="min-h-[40px] max-w-[10rem] rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={approveConfirm} onChange={(e) => setApproveConfirm(e.target.checked)} />
            {t("admin.disputesPage.approveConfirm")}
          </label>
          <button
            type="button"
            disabled={busy != null || !approveConfirm || (amountCents !== undefined && !(amountCents > 0))}
            onClick={() => void run("recover", () => recoverPlatformDispute(d.id, amountCents), t("admin.disputesPage.recoveryDone"))}
            className="min-h-[40px] rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("admin.disputesPage.approve")}
          </button>
        </div>
      ) : null}

      {approvalActive && !done ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={retryConfirm} onChange={(e) => setRetryConfirm(e.target.checked)} />
              {t("admin.disputesPage.retryConfirm")}
            </label>
            <button
              type="button"
              disabled={busy != null || !retryConfirm}
              onClick={() => void run("retry", () => retryPlatformDisputeRecovery(d.id), t("admin.disputesPage.recoveryDone"))}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-semibold"
            >
              {t("admin.disputesPage.retryNow")}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {t("admin.disputesPage.cancelReason")}
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
            </label>
            <button
              type="button"
              disabled={busy != null || !cancelReason.trim()}
              onClick={() => void run("cancel", () => cancelPlatformDisputeRecovery(d.id, cancelReason.trim()))}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs"
            >
              {t("admin.disputesPage.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("admin.disputesPage.stage2Note")}</p>
    </section>
  );
}
