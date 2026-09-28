import { useCallback, useEffect, useState } from "react";
import { getInstantPayoutEligibility, type InstantPayoutEligibility } from "../../../../lib/api";
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

  const showSchedule =
    Boolean(bootLoading) ||
    eligibilityLoading ||
    eligibility == null ||
    eligibility.connected === true;

  if (!showSchedule) return null;

  return (
    <BusinessBankPayoutScheduleCard disabled={Boolean(bootLoading) || eligibilityLoading} />
  );
}
