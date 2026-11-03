import { handleServiceWorkerUpdated } from "./runtime";

let registered = false;

/**
 * Registers the Workbox SW. `autoUpdate` still activates new workers immediately, but the page reload
 * that vite-plugin-pwa would otherwise force is routed through the deployment update coordinator.
 */
export function registerCaretipServiceWorker(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedReload: handleServiceWorkerUpdated,
    });
  });
}
