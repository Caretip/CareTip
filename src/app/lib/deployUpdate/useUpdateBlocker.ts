import { useEffect } from "react";
import { acquireUpdateBlocker } from "./updateBlockers";

/** Holds a deployment-update blocker while `active` is true; released on change or unmount. */
export function useUpdateBlocker(name: string, active: boolean, options?: { ttlMs?: number }): void {
  const ttlMs = options?.ttlMs;
  useEffect(() => {
    if (!active) return undefined;
    return acquireUpdateBlocker(name, ttlMs === undefined ? undefined : { ttlMs });
  }, [name, active, ttlMs]);
}
