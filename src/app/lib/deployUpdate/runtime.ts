import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import { isSessionRefreshInFlight } from "../api";
import { isAuthLogoutTransitionActive, subscribeAuthLogoutTransition } from "../authLogoutTransition";
import { isAuthPostLoginTransitionActive, subscribeAuthPostLoginTransition } from "../authPostLoginTransition";
import { isChunkLoadFailure, recoverStaleChunkOnce } from "../chunkLoadRecovery";
import {
  isExternalStripeNavigationHoldActive,
  subscribeExternalStripeNavigationHold,
} from "../externalStripeNavigationHold";
import { createAgeLimitedSignal } from "./ageLimitedSignal";
import { isVersionedBuild, runningDeployBuild } from "./buildInfo";
import { createDeployUpdateChannel } from "./crossTabChannel";
import {
  inFlightMutationRequestCount,
  installMutationRequestTracker,
  isMutationRequestSettling,
  subscribeMutationRequests,
} from "./mutationRequestTracker";
import { deployUpdateRouteDeferReason, isGuestTipFlowRoute } from "./routePolicy";
import { getActiveUpdateBlockers, setUpdateBlockerExpiredHandler, subscribeUpdateBlockers } from "./updateBlockers";
import {
  createDeployUpdateCoordinator,
  type DeployUpdateCoordinator,
  type DeployUpdateEvent,
  type DeployUpdateNotice,
  type StorageLike,
} from "./updateCoordinator";
import { fetchDeployedVersion } from "./versionCheck";

const NOTICE_TOAST_ID = "caretip-deploy-update";
const SW_PREPARE_TIMEOUT_MS = 8_000;
/** A Stripe hand-off normally ends in `pagehide` within seconds; a cancelled one must not block forever. */
const STRIPE_HOLD_BLOCK_MAX_MS = 5 * 60_000;

let coordinator: DeployUpdateCoordinator | null = null;
let stripeHold: ReturnType<typeof createAgeLimitedSignal> | null = null;
let runtimeStarted = false;
const lastLogged = new Map<DeployUpdateEvent, string>();

function probeStorage(kind: "localStorage" | "sessionStorage"): StorageLike | null {
  try {
    const store = window[kind];
    const key = "__caretip_deploy_probe";
    store.setItem(key, "1");
    store.removeItem(key);
    return store;
  } catch {
    return null;
  }
}

/** Structured, de-duplicated diagnostics. Fields are versions, triggers and reasons only. */
function logDeployEvent(
  event: DeployUpdateEvent,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  if ((event === "version_check_ok" || event === "version_check_shared") && fields.deployed === fields.running) {
    return;
  }
  const key = JSON.stringify(fields);
  if (lastLogged.get(event) === key) return;
  lastLogged.set(event, key);
  console.info("[CareTip deploy]", event, fields);
}

function ensureStripeHold(): ReturnType<typeof createAgeLimitedSignal> {
  stripeHold ??= createAgeLimitedSignal({
    isActive: isExternalStripeNavigationHoldActive,
    subscribe: subscribeExternalStripeNavigationHold,
    now: () => Date.now(),
    maxMs: STRIPE_HOLD_BLOCK_MAX_MS,
  });
  return stripeHold;
}

function currentBlockReason(): string | null {
  const blockers = getActiveUpdateBlockers();
  if (blockers.length > 0) return `blocker:${blockers[0]!.name}`;
  if (isSessionRefreshInFlight()) return "auth:refresh";
  if (isAuthPostLoginTransitionActive()) return "auth:post-login";
  if (isAuthLogoutTransitionActive()) return "auth:logout";
  if (ensureStripeHold().isActive()) return "payment:stripe-redirect";
  if (inFlightMutationRequestCount() > 0) return "request:mutation";
  if (isMutationRequestSettling()) return "request:mutation-settling";
  return null;
}

function hasFocusedEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function showNotice(notice: DeployUpdateNotice): void {
  if (notice.kind === "cleared") {
    toast.dismiss(NOTICE_TOAST_ID);
    return;
  }
  toast(i18n.t("shell.deployUpdate.title"), {
    id: NOTICE_TOAST_ID,
    description: i18n.t(
      notice.kind === "manual" ? "shell.deployUpdate.manualDescription" : "shell.deployUpdate.description",
    ),
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: i18n.t("shell.deployUpdate.refreshNow"),
      onClick: () => coordinator?.reloadNow(),
    },
  });
}

function waitFor(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Ask the controlling SW to fetch the new `sw.js` so the reload is not served the old precache. */
async function prepareServiceWorkerForReload(): Promise<void> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!registration) return;
  await waitFor(registration.update(), SW_PREPARE_TIMEOUT_MS);
  const incoming = registration.installing ?? registration.waiting;
  if (!incoming) return;
  await waitFor(
    new Promise<void>((resolve) => {
      const check = () => {
        if (incoming.state === "activated" || incoming.state === "redundant") {
          incoming.removeEventListener("statechange", check);
          resolve();
        }
      };
      incoming.addEventListener("statechange", check);
      check();
    }),
    SW_PREPARE_TIMEOUT_MS,
  );
}

function ensureCoordinator(): DeployUpdateCoordinator {
  if (coordinator) return coordinator;
  const localStore = probeStorage("localStorage");
  coordinator = createDeployUpdateCoordinator({
    runningVersion: runningDeployBuild().version,
    fetchVersion: () => fetchDeployedVersion({ fetchImpl: (input, init) => fetch(input, init) }),
    now: () => Date.now(),
    timers: {
      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      setInterval: (handler, ms) => window.setInterval(handler, ms),
      clearInterval: (handle) => window.clearInterval(handle as number),
    },
    env: {
      isVisible: () => document.visibilityState !== "hidden",
      isOnline: () => navigator.onLine !== false,
      hasFocusedEditable,
      listen(target, type, handler) {
        const node: EventTarget = target === "window" ? window : document;
        node.addEventListener(type, handler, { capture: true, passive: true });
        return () => node.removeEventListener(type, handler, { capture: true });
      },
    },
    localStore,
    sessionStore: probeStorage("sessionStorage"),
    channel: createDeployUpdateChannel({
      BroadcastChannel: typeof BroadcastChannel === "function" ? BroadcastChannel : undefined,
      localStore,
      storageEvents: window,
    }),
    reload: () => window.location.reload(),
    getBlockReason: currentBlockReason,
    getRouteDeferReason: () => deployUpdateRouteDeferReason(window.location.pathname, window.location.search),
    isQuietRoute: () => isGuestTipFlowRoute(window.location.pathname),
    prepareReload: prepareServiceWorkerForReload,
    notify: showNotice,
    log: logDeployEvent,
  });
  return coordinator;
}

/** Start version polling once per page (safe under React Strict Mode and repeated calls). */
export function startDeployUpdateRuntime(): void {
  if (runtimeStarted || typeof window === "undefined") return;
  runtimeStarted = true;
  const instance = ensureCoordinator();
  ensureStripeHold();
  installMutationRequestTracker(window);
  setUpdateBlockerExpiredHandler((info) => logDeployEvent("update_deferred", { reason: `blocker-expired:${info.name}` }));
  const reevaluate = () => instance.reevaluate("blocker-released");
  subscribeUpdateBlockers(reevaluate);
  subscribeMutationRequests(reevaluate);
  subscribeAuthPostLoginTransition(reevaluate);
  subscribeAuthLogoutTransition(reevaluate);
  subscribeExternalStripeNavigationHold(reevaluate);
  instance.start();
}

/** Called by the router after each committed navigation. */
export function notifyDeployUpdateRouteChange(): void {
  coordinator?.onRouteChange();
}

/**
 * vite-plugin-pwa activated a new service worker for this page. Never reloads directly: an
 * unversioned bundle cannot compare versions, so it keeps running until the user navigates away.
 */
export function handleServiceWorkerUpdated(): void {
  if (typeof window === "undefined" || !isVersionedBuild(runningDeployBuild().version)) return;
  ensureCoordinator().onServiceWorkerUpdated();
}

/**
 * Bounded stale-chunk recovery. Versioned builds reload only after `/version.json` confirms a newer
 * deployment, once per transition; unversioned (dev) builds keep the legacy cooldown reload.
 */
export function handleChunkLoadFailure(error: unknown): void {
  if (typeof window === "undefined" || !isChunkLoadFailure(error)) return;
  if (!isVersionedBuild(runningDeployBuild().version)) {
    recoverStaleChunkOnce();
    return;
  }
  void ensureCoordinator().recoverFromChunkFailure();
}

/** `vite:preloadError`: let the import reject so the route error UI is the fallback. */
export function handleVitePreloadError(event: Event): void {
  if (typeof window === "undefined") return;
  if (!isVersionedBuild(runningDeployBuild().version)) {
    event.preventDefault();
    recoverStaleChunkOnce();
    return;
  }
  void ensureCoordinator().recoverFromChunkFailure();
}
