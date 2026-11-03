import { isValidDeployVersion, isVersionedBuild } from "./buildInfo";
import type { DeployVersionCheckResult } from "./versionCheck";

/**
 * Detects a newer frontend deployment, prepares it in the background and decides when this tab
 * may reload. Single source of truth for the update notice.
 *
 * Lifecycle of one version transition (running → target):
 *   detected → preparing (service worker installs the target release) → ready → reloading →
 *   new page boots → running === target → transition recorded as verified → notice gone.
 *   Preparation that fails or exceeds `prepareTimeoutMs` → failed ("Try again"); the app keeps
 *   working and nothing reloads. A reload that does not unload the page → back to ready.
 *
 * Nothing reloads before the target is ready. Then, automatic reloads additionally require:
 * - no blocker: explicit critical operations, auth refresh/migration, login/logout transitions,
 *   Stripe hand-off, in-flight state-changing requests;
 * - the route is not a payment-return, callback or guest tip page (chunk recovery excepted);
 * - the moment is safe: an in-app navigation, the tab is hidden, or the user has been idle with no
 *   focused field — and no form input since the last navigation (a navigation clears that, and it
 *   lapses after a long absence so an abandoned form cannot pin the tab);
 * - this tab has not already reloaded for the same version too often (loop guard).
 *
 * "Refresh to update" skips the route, idle and loop-guard rules and reloads synchronously in the
 * click, but never through a blocker: the click is remembered, the notice says so, and the reload
 * happens the moment the last blocker is released.
 *
 * Stale signals (old `/version.json` responses, shared cache, cross-tab messages, bfcache) cannot
 * resurrect a finished transition: every signal carries the time it was observed, and a signal for
 * version V is ignored when it predates the verified V → running transition or the last network
 * confirmation that the running build is current. A genuine rollback to V is accepted once two
 * network checks at least `rollbackConfirmMs` apart both report V.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CrossTabMessage =
  | { type: "version"; version: string; at: number }
  | { type: "reloading"; version: string; at: number };

export type CrossTabChannel = {
  post(message: CrossTabMessage): void;
  subscribe(handler: (message: CrossTabMessage) => void): () => void;
  close(): void;
};

export type DeployUpdateEvent =
  | "running_version"
  | "version_check_ok"
  | "version_check_failed"
  | "version_check_shared"
  | "update_detected"
  | "update_cleared"
  | "update_preparing"
  | "update_ready"
  | "update_prepare_failed"
  | "update_applied"
  | "update_signal_ignored"
  | "update_deferred"
  | "reload_initiated"
  | "reload_suppressed"
  | "reload_failed"
  | "chunk_recovery_started"
  | "chunk_recovery_no_new_version"
  | "chunk_recovery_already_attempted"
  | "chunk_recovery_failed";

export type UpdateStage = "idle" | "preparing" | "ready" | "failed" | "reloading";

/** Reported by `prepareUpdate` while the new service worker installs. */
export type PrepareProgress = "installing";

/**
 * `service-worker`: the controlling worker's precached shell is verified to be the target build.
 * `network`: no service worker controls this page, so a reload is served by the network.
 */
export type PrepareResult =
  | { ok: true; via: "service-worker" | "network" }
  | { ok: false; reason: "install-failed" | "stale-shell" | "timeout" | "error" };

/**
 * `preparing`: `step` "detected" right after detection, "installing" once a new worker installs.
 * `ready`: "Refresh to update". `busy`: the user clicked, but an operation must finish first.
 * `offline`: preparation or reload waits for the connection. `failed`: "Try again".
 * `reloading`: the reload has been issued. `cleared`: no notice.
 */
export type DeployUpdateNotice =
  | { kind: "preparing"; version: string; step: "detected" | "installing" }
  | { kind: "ready"; version: string }
  | { kind: "busy"; version: string }
  | { kind: "offline"; version: string }
  | { kind: "failed"; version: string }
  | { kind: "reloading"; version: string }
  | { kind: "cleared" };

export type ReloadTrigger =
  | "startup"
  | "interval"
  | "visible"
  | "hidden"
  | "online"
  | "pageshow"
  | "route-change"
  | "blocker-released"
  | "service-worker"
  | "cross-tab"
  | "prepared"
  | "chunk"
  | "manual";

export type ChunkRecoveryOutcome =
  | "reloading"
  | "deferred"
  | "same-version"
  | "already-attempted"
  | "check-failed"
  | "unversioned";

type Timers = {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type DeployUpdateEnvironment = {
  isVisible(): boolean;
  isOnline(): boolean;
  hasFocusedEditable(): boolean;
  /** Subscribe to a DOM event; returns an unsubscribe function. */
  listen(target: "window" | "document", type: string, handler: (event: Event) => void): () => void;
};

export type DeployUpdateDeps = {
  runningVersion: string;
  fetchVersion(): Promise<DeployVersionCheckResult>;
  now(): number;
  timers: Timers;
  env: DeployUpdateEnvironment;
  localStore: StorageLike | null;
  sessionStore: StorageLike | null;
  channel: CrossTabChannel | null;
  reload(): void;
  /** First active blocker reason (explicit or system), or null. */
  getBlockReason(): string | null;
  /** Route-level deferral reason, or null. */
  getRouteDeferReason(): string | null;
  /** True where the update notice must stay hidden (guest tip journey). */
  isQuietRoute(): boolean;
  /**
   * Make `target` loadable by a reload and verify it. Without it the reload goes to the network
   * (treated as ready immediately). The coordinator bounds it with `prepareTimeoutMs`.
   */
  prepareUpdate?(target: string, onProgress: (progress: PrepareProgress) => void): Promise<PrepareResult>;
  notify(notice: DeployUpdateNotice): void;
  log(event: DeployUpdateEvent, fields?: Record<string, string | number | boolean | null>): void;
  pollIntervalMs?: number;
  hiddenPollIntervalMs?: number;
  idleReloadMs?: number;
  formInputGuardMs?: number;
  sharedCheckFreshMs?: number;
  maxReloadsPerVersion?: number;
  chunkMarkerTtlMs?: number;
  prepareTimeoutMs?: number;
  preparingNoticeDelayMs?: number;
  chunkPrepareWaitMs?: number;
  manualReloadGraceMs?: number;
  reloadWatchdogMs?: number;
  rollbackConfirmMs?: number;
};

export const SHARED_CHECK_KEY = "caretip-deploy-version-check";
export const RELOAD_BUDGET_KEY = "caretip-deploy-reload";
export const CHUNK_RECOVERY_KEY = "caretip-deploy-chunk-recovery";
/** sessionStorage: `{ from, to, at, manual }` written right before any reload. */
export const RELOAD_MARKER_KEY = "caretip-deploy-reload-marker";
/** localStorage: verified version transitions, `[{ from, to, verifiedAt }]`, newest last. */
export const TRANSITIONS_KEY = "caretip-deploy-transitions";

const MAX_TRANSITIONS = 10;

const DEFAULTS = {
  pollIntervalMs: 60_000,
  /** Background tabs check rarely; a hidden tab is the best moment to reload silently. */
  hiddenPollIntervalMs: 5 * 60_000,
  idleReloadMs: 5 * 60_000,
  /** Typed input protects the page until a navigation, or until the user has been away this long. */
  formInputGuardMs: 30 * 60_000,
  sharedCheckFreshMs: 45_000,
  /** Per deployed version for the whole tab session: a stuck SW or CDN can never cause periodic reloads. */
  maxReloadsPerVersion: 2,
  chunkMarkerTtlMs: 10 * 60_000,
  /** Upper bound for one preparation attempt (precache of the new release on a slow connection). */
  prepareTimeoutMs: 90_000,
  /** Fast preparations go straight to "ready" without a "preparing" notice flashing first. */
  preparingNoticeDelayMs: 1_500,
  /** A broken lazy chunk waits this long for preparation before giving the route error UI time. */
  chunkPrepareWaitMs: 10_000,
  /** A page that booted the old bundle after "Refresh to update" completes the refresh within this window. */
  manualReloadGraceMs: 2 * 60_000,
  /** A reload that has not unloaded the page by then failed (or was cancelled); offer it again. */
  reloadWatchdogMs: 15_000,
  /** A version this tab already replaced counts as a rollback only after two checks this far apart. */
  rollbackConfirmMs: 2 * 60_000,
};

function readJson<T>(store: StorageLike | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: StorageLike | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isWritable(store: StorageLike | null): boolean {
  if (!store) return false;
  try {
    store.setItem("__caretip_deploy_probe", "1");
    store.removeItem("__caretip_deploy_probe");
    return true;
  } catch {
    return false;
  }
}

function removeKey(store: StorageLike | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function isCrossTabMessage(value: unknown): value is CrossTabMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as { type?: unknown; version?: unknown; at?: unknown };
  return (
    (msg.type === "version" || msg.type === "reloading") &&
    isValidDeployVersion(msg.version) &&
    typeof msg.at === "number"
  );
}

export function parseCrossTabMessage(value: unknown): CrossTabMessage | null {
  return isCrossTabMessage(value) ? value : null;
}

type ReloadMarker = { from: string; to: string; at: number; manual: boolean };
type Transition = { from: string; to: string; verifiedAt: number };

function parseTransitions(value: unknown): Transition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is Transition =>
      !!t &&
      typeof t === "object" &&
      isValidDeployVersion((t as Transition).from) &&
      isValidDeployVersion((t as Transition).to) &&
      typeof (t as Transition).verifiedAt === "number" &&
      Number.isFinite((t as Transition).verifiedAt),
  );
}

type Signal = { version: string; source: string; observedAt: number; network: boolean };

export type DeployUpdateCoordinator = ReturnType<typeof createDeployUpdateCoordinator>;

export function createDeployUpdateCoordinator(deps: DeployUpdateDeps) {
  const cfg = { ...DEFAULTS, ...stripUndefined(deps) };
  const running = deps.runningVersion;
  const versioned = isVersionedBuild(running);
  /** Without a writable sessionStorage there is no loop guard, so no automatic reloads at all. */
  const sessionUsable = isWritable(deps.sessionStore);

  let started = false;
  let stopped = false;
  let checking: Promise<void> | null = null;

  let stage: UpdateStage = "idle";
  let pendingVersion: string | null = null;
  let pendingObservedAt = 0;
  let prepareStep: "detected" | "installing" = "detected";
  let prepareVia: "service-worker" | "network" | null = null;
  let prepareAttempt = 0;
  /** A failed preparation is being retried in the background; the notice stays "failed" until it succeeds. */
  let silentRetry = false;
  let preparingNoticeVisible = false;
  let preparationWaiters: Array<() => void> = [];
  /** The user asked to refresh (or the previous page's refresh is being completed). */
  let requested = false;
  let chunkReloadRequested = false;
  let resumeTarget: string | null = null;
  let resumedFromMarker = false;

  let currentConfirmedAt = Number.NEGATIVE_INFINITY;
  const transitionsInPage: Transition[] = [];
  const rollbackFirstSeen = new Map<string, number>();

  let noticeKey: string | null = null;
  let lastActivityAt = deps.now();
  let formInputSinceNavigation = false;
  let lastFormInputAt = 0;
  let lastDeferLog = "";
  let lastIgnoredLog = "";
  let lastCheckAt = 0;
  let pollHandle: unknown = null;
  let prepareTimeoutHandle: unknown = null;
  let preparingNoticeHandle: unknown = null;
  let watchdogHandle: unknown = null;
  const cleanups: Array<() => void> = [];
  let chunkRecovery: Promise<ChunkRecoveryOutcome> | null = null;

  function clearTimer(handle: unknown): null {
    if (handle !== null) deps.timers.clearTimeout(handle);
    return null;
  }

  // ------------------------------------------------------------ verified transitions
  function readMarker(): ReloadMarker | null {
    const m = readJson<Partial<ReloadMarker>>(deps.sessionStore, RELOAD_MARKER_KEY);
    if (!m || typeof m.from !== "string" || typeof m.to !== "string" || typeof m.at !== "number") return null;
    return { from: m.from, to: m.to, at: m.at, manual: m.manual === true };
  }

  function storedTransitions(): Transition[] {
    return parseTransitions(readJson<unknown>(deps.localStore, TRANSITIONS_KEY));
  }

  /** Latest verified transition from `version` to the build this page runs. */
  function verifiedTransitionFrom(version: string): Transition | null {
    let best: Transition | null = null;
    for (const t of [...transitionsInPage, ...storedTransitions()]) {
      if (t.from === version && t.to === running && (!best || t.verifiedAt > best.verifiedAt)) best = t;
    }
    return best;
  }

  function recordTransition(from: string, verifiedAt: number): void {
    const entry = { from, to: running, verifiedAt };
    transitionsInPage.push(entry);
    const kept = storedTransitions().filter((t) => !(t.from === from && t.to === running));
    writeJson(deps.localStore, TRANSITIONS_KEY, [...kept.slice(-(MAX_TRANSITIONS - 1)), entry]);
  }

  /**
   * On boot: did the previous page's reload land on this build? If so the transition is verified.
   * If the old bundle booted again right after "Refresh to update", finish that refresh once ready.
   */
  function settleReloadMarker(): void {
    const m = readMarker();
    if (!m) return;
    removeKey(deps.sessionStore, RELOAD_MARKER_KEY);
    if (m.to === running) {
      if (m.from !== running) recordTransition(m.from, deps.now());
      deps.log("update_applied", { from: m.from, to: running });
      return;
    }
    if (m.manual && m.from === running && deps.now() - m.at < cfg.manualReloadGraceMs) {
      resumeTarget = m.to;
      resumedFromMarker = true;
    }
  }

  function logIgnored(signal: Signal, reason: string): void {
    const key = `${signal.version}:${signal.source}:${reason}`;
    if (key === lastIgnoredLog) return;
    lastIgnoredLog = key;
    deps.log("update_signal_ignored", { running, deployed: signal.version, source: signal.source, reason });
  }

  /** Decides whether a signal may change the pending state. */
  function acceptSignal(signal: Signal): boolean {
    if (pendingVersion && pendingVersion !== signal.version && signal.observedAt < pendingObservedAt) {
      logIgnored(signal, "older-than-pending");
      return false;
    }
    if (signal.version === running) return true;
    if (!signal.network && signal.observedAt < currentConfirmedAt) {
      logIgnored(signal, "older-than-confirmation");
      return false;
    }
    const transition = verifiedTransitionFrom(signal.version);
    if (!transition) return true;
    if (signal.observedAt <= transition.verifiedAt || !signal.network) {
      logIgnored(signal, "replaced-version");
      return false;
    }
    const first = rollbackFirstSeen.get(signal.version);
    if (first === undefined) {
      rollbackFirstSeen.set(signal.version, signal.observedAt);
      logIgnored(signal, "rollback-unconfirmed");
      return false;
    }
    if (signal.observedAt - first < cfg.rollbackConfirmMs) {
      logIgnored(signal, "rollback-unconfirmed");
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------ pending state
  /** `replaced`: a newer target takes over, so its own notice replaces the current one. */
  function clearPending(replaced = false): void {
    if (pendingVersion) deps.log("update_cleared", { version: pendingVersion });
    pendingVersion = null;
    stage = "idle";
    requested = false;
    chunkReloadRequested = false;
    prepareAttempt += 1;
    silentRetry = false;
    prepareTimeoutHandle = clearTimer(prepareTimeoutHandle);
    preparingNoticeHandle = clearTimer(preparingNoticeHandle);
    settleWaiters();
    if (noticeKey && !replaced) {
      noticeKey = null;
      deps.notify({ kind: "cleared" });
    }
  }

  function applySignal(signal: Signal): void {
    if (stage === "reloading") return;
    if (!acceptSignal(signal)) return;
    if (signal.version === running) {
      rollbackFirstSeen.clear();
      if (signal.network) currentConfirmedAt = Math.max(currentConfirmedAt, signal.observedAt);
      if (pendingVersion) clearPending();
      return;
    }
    rollbackFirstSeen.delete(signal.version);
    if (pendingVersion === signal.version) {
      pendingObservedAt = Math.max(pendingObservedAt, signal.observedAt);
      return;
    }
    if (pendingVersion) clearPending(true);
    pendingVersion = signal.version;
    pendingObservedAt = signal.observedAt;
    requested = resumeTarget === signal.version;
    lastDeferLog = "";
    deps.log("update_detected", { running, deployed: signal.version, source: signal.source });
    startPreparation({ silent: false });
  }

  // ------------------------------------------------------------ preparation
  function settleWaiters(): void {
    const waiters = preparationWaiters;
    preparationWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function startPreparation({ silent }: { silent: boolean }): void {
    if (!pendingVersion || stopped) return;
    const attempt = ++prepareAttempt;
    const target = pendingVersion;
    silentRetry = silent && stage === "failed";
    if (!silentRetry) {
      stage = "preparing";
      prepareStep = "detected";
      preparingNoticeVisible = requested || noticeKey !== null;
      preparingNoticeHandle = clearTimer(preparingNoticeHandle);
      if (!preparingNoticeVisible) {
        preparingNoticeHandle = deps.timers.setTimeout(() => {
          preparingNoticeHandle = null;
          if (attempt !== prepareAttempt || stage !== "preparing") return;
          preparingNoticeVisible = true;
          showNotice();
        }, cfg.preparingNoticeDelayMs);
      }
    }
    deps.log("update_preparing", { deployed: target, silent: silentRetry });
    if (!deps.prepareUpdate) {
      finishPreparation(attempt, { ok: true, via: "network" });
      return;
    }
    prepareTimeoutHandle = clearTimer(prepareTimeoutHandle);
    prepareTimeoutHandle = deps.timers.setTimeout(() => {
      prepareTimeoutHandle = null;
      finishPreparation(attempt, { ok: false, reason: "timeout" });
    }, cfg.prepareTimeoutMs);
    showNotice();
    let result: Promise<PrepareResult>;
    try {
      result = deps.prepareUpdate(target, (progress) => {
        if (attempt !== prepareAttempt || stage !== "preparing" || progress !== "installing") return;
        prepareStep = "installing";
        showNotice();
      });
    } catch {
      result = Promise.resolve({ ok: false, reason: "error" });
    }
    result.then(
      (r) => finishPreparation(attempt, r),
      () => finishPreparation(attempt, { ok: false, reason: "error" }),
    );
  }

  function finishPreparation(attempt: number, result: PrepareResult): void {
    if (attempt !== prepareAttempt || stopped || !pendingVersion) return;
    if (stage !== "preparing" && stage !== "failed") return;
    prepareAttempt += 1;
    prepareTimeoutHandle = clearTimer(prepareTimeoutHandle);
    preparingNoticeHandle = clearTimer(preparingNoticeHandle);
    const wasSilent = silentRetry;
    silentRetry = false;
    if (result.ok) {
      stage = "ready";
      prepareVia = result.via;
      deps.log("update_ready", { deployed: pendingVersion, via: result.via });
      settleWaiters();
      evaluate("prepared");
      if ((stage as UpdateStage) !== "reloading") showNotice();
      return;
    }
    stage = "failed";
    if (!wasSilent) deps.log("update_prepare_failed", { deployed: pendingVersion, reason: result.reason });
    settleWaiters();
    showNotice();
  }

  function waitForPreparation(ms: number): Promise<void> {
    if (stage !== "preparing") return Promise.resolve();
    return new Promise((resolve) => {
      let handle: unknown = null;
      const done = () => {
        handle = clearTimer(handle);
        resolve();
      };
      preparationWaiters.push(done);
      handle = deps.timers.setTimeout(done, ms);
    });
  }

  // ------------------------------------------------------------ notice
  function computeNotice(): DeployUpdateNotice | null {
    if (!pendingVersion || deps.isQuietRoute()) return null;
    const version = pendingVersion;
    const online = deps.env.isOnline();
    switch (stage) {
      case "reloading":
        return { kind: "reloading", version };
      case "preparing":
        if (!online) return { kind: "offline", version };
        return preparingNoticeVisible ? { kind: "preparing", version, step: prepareStep } : null;
      case "failed":
        return online ? { kind: "failed", version } : { kind: "offline", version };
      case "ready":
        if (requested && deps.getBlockReason()) return { kind: "busy", version };
        if (!online && prepareVia === "network") return { kind: "offline", version };
        return { kind: "ready", version };
      default:
        return null;
    }
  }

  function showNotice(): void {
    const notice = computeNotice();
    if (!notice) return;
    const key = JSON.stringify(notice);
    if (key === noticeKey) return;
    noticeKey = key;
    deps.notify(notice);
  }

  function logDeferred(reason: string): void {
    const key = `${pendingVersion}:${reason}`;
    if (key === lastDeferLog) return;
    lastDeferLog = key;
    deps.log("update_deferred", { deployed: pendingVersion, reason });
  }

  // ------------------------------------------------------------ reload policy
  function reloadBudgetAvailable(version: string): boolean {
    if (!sessionUsable) return false;
    const entry = readJson<{ version: string; count: number; at: number }>(deps.sessionStore, RELOAD_BUDGET_KEY);
    if (!entry || entry.version !== version) return true;
    return !(entry.count >= cfg.maxReloadsPerVersion);
  }

  function spendReloadBudget(version: string): boolean {
    const entry = readJson<{ version: string; count: number; at: number }>(deps.sessionStore, RELOAD_BUDGET_KEY);
    const fresh = !entry || entry.version !== version || typeof entry.count !== "number";
    return writeJson(deps.sessionStore, RELOAD_BUDGET_KEY, {
      version,
      count: fresh ? 1 : entry.count + 1,
      at: fresh ? deps.now() : entry.at,
    });
  }

  function hasRecentFormInput(): boolean {
    return formInputSinceNavigation && deps.now() - Math.max(lastFormInputAt, lastActivityAt) < cfg.formInputGuardMs;
  }

  function isSafeMoment(trigger: ReloadTrigger): boolean {
    if (trigger === "route-change" || trigger === "chunk" || chunkReloadRequested) return true;
    if (hasRecentFormInput()) return false;
    if (!deps.env.isVisible()) return true;
    return deps.now() - lastActivityAt >= cfg.idleReloadMs && !deps.env.hasFocusedEditable();
  }

  function evaluate(trigger: ReloadTrigger): void {
    if (stopped || !pendingVersion || stage === "reloading") return;
    if (stage !== "ready") {
      logDeferred(stage === "failed" ? "prepare-failed" : "preparing");
      showNotice();
      return;
    }
    if (requested) {
      tryRequestedReload();
      return;
    }
    if (!started && !chunkReloadRequested) return;
    const blocked = deps.getBlockReason();
    if (blocked) {
      logDeferred(blocked);
      showNotice();
      return;
    }
    const routeReason = chunkReloadRequested || trigger === "chunk" ? null : deps.getRouteDeferReason();
    if (routeReason) {
      logDeferred(routeReason);
      showNotice();
      return;
    }
    if (!isSafeMoment(trigger)) {
      logDeferred(hasRecentFormInput() ? "form-input" : "user-active");
      showNotice();
      return;
    }
    if (!reloadBudgetAvailable(pendingVersion) || !spendReloadBudget(pendingVersion)) {
      logDeferred("reload-budget");
      deps.log("reload_suppressed", { deployed: pendingVersion });
      showNotice();
      return;
    }
    deps.log("reload_initiated", { trigger, running, deployed: pendingVersion, manual: false });
    commitReload(pendingVersion, false);
  }

  /** The user's refresh: synchronous, only when ready, never through a blocker. */
  function tryRequestedReload(): void {
    if (stopped || !pendingVersion || stage !== "ready") return;
    const blocked = deps.getBlockReason();
    if (blocked) {
      logDeferred(blocked);
      showNotice();
      return;
    }
    if (!deps.env.isOnline() && prepareVia === "network") {
      logDeferred("offline");
      showNotice();
      return;
    }
    requested = false;
    deps.log("reload_initiated", { trigger: "manual", running, deployed: pendingVersion, manual: true });
    commitReload(pendingVersion, !(resumedFromMarker && pendingVersion === resumeTarget));
  }

  function commitReload(target: string, allowResume: boolean): void {
    stage = "reloading";
    deps.channel?.post({ type: "reloading", version: target, at: deps.now() });
    writeJson(deps.sessionStore, RELOAD_MARKER_KEY, { from: running, to: target, at: deps.now(), manual: allowResume });
    if (noticeKey !== null) showNotice();
    watchdogHandle = clearTimer(watchdogHandle);
    watchdogHandle = deps.timers.setTimeout(onReloadStalled, cfg.reloadWatchdogMs);
    deps.reload();
  }

  /** Still alive long after `reload()`: the navigation failed or was cancelled. Not an applied update. */
  function onReloadStalled(): void {
    watchdogHandle = null;
    if (stopped || stage !== "reloading") return;
    stage = "ready";
    requested = false;
    removeKey(deps.sessionStore, RELOAD_MARKER_KEY);
    deps.log("reload_failed", { deployed: pendingVersion });
    showNotice();
  }

  // ------------------------------------------------------------ version checks
  async function runCheck(trigger: ReloadTrigger, bypassShared: boolean): Promise<void> {
    if (!bypassShared) {
      const shared = readJson<{ version: string; at: number }>(deps.localStore, SHARED_CHECK_KEY);
      if (
        shared &&
        isValidDeployVersion(shared.version) &&
        typeof shared.at === "number" &&
        deps.now() - shared.at < cfg.sharedCheckFreshMs
      ) {
        deps.log("version_check_shared", { deployed: shared.version });
        lastCheckAt = deps.now();
        applySignal({ version: shared.version, source: "shared-cache", observedAt: shared.at, network: false });
        evaluate(trigger);
        return;
      }
    }
    const result = await deps.fetchVersion();
    lastCheckAt = deps.now();
    if (stopped) return;
    if (!result.ok) {
      deps.log("version_check_failed", { trigger, reason: result.reason, status: result.status ?? null });
      return;
    }
    const at = deps.now();
    writeJson(deps.localStore, SHARED_CHECK_KEY, { version: result.version, at });
    deps.channel?.post({ type: "version", version: result.version, at });
    deps.log("version_check_ok", { trigger, running, deployed: result.version });
    applySignal({ version: result.version, source: "check", observedAt: at, network: true });
    evaluate(trigger);
  }

  function checkNow(trigger: ReloadTrigger, options?: { bypassShared?: boolean }): Promise<void> {
    if (!started || stopped || stage === "reloading" || !versioned) return Promise.resolve();
    if (checking) return checking;
    if (!deps.env.isOnline()) return Promise.resolve();
    checking = runCheck(trigger, options?.bypassShared === true).finally(() => {
      checking = null;
    });
    return checking;
  }

  // ------------------------------------------------------------ environment events
  function onActivity(): void {
    lastActivityAt = deps.now();
  }

  function onInput(event: Event): void {
    const target = event.target as { isContentEditable?: boolean; tagName?: string } | null;
    const tag = typeof target?.tagName === "string" ? target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
      formInputSinceNavigation = true;
      lastFormInputAt = deps.now();
    }
    onActivity();
  }

  function onOnline(): void {
    if (stage === "failed") startPreparation({ silent: false });
    evaluate("online");
    if (stage === "reloading") return;
    showNotice();
    void checkNow("online");
  }

  /** Restored from the back/forward cache: this page instance is not mid-reload any more. */
  function onPageRestored(): void {
    watchdogHandle = clearTimer(watchdogHandle);
    if (stage === "reloading") stage = pendingVersion ? "ready" : "idle";
    requested = false;
    noticeKey = null;
    showNotice();
    void checkNow("pageshow", { bypassShared: true });
  }

  function start(): void {
    if (started || stopped) return;
    started = true;
    deps.log("running_version", { running, versioned });
    if (!versioned) return;

    settleReloadMarker();
    if (resumeTarget) {
      applySignal({ version: resumeTarget, source: "resume", observedAt: deps.now(), network: false });
    }

    const { env } = deps;
    cleanups.push(
      env.listen("document", "visibilitychange", () => {
        if (env.isVisible()) void checkNow("visible");
        else evaluate("hidden");
      }),
      env.listen("window", "online", onOnline),
      env.listen("window", "offline", () => showNotice()),
      env.listen("window", "pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted) onPageRestored();
      }),
      ...["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].map((type) =>
        env.listen("document", type, onActivity),
      ),
      env.listen("document", "input", onInput),
    );
    if (deps.channel) {
      cleanups.push(
        deps.channel.subscribe((message) => {
          applySignal({
            version: message.version,
            source: message.type === "reloading" ? "cross-tab-reload" : "cross-tab",
            observedAt: message.at,
            network: false,
          });
          evaluate("cross-tab");
        }),
      );
    }
    pollHandle = deps.timers.setInterval(() => {
      if (!deps.env.isVisible() && deps.now() - lastCheckAt < cfg.hiddenPollIntervalMs) {
        evaluate("interval");
        return;
      }
      void checkNow("interval").then(() => evaluate("interval"));
    }, cfg.pollIntervalMs);
    void checkNow("startup", { bypassShared: true });
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (pollHandle !== null) deps.timers.clearInterval(pollHandle);
    pollHandle = null;
    prepareTimeoutHandle = clearTimer(prepareTimeoutHandle);
    preparingNoticeHandle = clearTimer(preparingNoticeHandle);
    watchdogHandle = clearTimer(watchdogHandle);
    settleWaiters();
    cleanups.splice(0).forEach((cleanup) => cleanup());
    deps.channel?.close();
  }

  /** In-app navigation committed: previous page's form state is gone, so this is a safe point. */
  function onRouteChange(): void {
    formInputSinceNavigation = false;
    lastActivityAt = deps.now();
    evaluate("route-change");
  }

  /** A blocker was released or a transition finished. */
  function reevaluate(trigger: ReloadTrigger = "blocker-released"): void {
    evaluate(trigger);
    if (stage !== "reloading") showNotice();
  }

  /** A new service worker activated (vite-plugin-pwa `onNeedReload`). Never reloads by itself. */
  function onServiceWorkerUpdated(): void {
    void checkNow("service-worker", { bypassShared: true }).then(() => {
      if (stopped || !pendingVersion) return;
      if (stage === "failed") startPreparation({ silent: true });
    });
  }

  /** "Refresh to update": one synchronous reload when ready and safe; otherwise remembered until it is. */
  function reloadNow(): void {
    if (stopped || !pendingVersion || stage === "reloading") return;
    if (stage === "failed") {
      retryPreparation();
      return;
    }
    requested = true;
    if (stage === "preparing") {
      preparingNoticeVisible = true;
      showNotice();
      return;
    }
    tryRequestedReload();
  }

  /** "Try again" after a failed preparation. */
  function retryPreparation(): void {
    if (stopped || !pendingVersion || stage !== "failed") return;
    silentRetry = false;
    requested = false;
    startPreparation({ silent: false });
    preparingNoticeVisible = true;
    preparingNoticeHandle = clearTimer(preparingNoticeHandle);
    showNotice();
  }

  async function runChunkRecovery(): Promise<ChunkRecoveryOutcome> {
    deps.log("chunk_recovery_started", { running });
    const result = await deps.fetchVersion();
    if (!result.ok) {
      deps.log("chunk_recovery_failed", { reason: result.reason });
      return "check-failed";
    }
    if (result.version === running) {
      deps.log("chunk_recovery_no_new_version", { running });
      return "same-version";
    }
    const transition = `${running}->${result.version}`;
    const marker = readJson<{ transition: string; at: number }>(deps.sessionStore, CHUNK_RECOVERY_KEY);
    if (marker && marker.transition === transition && deps.now() - marker.at < cfg.chunkMarkerTtlMs) {
      deps.log("chunk_recovery_already_attempted", { transition });
      return "already-attempted";
    }
    if (!writeJson(deps.sessionStore, CHUNK_RECOVERY_KEY, { transition, at: deps.now() })) {
      deps.log("chunk_recovery_failed", { reason: "no-session-storage" });
      return "check-failed";
    }
    applySignal({ version: result.version, source: "chunk", observedAt: deps.now(), network: true });
    if (pendingVersion !== result.version) return "deferred";
    chunkReloadRequested = true;
    await waitForPreparation(cfg.chunkPrepareWaitMs);
    evaluate("chunk");
    return stage === "reloading" ? "reloading" : "deferred";
  }

  /** A lazy chunk failed to load. Reloads at most once per version transition, only if newer. */
  function recoverFromChunkFailure(): Promise<ChunkRecoveryOutcome> {
    if (!versioned) return Promise.resolve("unversioned");
    if (stopped) return Promise.resolve("check-failed");
    if (!chunkRecovery) {
      chunkRecovery = runChunkRecovery().finally(() => {
        chunkRecovery = null;
      });
    }
    return chunkRecovery;
  }

  return {
    start,
    stop,
    checkNow,
    onRouteChange,
    reevaluate,
    onServiceWorkerUpdated,
    reloadNow,
    retryPreparation,
    recoverFromChunkFailure,
    getState() {
      return {
        running,
        versioned,
        stage,
        pendingVersion,
        reloading: stage === "reloading",
        requested,
        prepareVia,
        formInputSinceNavigation,
        checking: checking !== null,
      };
    },
  };
}

function stripUndefined(deps: DeployUpdateDeps): Partial<typeof DEFAULTS> {
  const out: Partial<typeof DEFAULTS> = {};
  for (const key of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
    const value = deps[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
