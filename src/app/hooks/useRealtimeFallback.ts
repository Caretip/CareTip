import { useEffect, useRef } from "react";

/**
 * When the realtime socket is disconnected, periodically refresh from the database.
 * When connected, no polling — websocket is primary. On reconnect, refresh once right away:
 * events sent while disconnected (or delivered by another API instance during an outage) are
 * not replayed, and the last poll may be up to one interval old.
 */
export function useRealtimeFallback(
  connected: boolean,
  onRefresh: () => void | Promise<void>,
  intervalMs = 45000,
  /** Pass false where a socket catch-up hook already refreshes on reconnect. */
  options?: { refreshOnReconnect?: boolean }
) {
  const refreshOnReconnect = options?.refreshOnReconnect !== false;
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const hasConnected = useRef(false);
  const lostConnection = useRef(false);

  useEffect(() => {
    if (!connected) {
      // Only a drop after a real connection; the first connect follows the page's own load.
      if (hasConnected.current) lostConnection.current = true;
      return;
    }
    hasConnected.current = true;
    if (!lostConnection.current) return;
    lostConnection.current = false;
    if (refreshOnReconnect) void Promise.resolve(cb.current());
  }, [connected, refreshOnReconnect]);

  useEffect(() => {
    if (connected) return;
    const id = window.setInterval(() => {
      void Promise.resolve(cb.current());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [connected, intervalMs]);
}
