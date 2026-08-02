/**
 * Keep the idle dirty registry in sync with a form's dirty flag.
 * Ported from web `useIdleDirty.ts`.
 */

import { useEffect } from "react";
import { registerIdleDirty, unregisterIdleDirty } from "@/lib/idleSession/idleDirtyRegistry";

export function useIdleDirty(reason: string, isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) {
      unregisterIdleDirty(reason);
      return;
    }
    registerIdleDirty(reason);
    return () => {
      unregisterIdleDirty(reason);
    };
  }, [reason, isDirty]);
}
