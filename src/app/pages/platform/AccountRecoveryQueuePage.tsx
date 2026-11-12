import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, KeyRound, LifeBuoy, MailCheck, ShieldCheck, UserCheck } from "lucide-react";
import {
  approveAccountRecoveryRequest,
  fetchAccountRecoveryRequests,
  rejectAccountRecoveryRequest,
  verifyAccountRecoveryIdentity,
  type AccountRecoveryRequestRow,
} from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";
import { PlatformPage, PlatformPageHeader } from "@/app/components/platform/PlatformPageChrome";
import {
  ConsoleCallout,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleSkeletonRows,
  ConsoleStatus,
  type ConsoleTone,
} from "@/app/components/platform/console/AdminConsole";
import { formatDateTime } from "@/app/components/platform/console/consoleFormat";

const IDENTITY_METHODS = ["video_call", "government_id_check", "employer_confirmation", "other_documented"] as const;

const STATUS_TONE: Record<string, ConsoleTone> = {
  awaiting_email_proof: "neutral",
  awaiting_identity_review: "attention",
  awaiting_approval: "info",
};

/**
 * Review queue for employee account recovery. The server enforces every rule here, including that
 * the admin who checks identity cannot be the one who approves.
 */
export function AccountRecoveryQueuePage() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<AccountRecoveryRequestRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<string>(IDENTITY_METHODS[0]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await fetchAccountRecoveryRequests()).requests);
    } catch (err) {
      logClientError("AccountRecoveryQueuePage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setCode("");
      setNote("");
      await load();
    } catch (err) {
      logClientError("AccountRecoveryQueuePage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const count = (status: string) => rows.filter((r) => r.status === status).length;

  return (
    <PlatformPage>
      <PlatformPageHeader icon={LifeBuoy} title={t("platformAccountRecovery.title")} subtitle={t("platformAccountRecovery.intro")} />

      <ConsoleKpiGrid columns={3} label={t("platformAccountRecovery.title")}>
        <ConsoleKpi
          icon={UserCheck}
          tone={count("awaiting_identity_review") > 0 ? "attention" : undefined}
          label={t("platformAccountRecovery.status.awaiting_identity_review")}
          value={String(count("awaiting_identity_review"))}
          loading={!loaded}
        />
        <ConsoleKpi
          icon={ShieldCheck}
          tone="info"
          label={t("platformAccountRecovery.status.awaiting_approval")}
          value={String(count("awaiting_approval"))}
          loading={!loaded}
        />
        <ConsoleKpi
          icon={MailCheck}
          label={t("platformAccountRecovery.status.awaiting_email_proof")}
          value={String(count("awaiting_email_proof"))}
          loading={!loaded}
        />
      </ConsoleKpiGrid>

      {error ? <ConsoleCallout tone="failure">{<span role="alert">{error}</span>}</ConsoleCallout> : null}

      <div className="ac-grid ac-grid--main-aside">
        <ConsoleCard title={t("platformAccountRecovery.title")} flush>
          {!loaded ? (
            <ConsoleSkeletonRows rows={4} />
          ) : rows.length === 0 ? (
            <ConsoleEmpty icon={LifeBuoy} title={t("platformAccountRecovery.empty")} />
          ) : (
            <ul className="ac-list">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="inline-flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span className="break-all">{r.loginEmailAtRequest}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-label="→" />
                      <span className="break-all">{r.replacementEmail}</span>
                    </p>
                    <ConsoleStatus tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`platformAccountRecovery.status.${r.status}`)}</ConsoleStatus>
                  </div>
                  <blockquote className="ac-card--muted rounded-xl border border-border/60 px-4 py-3 text-sm whitespace-pre-wrap">{r.statement}</blockquote>
                  {r.eligibleAt ? (
                    <p className="ac-small ac-muted">{t("platformAccountRecovery.eligible", { when: formatDateTime(r.eligibleAt, i18n.language) })}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {r.status === "awaiting_identity_review" ? (
                      <button type="button" disabled={busy || !code || !note} className="ac-btn ac-btn--primary ac-btn--sm" onClick={() => void act(() => verifyAccountRecoveryIdentity(r.id, { code, method, evidenceRef: note }))}>
                        {t("platformAccountRecovery.verify")}
                      </button>
                    ) : null}
                    {r.status === "awaiting_approval" ? (
                      <button type="button" disabled={busy || !code || !note} className="ac-btn ac-btn--primary ac-btn--sm" onClick={() => void act(() => approveAccountRecoveryRequest(r.id, { code, reason: note }))}>
                        {t("platformAccountRecovery.approve")}
                      </button>
                    ) : null}
                    <button type="button" disabled={busy || !note} className="ac-btn ac-btn--secondary ac-btn--sm" onClick={() => void act(() => rejectAccountRecoveryRequest(r.id, { reason: note }))}>
                      {t("platformAccountRecovery.reject")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>

        <aside className="ac-sticky">
          <ConsoleCard icon={KeyRound} title={t("platformAccountRecovery.yourCode")} description={t("platformAccountRecovery.intro")}>
            <div className="flex flex-col gap-3">
              <label className="ac-field">
                <span className="ac-field__label">{t("platformAccountRecovery.yourCode")}</span>
                <input className="ac-input ac-mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="ac-field">
                <span className="ac-field__label">{t("platformAccountRecovery.method")}</span>
                <select className="ac-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {IDENTITY_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`platformAccountRecovery.methods.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ac-field">
                <span className="ac-field__label">{t("platformAccountRecovery.note")}</span>
                <textarea className="ac-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </ConsoleCard>
        </aside>
      </div>
    </PlatformPage>
  );
}
