import { useEffect, useState } from "react";
import type { AuthStatus } from "../lib/authSession";
import { LOGIN_BOOTSTRAP_WAIT_MS } from "../lib/authBootstrapUi";

/**
 * True once a login page has waited long enough for a stored session to be restored. Restoration goes
 * on in the background, but with a slow or unreachable backend the form must still be usable.
 */
export function useLoginBootstrapWaitExpired(authStatus: AuthStatus): boolean {
  const [expired, setExpired] = useState(false);
  const initializing = authStatus === "initializing";
  useEffect(() => {
    if (!initializing) return;
    const id = window.setTimeout(() => setExpired(true), LOGIN_BOOTSTRAP_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [initializing]);
  return initializing && expired;
}
