import { useCallback, useEffect, useState } from "react";
import { fetchPlatformAuditLogs, type PlatformAuditLogRow } from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";

/** Latest audit entries (API max 200) for report pages that summarise a recent sample. */
export function useRecentAuditLogs(take = 200) {
  const [items, setItems] = useState<PlatformAuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPlatformAuditLogs({ take, skip: 0 });
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      logClientError("useRecentAuditLogs", e);
      setError(toUserFriendlyMessage(e));
    } finally {
      setLoading(false);
    }
  }, [take]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, total, loading, error, reload: load };
}

export type SecurityCategory = "auth" | "mfa" | "impersonation" | "recovery" | "legalHold" | "dataAccess";

const SECURITY_RULES: Array<[SecurityCategory, RegExp]> = [
  ["impersonation", /impersonat/i],
  ["mfa", /mfa|2fa|two[_-]?factor|totp/i],
  ["recovery", /recovery|password|reset/i],
  ["legalHold", /legal[_-]?hold/i],
  ["auth", /login|logout|sign[_-]?in|session|auth\.|token|refresh/i],
  ["dataAccess", /kyc_viewed|document|export|download/i],
];

export function securityCategory(action: string): SecurityCategory | null {
  for (const [cat, re] of SECURITY_RULES) if (re.test(action)) return cat;
  return null;
}
