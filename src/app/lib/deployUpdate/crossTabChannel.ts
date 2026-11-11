import { parseCrossTabMessage, type CrossTabChannel, type StorageLike } from "./updateCoordinator";

export const DEPLOY_UPDATE_CHANNEL = "caretip-deploy-update";
export const DEPLOY_UPDATE_FALLBACK_KEY = "caretip-deploy-update-message";

type BroadcastChannelCtor = new (name: string) => {
  postMessage(message: unknown): void;
  addEventListener(type: "message", handler: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", handler: (event: MessageEvent) => void): void;
  close(): void;
};

type StorageEventTarget = {
  addEventListener(type: "storage", handler: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", handler: (event: StorageEvent) => void): void;
};

/**
 * BroadcastChannel when available, otherwise `storage` events on a dedicated key, otherwise null.
 * Coordination is an optimisation only: every tab still checks `/version.json` on its own.
 */
export function createDeployUpdateChannel(env: {
  BroadcastChannel?: BroadcastChannelCtor | undefined;
  localStore: StorageLike | null;
  storageEvents: StorageEventTarget | null;
}): CrossTabChannel | null {
  if (typeof env.BroadcastChannel === "function") {
    try {
      const channel = new env.BroadcastChannel(DEPLOY_UPDATE_CHANNEL);
      return {
        post(message) {
          try {
            channel.postMessage(message);
          } catch {
            /* closed or unserialisable — other tabs fall back to polling */
          }
        },
        subscribe(handler) {
          const onMessage = (event: MessageEvent) => {
            const message = parseCrossTabMessage(event.data);
            if (message) handler(message);
          };
          channel.addEventListener("message", onMessage);
          return () => channel.removeEventListener("message", onMessage);
        },
        close() {
          try {
            channel.close();
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      /* fall through to storage events */
    }
  }

  const store = env.localStore;
  const events = env.storageEvents;
  if (!store || !events) return null;
  let nonce = 0;
  return {
    post(message) {
      try {
        nonce += 1;
        store.setItem(DEPLOY_UPDATE_FALLBACK_KEY, JSON.stringify({ ...message, nonce: `${Date.now()}-${nonce}` }));
      } catch {
        /* quota or disabled storage */
      }
    },
    subscribe(handler) {
      const onStorage = (event: StorageEvent) => {
        if (event.key !== DEPLOY_UPDATE_FALLBACK_KEY || !event.newValue) return;
        try {
          const message = parseCrossTabMessage(JSON.parse(event.newValue));
          if (message) handler(message);
        } catch {
          /* ignore malformed values */
        }
      };
      events.addEventListener("storage", onStorage);
      return () => events.removeEventListener("storage", onStorage);
    },
    close() {},
  };
}
