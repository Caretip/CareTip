import { useCallback, useEffect, useRef, useState } from "react";
import { nextCopiedKey, writeTextToClipboard } from "../lib/copyToClipboard";

const DEFAULT_RESET_MS = 2000;

/**
 * Per-control copy feedback. Only the key that succeeded shows as copied;
 * a failed write never displays success. Timeouts are cleared on unmount.
 */
export function useCopyFeedback(resetMs = DEFAULT_RESET_MS) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const copy = useCallback(
    async (key: string, value: string): Promise<boolean> => {
      const ok = await writeTextToClipboard(value);
      setCopiedKey((current) => nextCopiedKey(current, key, ok));
      clearTimer();
      if (ok) {
        timeoutRef.current = setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
          timeoutRef.current = null;
        }, resetMs);
      }
      return ok;
    },
    [clearTimer, resetMs],
  );

  const isCopied = useCallback((key: string) => copiedKey === key, [copiedKey]);

  return { copiedKey, isCopied, copy };
}
