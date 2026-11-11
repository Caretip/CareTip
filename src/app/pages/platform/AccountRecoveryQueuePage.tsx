import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  approveAccountRecoveryRequest,
  fetchAccountRecoveryRequests,
  rejectAccountRecoveryRequest,
  verifyAccountRecoveryIdentity,
  type AccountRecoveryRequestRow,
} from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";

const IDENTITY_METHODS = ["video_call", "government_id_check", "employer_confirmation", "other_documented"] as const;

/**
 * Review queue for employee account recovery. The server enforces every rule here, including that
 * the admin who checks identity cannot be the one who approves.
 */
export function AccountRecoveryQueuePage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AccountRecoveryRequestRow[]>([]);
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

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("platformAccountRecovery.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("platformAccountRecovery.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          {t("platformAccountRecovery.yourCode")}
          <input className="mt-1 w-full rounded-md border border-border bg-background p-2" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="text-sm">
          {t("platformAccountRecovery.method")}
          <select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={method} onChange={(e) => setMethod(e.target.value)}>
            {IDENTITY_METHODS.map((m) => <option key={m} value={m}>{t(`platformAccountRecovery.methods.${m}`)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          {t("platformAccountRecovery.note")}
          <input className="mt-1 w-full rounded-md border border-border bg-background p-2" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("platformAccountRecovery.empty")}</p> : null}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-4 text-sm">
            <p className="font-semibold text-foreground">{r.loginEmailAtRequest} → {r.replacementEmail}</p>
            <p className="text-muted-foreground">{t(`platformAccountRecovery.status.${r.status}`)}</p>
            <p className="mt-2 whitespace-pre-wrap text-foreground">{r.statement}</p>
            {r.eligibleAt ? <p className="mt-2 text-muted-foreground">{t("platformAccountRecovery.eligible", { when: new Date(r.eligibleAt).toLocaleString() })}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status === "awaiting_identity_review" ? (
                <button type="button" disabled={busy || !code || !note} className="rounded-md border border-border px-3 py-2" onClick={() => void act(() => verifyAccountRecoveryIdentity(r.id, { code, method, evidenceRef: note }))}>
                  {t("platformAccountRecovery.verify")}
                </button>
              ) : null}
              {r.status === "awaiting_approval" ? (
                <button type="button" disabled={busy || !code || !note} className="rounded-md border border-border px-3 py-2" onClick={() => void act(() => approveAccountRecoveryRequest(r.id, { code, reason: note }))}>
                  {t("platformAccountRecovery.approve")}
                </button>
              ) : null}
              <button type="button" disabled={busy || !note} className="rounded-md border border-border px-3 py-2" onClick={() => void act(() => rejectAccountRecoveryRequest(r.id, { reason: note }))}>
                {t("platformAccountRecovery.reject")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
