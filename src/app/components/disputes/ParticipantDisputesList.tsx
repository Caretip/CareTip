import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMyBusinessDisputes, fetchMyEmployeeDisputes, type ParticipantDispute } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { EmptyState } from "../ui/EmptyState";

function money(cents: number | null | undefined, currency: string, locale: string): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function day(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Berlin" });
  } catch {
    return iso;
  }
}

/**
 * Disputes on the viewer's own tips. The server scopes the list to the signed-in business or employee;
 * nothing here can request another party's data.
 */
export function ParticipantDisputesList({ audience }: { audience: "business" | "employee" }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ParticipantDispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (audience === "business" ? fetchMyBusinessDisputes() : fetchMyEmployeeDisputes())
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e) => {
        logClientError("ParticipantDisputesList", e);
        if (!cancelled) setError(toUserFriendlyMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [audience]);

  const lang = i18n.language;
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!items) return <p className="text-sm text-muted-foreground">{t("disputes.participant.loading")}</p>;
  if (items.length === 0) {
    return <EmptyState compact title={t("disputes.participant.emptyTitle")} description={t(`disputes.participant.emptyDescription_${audience}`)} />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t(`disputes.participant.intro_${audience}`)}</p>
      <ul className="space-y-3">
        {items.map((d) => (
          <li key={d.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t(`disputes.participant.outcome.${d.outcome}`)}</span>
              <span className="tabular-nums text-sm font-semibold">{money(d.amountCents, d.currency, lang)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("disputes.participant.opened", { date: day(d.createdAt, lang) })}
              {"employeeName" in d && d.employeeName ? ` · ${d.employeeName}` : ""}
              {"paidTo" in d && d.paidTo ? ` · ${t(`disputes.participant.paidTo.${d.paidTo}`)}` : ""}
            </p>
            {d.fundsReinstated ? <p className="mt-1 text-xs">{t("disputes.participant.reinstated")}</p> : null}
            {/* Only the beneficiary is told whether a recovery exists; a business never sees an employee recovery. */}
            {d.outcome === "lost" && !d.recovery && (audience === "employee" || d.paidTo === "business") ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("disputes.participant.lostNoRecovery")}</p>
            ) : null}
            {d.recovery ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t("disputes.participant.recoveryStatus")}</dt>
                  <dd className="font-medium">{t(`admin.disputesPage.recovery.${d.recovery.status}`)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("disputes.participant.approved")}</dt>
                  <dd className="tabular-nums">{money(d.recovery.approvedCents, d.currency, lang)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("disputes.participant.recovered")}</dt>
                  <dd className="tabular-nums">{money(d.recovery.recoveredCents, d.currency, lang)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("disputes.participant.outstanding")}</dt>
                  <dd className="tabular-nums">{money(d.recovery.outstandingCents, d.currency, lang)}</dd>
                </div>
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
