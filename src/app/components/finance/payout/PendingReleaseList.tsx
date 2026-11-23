import { useTranslation } from "react-i18next";
import type { PendingRelease } from "../../../lib/api";
import { formatConnectPayoutAmount } from "../../../lib/connectPayoutDisplay";

const MAX_ROWS = 4;

function formatReleaseDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * When pending Stripe funds become available (Stripe `available_on`), shown under the
 * Pending balance figure. Renders nothing while there is no pending balance.
 */
export function PendingReleaseList({
  releases,
  complete,
  pendingCents,
  currency,
}: {
  releases: PendingRelease[] | null | undefined;
  complete: boolean | undefined;
  pendingCents: number;
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  if (pendingCents <= 0) return null;

  if (!releases || releases.length === 0) {
    return <p className="caretip-payout-metric__hint">{t("payouts.pendingReleases.unavailable")}</p>;
  }

  const shown = releases.slice(0, MAX_ROWS);
  const hidden = releases.length - shown.length;

  return (
    <div className="caretip-payout-releases">
      <p className="caretip-payout-releases__title">{t("payouts.pendingReleases.title")}</p>
      <ul className="caretip-payout-releases__list">
        {shown.map((r) => (
          <li key={r.availableOn} className="caretip-payout-releases__row">
            <time dateTime={r.availableOn}>{formatReleaseDate(r.availableOn, i18n.language)}</time>
            <span>{formatConnectPayoutAmount(r.amountCents, currency, i18n.language)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="caretip-payout-metric__hint">
          {t("payouts.pendingReleases.more", { count: hidden })}
        </p>
      ) : null}
      {!complete ? (
        <p className="caretip-payout-metric__hint">{t("payouts.pendingReleases.partial")}</p>
      ) : null}
      <p className="caretip-payout-metric__hint">{t("payouts.pendingReleases.note")}</p>
    </div>
  );
}
