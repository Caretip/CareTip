/**
 * Short-lived in-memory SWR cache for dashboard metrics (session-only, never localStorage).
 */

/** Period metrics, charts, goals — brief display window while revalidating. */
export const DASHBOARD_SWR_METRICS_TTL_MS = 45_000;

/** Earnings / available balance — shorter TTL for fresher financial reads. */
export const DASHBOARD_SWR_BALANCE_TTL_MS = 4_000;

export function isSwrEntryFresh(at: number, ttlMs: number): boolean {
  return Date.now() - at < ttlMs;
}

type CacheCell<T> = { at: number; value: T };

export function createDashboardSwrStore<T>() {
  const cells = new Map<string, CacheCell<T>>();

  return {
    get(key: string, ttlMs: number): T | null {
      const cell = cells.get(key);
      if (!cell || !isSwrEntryFresh(cell.at, ttlMs)) return null;
      return cell.value;
    },
    /** Read without TTL gate — for client search over already-loaded session data. */
    peek(key: string): T | null {
      return cells.get(key)?.value ?? null;
    },
    entriesByPrefix(prefix: string): Array<{ key: string; value: T; at: number }> {
      const out: Array<{ key: string; value: T; at: number }> = [];
      for (const [key, cell] of cells) {
        if (key.startsWith(prefix)) out.push({ key, value: cell.value, at: cell.at });
      }
      return out;
    },
    set(key: string, value: T): void {
      cells.set(key, { at: Date.now(), value });
    },
    delete(key: string): void {
      cells.delete(key);
    },
    deleteByPrefix(prefix: string): void {
      for (const key of cells.keys()) {
        if (key.startsWith(prefix)) cells.delete(key);
      }
    },
    clear(): void {
      cells.clear();
    },
  };
}
