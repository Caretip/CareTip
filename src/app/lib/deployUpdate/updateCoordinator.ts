import { isValidDeployVersion, isVersionedBuild } from "./buildInfo";
import type { DeployVersionCheckResult } from "./versionCheck";

/**
 * Detects a newer frontend deployment and decides when this tab may reload.
 *
 * Reload rules (all must hold unless the user clicks "Refresh now"):
 * - a newer version is confirmed by `/version.json` (or by another tab's confirmed check);
 * - no blocker: explicit critical operations, auth refresh/migration, login/logout transitions,
 *   Stripe hand-off, in-flight state-changing requests;
 * - the route is not a payment-return, callback or guest tip page (chunk recovery excepted);
 * - the moment is safe: an in-app navigation, the tab is hidden, or the user has been idle with no
 *   focused field — and no form input since the last navigation (a navigation clears that, and it
 *   lapses after a long absence so an abandoned form cannot pin the tab);
 * - this tab has not already reloaded for the same version too often (loop guard).
 *
 * "Refresh now" skips the route, idle and loop-guard rules but still waits for blockers, so a click
 * cannot abort a payment, login or save that is in flight.
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
  | "update_deferred"
  | "reload_initiated"
  | "reload_suppressed"
  | "reload_aborted"
  | "chunk_recovery_started"
  | "chunk_recovery_no_new_version"
  | "chunk_recovery_already_attempted"
  | "chunk_recovery_failed";

/**
 * `deferred`: this tab will reload on its own at a safe moment.
 * `manual`: it will not (loop guard spent or no sessionStorage); only the user can refresh.
 * `reloading`: the user clicked "Refresh now"; no action is offered until the refresh lands or fails.
 */
export type DeployUpdateNotice =
  | { kind: "deferred" | "manual"; version: string }
  | { kind: "reloading"; version: string | null }
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
  /** Let the service worker pick up the new release before reloading. Must settle on its own. */
  prepareReload?(): Promise<void>;
  notify(notice: DeployUpdateNotice): void;
  log(event: DeployUpdateEvent, fields?: Record<string, string | number | boolean | null>): void;
  pollIntervalMs?: number;
  hiddenPollIntervalMs?: number;
  idleReloadMs?: number;
  formInputGuardMs?: number;
  sharedCheckFreshMs?: number;
  maxReloadsPerVersion?: number;
  chunkMarkerTtlMs?: number;
  manualReloadGraceMs?: number;
};

export const SHARED_CHECK_KEY = "caretip-deploy-version-check";
export const RELOAD_BUDGET_KEY = "caretip-deploy-reload";
export const CHUNK_RECOVERY_KEY = "caretip-deploy-chunk-recovery";
export const MANUAL_RELOAD_KEY = "caretip-deploy-manual-reload";

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
  /**
   * After "Refresh now", a page that still boots the old bundle (the new service worker was not
   * ready yet) keeps showing "updating" this long and reloads once more when the worker activates.
   */
  manualReloadGraceMs: 30_000,
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

export type DeployUpdateCoordinator = ReturnType<typeof createDeployUpdateCoordinator>;

export function createDeployUpdateCoordinator(deps: DeployUpdateDeps) {
  const cfg = { ...DEFAULTS, ...stripUndefined(deps) };
  const running = deps.runningVersion;
  const versioned = isVersionedBuild(running);

  let started = false;
  let stopped = false;
  let pendingVersion: string | null = null;
  let checking: Promise<void> | null = null;
  let reloading = false;
  let chunkReloadRequested = false;
  let manualReloadRequested = false;
  let noticeKey: string | null = null;
  let lastActivityAt = deps.now();
  let formInputSinceNavigation = false;
  let lastFormInputAt = 0;
  let lastDeferLog = "";
  let lastCheckAt = 0;
  let pollHandle: unknown = null;
  let manualGraceHandle: unknown = null;
  const cleanups: Array<() => void> = [];

  /** Version a "Refresh now" on the previous page was aiming for, while still within the grace window. */
  function activeManualReloadTarget(): string | null {
    const marker = readJson<{ version: string; at: number }>(deps.sessionStore, MANUAL_RELOAD_KEY);
    if (!marker || typeof marker.version !== "string" || typeof marker.at !== "number") return null;
    if (marker.version === running || deps.now() - marker.at >= cfg.manualReloadGraceMs) return null;
    return marker.version;
  }

  function clearManualReloadMarker(): void {
    try {
      deps.sessionStore?.removeItem(MANUAL_RELOAD_KEY);
    } catch {
      /* storage unavailable */
    }
  }
  let chunkRecovery: Promise<ChunkRecoveryOutcome> | null = null;

  function setPending(version: string, source: string): void {
    if (version === running) {
      clearManualReloadMarker();
      if (pendingVersion) {
        deps.log("update_cleared", { version });
        pendingVersion = null;
        chunkReloadRequested = false;
        if (noticeKey) {
          noticeKey = null;
          deps.notify({ kind: "cleared" });
        }
      }
      return;
    }
    if (pendingVersion !== version) {
      pendingVersion = version;
      lastDeferLog = "";
      deps.log("update_detected", { running, deployed: version, source });
    }
  }

  function showNotice(): void {
    if (!pendingVersion || deps.isQuietRoute() || manualReloadRequested) return;
    const resumeTarget = activeManualReloadTarget();
    if (resumeTarget === pendingVersion) {
      const resumeKey = `${pendingVersion}:reloading`;
      if (noticeKey === resumeKey) return;
      noticeKey = resumeKey;
      deps.notify({ kind: "reloading", version: pendingVersion });
      if (manualGraceHandle === null) {
        manualGraceHandle = deps.timers.setTimeout(() => {
          manualGraceHandle = null;
          clearManualReloadMarker();
          noticeKey = null;
          showNotice();
        }, cfg.manualReloadGraceMs);
      }
      return;
    }
    const kind = reloadBudgetAvailable(pendingVersion) ? "deferred" : "manual";
    const key = `${pendingVersion}:${kind}`;
    if (noticeKey === key) return;
    noticeKey = key;
    deps.notify({ kind, version: pendingVersion });
  }

  function logDeferred(reason: string): void {
    const key = `${pendingVersion}:${reason}`;
    if (key === lastDeferLog) return;
    lastDeferLog = key;
    deps.log("update_deferred", { deployed: pendingVersion, reason });
  }

  function reloadBudgetAvailable(version: string): boolean {
    if (!deps.sessionStore) return false;
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
    if (stopped || reloading) return;
    if (manualReloadRequested) {
      void performReload("manual", true);
      return;
    }
    if (!pendingVersion) return;
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
    if (!reloadBudgetAvailable(pendingVersion)) {
      logDeferred("reload-budget");
      deps.log("reload_suppressed", { deployed: pendingVersion });
      showNotice();
      return;
    }
    void performReload(trigger, false);
  }

  async function performReload(trigger: ReloadTrigger, manual: boolean): Promise<void> {
    const target = pendingVersion;
    if (reloading) return;
    if (manual) {
      const blocked = deps.getBlockReason();
      if (blocked) {
        logDeferred(blocked);
        return;
      }
    }
    reloading = true;
    if (target && !manual && !spendReloadBudget(target)) {
      reloading = false;
      logDeferred("reload-budget");
      showNotice();
      return;
    }
    deps.log("reload_initiated", { trigger, running, deployed: target, manual });
    if (target) deps.channel?.post({ type: "reloading", version: target, at: deps.now() });
    try {
      await deps.prepareReload?.();
    } catch {
      /* the reload itself still fetches the new release over the network */
    }
    const blocked = deps.getBlockReason();
    if (blocked || stopped) {
      reloading = false;
      deps.log("reload_aborted", { reason: blocked ?? "stopped" });
      if (blocked) logDeferred(blocked);
      showNotice();
      return;
    }
    if (manual && target) writeJson(deps.sessionStore, MANUAL_RELOAD_KEY, { version: target, at: deps.now() });
    deps.reload();
  }

  function applyRemoteVersion(version: string, source: string): void {
    setPending(version, source);
    evaluate("cross-tab");
  }

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
        setPending(shared.version, "shared-cache");
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
    setPending(result.version, "check");
    evaluate(trigger);
  }

  function checkNow(trigger: ReloadTrigger, options?: { bypassShared?: boolean }): Promise<void> {
    if (!started || stopped || reloading || !versioned) return Promise.resolve();
    if (checking) return checking;
    if (!deps.env.isOnline()) return Promise.resolve();
    checking = runCheck(trigger, options?.bypassShared === true).finally(() => {
      checking = null;
    });
    return checking;
  }

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

  function start(): void {
    if (started || stopped) return;
    started = true;
    deps.log("running_version", { running, versioned });
    if (!versioned) return;

    const { env } = deps;
    cleanups.push(
      env.listen("document", "visibilitychange", () => {
        if (env.isVisible()) void checkNow("visible");
        else evaluate("hidden");
      }),
      env.listen("window", "online", () => void checkNow("online")),
      env.listen("window", "pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted) void checkNow("pageshow");
      }),
      ...["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].map((type) =>
        env.listen("document", type, onActivity),
      ),
      env.listen("document", "input", onInput),
    );
    if (deps.channel) {
      cleanups.push(
        deps.channel.subscribe((message) => {
          applyRemoteVersion(message.version, message.type === "reloading" ? "cross-tab-reload" : "cross-tab");
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
    if (manualGraceHandle !== null) deps.timers.clearTimeout(manualGraceHandle);
    manualGraceHandle = null;
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
  }

  /** The service worker activated a new release (vite-plugin-pwa `onNeedReload`). */
  function onServiceWorkerUpdated(): void {
    void checkNow("service-worker", { bypassShared: true }).then(() => {
      const resumeTarget = activeManualReloadTarget();
      if (!resumeTarget || resumeTarget !== pendingVersion || stopped || reloading) return;
      clearManualReloadMarker();
      manualReloadRequested = true;
      void performReload("manual", true);
    });
  }

  /** User clicked "Refresh now". Waits for active blockers; retried on each blocker release or poll. */
  function reloadNow(): void {
    manualReloadRequested = true;
    noticeKey = `${pendingVersion}:reloading`;
    deps.notify({ kind: "reloading", version: pendingVersion });
    void performReload("manual", true);
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
    setPending(result.version, "chunk");
    chunkReloadRequested = true;
    evaluate("chunk");
    return reloading ? "reloading" : "deferred";
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
    recoverFromChunkFailure,
    getState() {
      return {
        running,
        versioned,
        pendingVersion,
        reloading,
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
