/**
 * Run an async operation while freezing the idle clock (resume remaining time on exit).
 * Ported from web `idleSuppress.ts`.
 */

import { beginIdleSuppress, endIdleSuppress } from "./idleSessionStore";

export async function withIdleSuppress<T>(_reason: string, fn: () => Promise<T>): Promise<T> {
  beginIdleSuppress(Date.now());
  try {
    return await fn();
  } finally {
    endIdleSuppress(Date.now());
  }
}

export function withIdleSuppressSync<T>(_reason: string, fn: () => T): T {
  beginIdleSuppress(Date.now());
  try {
    return fn();
  } finally {
    endIdleSuppress(Date.now());
  }
}
