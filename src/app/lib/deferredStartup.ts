import { migrateLegacyAccessTokenFromStorage } from "./accessTokenStore";
import { registerCaretipServiceWorker } from "./deployUpdate/serviceWorkerRegistration";
import { initSentry } from "./sentry";
import { readCookieConsent } from "./cookieConsent";
import { wakeRemoteApi } from "./wakeRemoteApi";
import { runWhenIdle } from "./runWhenIdle";

let started = false;

/** PWA, Sentry, API wake — must not block first paint. */
export function scheduleDeferredStartup(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  runWhenIdle(() => {
    if (readCookieConsent()?.analytics) {
      initSentry();
    }
    migrateLegacyAccessTokenFromStorage();
    wakeRemoteApi();
    registerCaretipServiceWorker();
  });
}
