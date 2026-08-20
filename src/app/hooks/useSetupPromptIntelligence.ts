import { useCallback, useEffect, useRef, useState } from "react";
import {
  actionSetupPrompt,
  dismissSetupPrompt,
  evaluateSetupPrompts,
  type SetupPromptKind,
} from "../lib/setupNotificationIntelligence";
import { logClientError } from "../lib/clientLog";
import { isApiConnectivityError } from "../lib/errorMessages";
import { isProtectedApiReady } from "../lib/authRestore";

type Options = {
  kind: SetupPromptKind;
  conditionActive: boolean;
  conditionVersion: string;
  /** When false, skip network (e.g. preview / unauthenticated). */
  enabled?: boolean;
};

/**
 * Server-backed Class S visibility. Remount/login do not reset dismiss state.
 */
export function useSetupPromptIntelligence({
  kind,
  conditionActive,
  conditionVersion,
  enabled = true,
}: Options): {
  /** True while first evaluation is in flight — hide prompt to avoid flash. */
  loading: boolean;
  show: boolean;
  dismiss: () => void;
  markActioned: () => void;
} {
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const versionRef = useRef(conditionVersion);
  versionRef.current = conditionVersion;

  const apiReady = isProtectedApiReady();

  useEffect(() => {
    if (!enabled || !apiReady) {
      setLoading(false);
      setShow(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void evaluateSetupPrompts([
      { kind, conditionActive, conditionVersion },
    ])
      .then((results) => {
        if (cancelled) return;
        const row = results.find((r) => r.kind === kind);
        setShow(Boolean(row?.show));
      })
      .catch((err) => {
        if (cancelled) return;
        // Fail closed (hide prompt). Avoid noisy logs for expected API/bootstrap races.
        if (!isApiConnectivityError(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/couldn'?t evaluate setup prompts/i.test(msg)) {
            logClientError("useSetupPromptIntelligence.evaluate", err);
          }
        }
        setShow(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, conditionActive, conditionVersion, enabled, apiReady]);

  const dismiss = useCallback(() => {
    setShow(false);
    void dismissSetupPrompt(kind, versionRef.current).catch((err) => {
      if (!isApiConnectivityError(err)) {
        logClientError("useSetupPromptIntelligence.dismiss", err);
      }
    });
  }, [kind]);

  const markActioned = useCallback(() => {
    setShow(false);
    void actionSetupPrompt(kind, versionRef.current).catch((err) => {
      if (!isApiConnectivityError(err)) {
        logClientError("useSetupPromptIntelligence.action", err);
      }
    });
  }, [kind]);

  return { loading, show, dismiss, markActioned };
}
