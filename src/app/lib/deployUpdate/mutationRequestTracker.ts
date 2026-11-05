/**
 * Counts in-flight state-changing `fetch` calls (anything but GET/HEAD/OPTIONS) so a deployment
 * reload never aborts a save, upload, payout or payment request with an unknown outcome.
 * Pass-through only: arguments, `this`, results and rejections are forwarded unchanged.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** A request older than this no longer blocks reloads (hung connections must not pin a release). */
export const MUTATION_REQUEST_BLOCK_MAX_MS = 2 * 60_000;
/**
 * `fetch` settles when headers arrive; callers still read the body and then act on it (e.g. hand off
 * to Stripe). Keep blocking briefly so a reload cannot land in that gap.
 */
export const MUTATION_SETTLE_GRACE_MS = 5_000;

type FetchTarget = { fetch: typeof fetch };
type Listener = () => void;
type Schedule = (handler: () => void, ms: number) => void;

const defaultSchedule: Schedule = (handler, ms) => {
  const handle: unknown = setTimeout(handler, ms);
  (handle as { unref?: () => void } | null)?.unref?.();
};

let clock: () => number = () => Date.now();
let schedule: Schedule = defaultSchedule;
let nextId = 1;
const inFlight = new Map<number, number>();
let lastSettledAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<Listener>();
let uninstall: (() => void) | null = null;

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
}

function requestMethod(input: unknown, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request === "function" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

export function installMutationRequestTracker(target: FetchTarget = globalThis): () => void {
  if (uninstall) return uninstall;
  const original = target.fetch;
  if (typeof original !== "function") return () => {};

  const tracked = function trackedFetch(
    this: unknown,
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const [input, init] = args;
    if (SAFE_METHODS.has(requestMethod(input, init))) {
      return Reflect.apply(original, target, args) as Promise<Response>;
    }
    const id = nextId++;
    inFlight.set(id, clock());
    emit();
    const done = () => {
      if (!inFlight.delete(id)) return;
      lastSettledAt = clock();
      emit();
      schedule(emit, MUTATION_SETTLE_GRACE_MS + 1);
    };
    let pending: Promise<Response>;
    try {
      pending = Reflect.apply(original, target, args) as Promise<Response>;
    } catch (err) {
      done();
      throw err;
    }
    pending.then(done, done);
    return pending;
  };

  target.fetch = tracked as typeof fetch;
  uninstall = () => {
    if (target.fetch === tracked) target.fetch = original;
    uninstall = null;
    inFlight.clear();
  };
  return uninstall;
}

export function inFlightMutationRequestCount(): number {
  const now = clock();
  let count = 0;
  for (const startedAt of inFlight.values()) {
    if (now - startedAt < MUTATION_REQUEST_BLOCK_MAX_MS) count += 1;
  }
  return count;
}

/** A state-changing request finished within the grace window; its response may still be in use. */
export function isMutationRequestSettling(): boolean {
  return clock() - lastSettledAt < MUTATION_SETTLE_GRACE_MS;
}

export function subscribeMutationRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function resetMutationRequestTrackerForTests(testClock?: () => number, testSchedule?: Schedule): void {
  uninstall?.();
  uninstall = null;
  inFlight.clear();
  lastSettledAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
  nextId = 1;
  clock = testClock ?? (() => Date.now());
  schedule = testSchedule ?? defaultSchedule;
}
