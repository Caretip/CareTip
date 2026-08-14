/**
 * Run async work for the same key one at a time (FIFO).
 * Prevents Supabase transaction-pool contention when many handlers share connection_limit=1.
 * Queue tracking swallows rejections so a failed job does not create an unhandledRejection;
 * callers still observe failures via the returned promise.
 */
const tails = new Map<string, Promise<unknown>>();

export function runSerializedByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  const tracked: Promise<unknown> = next.then(
    (value) => value,
    () => undefined,
  );
  tails.set(
    key,
    tracked.finally(() => {
      if (tails.get(key) === tracked) tails.delete(key);
    }),
  );
  return next;
}
