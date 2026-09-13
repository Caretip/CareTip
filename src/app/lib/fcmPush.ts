import type { FirebaseApp } from "firebase/app";
import type { MessagePayload, Messaging } from "firebase/messaging";
import {
  deleteAllPushDeviceTokensApi,
  deletePushDeviceTokenApi,
  fetchPushFirebaseConfig,
  registerPushDeviceTokenApi,
  type FirebaseWebConfig,
} from "./api";
import { logClientError } from "./clientLog";
import { isApiRequestError } from "./apiError";
import { isApiConnectivityError } from "./errorMessages";
import { authDebug } from "./authDebugLog";

let firebaseApp: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let configCache: FirebaseWebConfig | null | undefined;
let messagingSupportedCache: boolean | null = null;

/** Last token successfully registered with the API (avoids duplicate POSTs across tabs/retries). */
let lastRegisteredToken: string | null = null;
let lastRegisteredAt = 0;
const REGISTER_DEDUPE_MS = 60_000;
const REGISTER_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

let registerInFlight: Promise<boolean> | null = null;
let registerRateLimitedUntil = 0;
let lastRateLimitHit = false;

function isPushRegistrationRateLimitError(err: unknown): boolean {
  if (isApiRequestError(err) && err.status === 429) return true;
  return (
    err instanceof Error &&
    /too many push registration/i.test(err.message)
  );
}

/** True after a 429 until backoff expires — callers should skip retries. */
export function isPushRegistrationRateLimited(): boolean {
  return Date.now() < registerRateLimitedUntil;
}

type ForegroundPushListener = (
  title: string,
  body: string,
  data?: Record<string, string>,
) => void;

const foregroundListeners = new Set<ForegroundPushListener>();
let foregroundMessagingStarted = false;
let foregroundMessagingTeardown: (() => void) | null = null;

function isUnsupportedMessagingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unsupported|not supported|messaging\/unsupported-browser|service worker|secure origin/i.test(msg);
}

async function isFirebaseMessagingSupported(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  if (messagingSupportedCache !== null) return messagingSupportedCache;
  try {
    const { isSupported } = await import("firebase/messaging");
    messagingSupportedCache = await isSupported();
  } catch {
    messagingSupportedCache = false;
  }
  return messagingSupportedCache ?? false;
}

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      "Notification" in window &&
      "serviceWorker" in navigator &&
      window.isSecureContext === true
    );
  } catch {
    return false;
  }
}

/** True when the user has already granted notification permission (no prompt). */
export function hasNotificationPermissionGranted(): boolean {
  if (!isWebPushSupported()) return false;
  try {
    return Notification.permission === "granted";
  } catch {
    return false;
  }
}

async function loadConfig(): Promise<FirebaseWebConfig | null> {
  if (configCache !== undefined) return configCache;
  try {
    configCache = await fetchPushFirebaseConfig();
  } catch (err) {
    if (!isApiConnectivityError(err)) {
      logClientError("fcmPush.loadConfig", err);
    }
    configCache = null;
  }
  return configCache;
}

const FCM_SW_URL = "/firebase-messaging-sw.js";
const FCM_SW_SCOPE = "/";

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

async function waitForServiceWorkerActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    if (reg.active) {
      resolve();
      return;
    }
    const onState = () => {
      if (reg.active) {
        worker.removeEventListener("statechange", onState);
        resolve();
      }
    };
    worker.addEventListener("statechange", onState);
    window.setTimeout(() => {
      worker.removeEventListener("statechange", onState);
      resolve();
    }, 8_000);
  });
}

async function resolveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    if (import.meta.env.PROD) {
      const reg = await navigator.serviceWorker.ready;
      await waitForServiceWorkerActive(reg);
      return reg;
    }
    let reg = await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE);
    if (!reg) {
      reg = await navigator.serviceWorker.register(FCM_SW_URL, { scope: FCM_SW_SCOPE });
    }
    await waitForServiceWorkerActive(reg);
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    if (!isUnsupportedMessagingError(err)) {
      logClientError("fcmPush.serviceWorkerRegistration", err);
    }
    return null;
  }
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!swRegistrationPromise) {
    swRegistrationPromise = resolveServiceWorkerRegistration().catch((err) => {
      swRegistrationPromise = null;
      throw err;
    });
  }
  try {
    return await swRegistrationPromise;
  } catch {
    return null;
  }
}

async function getMessagingInstance(config: FirebaseWebConfig): Promise<Messaging | null> {
  if (!(await isFirebaseMessagingSupported())) return null;
  try {
    const [{ initializeApp }, { getMessaging }] = await Promise.all([
      import("firebase/app"),
      import("firebase/messaging"),
    ]);
    if (!firebaseApp) {
      firebaseApp = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      });
    }
    if (!messaging) {
      messaging = getMessaging(firebaseApp);
    }
    return messaging;
  } catch (err) {
    if (!isUnsupportedMessagingError(err)) {
      logClientError("fcmPush.getMessaging", err);
    } else {
      messagingSupportedCache = false;
    }
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isWebPushSupported()) return "denied";
  try {
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

type ObtainFcmTokenOptions = {
  /** When false (default), never shows the browser permission dialog — only reads an existing token. */
  requestPermission?: boolean;
};

async function obtainFcmTokenFromBrowser(opts?: ObtainFcmTokenOptions): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  const config = await loadConfig();
  if (!config) return null;

  let permission: NotificationPermission;
  try {
    permission = Notification.permission;
  } catch {
    return null;
  }

  if (permission === "denied") return null;

  if (permission !== "granted") {
    if (!opts?.requestPermission) return null;
    permission = await requestNotificationPermission();
    if (permission !== "granted") return null;
  }

  const reg = await serviceWorkerRegistration();
  if (!reg) return null;

  const msg = await getMessagingInstance(config);
  if (!msg) return null;

  try {
    const { getToken } = await import("firebase/messaging");
    return await getToken(msg, {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: reg,
    });
  } catch (err) {
    if (!isUnsupportedMessagingError(err)) {
      logClientError("fcmPush.obtainFcmTokenFromBrowser", err);
    }
    return null;
  }
}

/** Returns the current FCM token without persisting it on the server. */
export async function getCurrentFcmDeviceToken(opts?: ObtainFcmTokenOptions): Promise<string | null> {
  return obtainFcmTokenFromBrowser(opts);
}

export type FcmDiagnostics = {
  supported: boolean;
  permission: NotificationPermission;
  configAvailable: boolean;
  hasToken: boolean;
};

export async function getFcmDiagnostics(): Promise<FcmDiagnostics> {
  const supported = isWebPushSupported();
  let permission: NotificationPermission = "denied";
  if (supported) {
    try {
      permission = Notification.permission;
    } catch {
      permission = "denied";
    }
  }
  const config = supported ? await loadConfig() : null;
  const configAvailable = Boolean(config);
  let hasToken = false;
  if (configAvailable && permission === "granted") {
    const token = await obtainFcmTokenFromBrowser();
    hasToken = Boolean(token);
  }
  return { supported, permission, configAvailable, hasToken };
}

export type RegisterFcmOptions = ObtainFcmTokenOptions & {
  /** Skip server register if the same token was synced recently (background sync). */
  dedupe?: boolean;
};

async function registerFcmDeviceTokenInner(opts?: RegisterFcmOptions): Promise<boolean> {
  lastRateLimitHit = false;
  try {
    if (isPushRegistrationRateLimited()) {
      authDebug("fcm_register_backoff");
      return Boolean(lastRegisteredToken);
    }

    const token = await obtainFcmTokenFromBrowser({
      requestPermission: opts?.requestPermission === true,
    });
    if (!token) return false;

    const dedupe = opts?.dedupe !== false;
    const now = Date.now();
    if (
      dedupe &&
      token === lastRegisteredToken &&
      now - lastRegisteredAt < REGISTER_DEDUPE_MS
    ) {
      authDebug("fcm_register_deduped");
      return true;
    }

    await registerPushDeviceTokenApi(token, { silent: true });
    lastRegisteredToken = token;
    lastRegisteredAt = now;
    registerRateLimitedUntil = 0;
    authDebug("fcm_register_ok");
    return true;
  } catch (err) {
    if (isPushRegistrationRateLimitError(err)) {
      lastRateLimitHit = true;
      registerRateLimitedUntil = Date.now() + REGISTER_RATE_LIMIT_BACKOFF_MS;
      authDebug("fcm_register_rate_limited");
      return Boolean(lastRegisteredToken);
    }
    if (isApiConnectivityError(err)) {
      authDebug("fcm_register_skipped_api_unreachable");
      return false;
    }
    logClientError("fcmPush.registerFcmDeviceToken", err);
    return false;
  }
}

export async function registerFcmDeviceToken(opts?: RegisterFcmOptions): Promise<boolean> {
  if (registerInFlight) return registerInFlight;
  registerInFlight = registerFcmDeviceTokenInner(opts).finally(() => {
    registerInFlight = null;
  });
  return registerInFlight;
}

/** Whether the latest register attempt hit server rate limiting (429). */
export function wasPushRegistrationRateLimited(): boolean {
  return lastRateLimitHit;
}

export function clearFcmClientRegistrationCache(): void {
  lastRegisteredToken = null;
  lastRegisteredAt = 0;
  registerRateLimitedUntil = 0;
  lastRateLimitHit = false;
}

export async function unregisterFcmDeviceToken(): Promise<void> {
  clearFcmClientRegistrationCache();
  const config = await loadConfig();
  if (config && messaging) {
    try {
      const reg = await serviceWorkerRegistration();
      const msg = await getMessagingInstance(config);
      if (msg && reg) {
        const { getToken } = await import("firebase/messaging");
        const token = await getToken(msg, {
          vapidKey: config.vapidKey,
          serviceWorkerRegistration: reg,
        });
        if (token) {
          await deletePushDeviceTokenApi(token);
        }
      }
    } catch (err) {
      if (!isUnsupportedMessagingError(err)) {
        logClientError("fcmPush.unregisterFcmDeviceToken", err);
      }
    }
  }
  try {
    await deleteAllPushDeviceTokensApi();
  } catch (err) {
    if (!isApiConnectivityError(err)) {
      logClientError("fcmPush.unregister.all", err);
    }
  }
}

const USER_FACING_PUSH_EVENTS = new Set([
  "tip_received",
  "payout_paid",
  "new_login",
  "employee_invited",
  "qr_scan",
  "qr_payment_success",
  "admin_announcement",
  "system_alert",
]);

/** Suppress test/debug pushes from UI (system notification + in-app toast). */
export function shouldDisplayUserFacingPush(data?: Record<string, string>): boolean {
  if (data?.type === "test") return false;
  if (data?.event === "test") return false;
  const event = data?.event;
  if (event) return USER_FACING_PUSH_EVENTS.has(event);
  return true;
}

function payloadTitleBody(payload: MessagePayload): { title: string; body: string } {
  const title =
    payload.notification?.title ?? payload.data?.title ?? "CareTip";
  const body = payload.notification?.body ?? payload.data?.body ?? "";
  return { title, body };
}

/** Shows a system notification via the FCM service worker (works in Firefox on localhost). */
export async function showPushNotification(
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (Notification.permission !== "granted") return;
  } catch {
    return;
  }
  const options: NotificationOptions = {
    body: body || undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: data ? { ...data } : {},
    tag: [data?.event, data?.tipId, data?.transactionId, data?.type]
      .filter(Boolean)
      .join("-") || "caretip-notification",
  };
  try {
    const reg = await serviceWorkerRegistration();
    if (reg?.showNotification) {
      await reg.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch (err) {
    if (!isUnsupportedMessagingError(err)) {
      logClientError("fcmPush.showPushNotification", err);
    }
  }
}

function startForegroundMessagingIfNeeded(): void {
  if (foregroundMessagingStarted) return;
  foregroundMessagingStarted = true;

  let cancelled = false;
  let unsubscribeOnMessage: (() => void) | null = null;

  void (async () => {
    if (!isWebPushSupported()) return;
    const config = await loadConfig();
    if (!config || cancelled) return;
    const reg = await serviceWorkerRegistration();
    if (!reg || cancelled) return;
    const msg = await getMessagingInstance(config);
    if (!msg || cancelled) return;

    const { onMessage } = await import("firebase/messaging");
    unsubscribeOnMessage = onMessage(msg, (payload: MessagePayload) => {
      const { title, body } = payloadTitleBody(payload);
      const data = payload.data as Record<string, string> | undefined;
      if (!shouldDisplayUserFacingPush(data)) return;

      const visible =
        typeof document !== "undefined" && document.visibilityState === "visible";

      if (visible) {
        for (const listener of foregroundListeners) {
          listener(title, body, data);
        }
      } else {
        void showPushNotification(title, body, data);
      }
    });
  })();

  foregroundMessagingTeardown = () => {
    cancelled = true;
    unsubscribeOnMessage?.();
    unsubscribeOnMessage = null;
    foregroundMessagingStarted = false;
  };
}

/** Foreground messages — in-app callback when tab is visible; system notification when hidden. */
export function subscribeForegroundPushMessages(
  onPayload?: ForegroundPushListener,
): () => void {
  if (onPayload) {
    foregroundListeners.add(onPayload);
    startForegroundMessagingIfNeeded();
  }

  return () => {
    if (onPayload) foregroundListeners.delete(onPayload);
    if (foregroundListeners.size === 0 && foregroundMessagingTeardown) {
      foregroundMessagingTeardown();
      foregroundMessagingTeardown = null;
    }
  };
}
