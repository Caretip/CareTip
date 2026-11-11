import { useCallback, useEffect, useState } from "react";
import {
  getInstantPayoutEligibility,
  type ConnectStatus,
  type InstantPayoutEligibility,
} from "../../../../lib/api";
import { fetchConnectStatusCached, readConnectStatusSnapshot } from "../../../../lib/stripeConnectStatusCache";
import { logClientError } from "../../../../lib/clientLog";
import { BusinessBankPayoutScheduleCard } from "./BusinessBankPayoutScheduleCard";

/**
 * Bank payout schedule on Stripe Connect (not on payout history workspace).
 */
export function BusinessConnectBankPayoutScheduleSection({
  bootLoading,
}: {
  bootLoading?: boolean;
}) {
  const [eligibility, setEligibility] = useState<InstantPayoutEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);

  const loadEligibility = useCallback(async () => {
    setEligibilityLoading(true);
    try {
      setEligibility(await getInstantPayoutEligibility());
    } catch (err) {
      logClientError("BusinessConnectBankPayoutScheduleSection", err);
      setEligibility(null);
    } finally {
      setEligibilityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEligibility();
  }, [loadEligibility]);

  // Shares the Connect card's cached status (and its in-flight request), so no extra API call.
  // When that already says "no Stripe account", the loading placeholder is skipped: it would only
  // appear and then vanish, moving everything below it.
  const [connect, setConnect] = useState<ConnectStatus | null>(() => readConnectStatusSnapshot());
  useEffect(() => {
    let cancelled = false;
    fetchConnectStatusCached()
      .then((status) => {
        if (!cancelled) setConnect(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const knownWithoutAccount = connect != null && connect.hasAccount === false;

  // After eligibility has loaded the decision is unchanged: shown when connected or unknown.
  const showSchedule =
    Boolean(bootLoading) ||
    (eligibilityLoading && !knownWithoutAccount) ||
    (!eligibilityLoading && (eligibility == null || eligibility.connected === true));

  if (!showSchedule) return null;

  return (
    <BusinessBankPayoutScheduleCard disabled={Boolean(bootLoading) || eligibilityLoading} />
  );
}
