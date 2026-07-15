/**
 * Cross-tab idle session bus: BroadcastChannel + localStorage fallback.
 * Checkpoint 1: transport only — no React mount.
 */

import { IDLE_CHANNEL_NAME, IDLE_STORAGE_BUS_KEY } from "./idleSessionConfig";

export type IdleChannelMessage =
  | { type: "activity"; ts: number }
  | { type: "stay"; ts: number }
  | { type: "warning"; logoutAt: number }
  | { type: "logout"; ts: number; leaderId: string };

export type IdleChannelHandler = (message: IdleChannelMessage) => void;

export type IdleSessionChannel = {
  publish: (message: IdleChannelMessage) => void;
  close: () => void;
};

function isIdleChannelMessage(value: unknown): value is IdleChannelMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  switch (msg.type) {
    case "activity":
    case "stay":
      return typeof msg.ts === "number" && Number.isFinite(msg.ts);
    case "warning":
      return typeof msg.logoutAt === "number" && Number.isFinite(msg.logoutAt);
    case "logout":
      return (
        typeof msg.ts === "number" &&
        Number.isFinite(msg.ts) &&
        typeof msg.leaderId === "string"
      );
    default:
      return false;
  }
}

function parseMessage(raw: unknown): IdleChannelMessage | null {
  if (typeof raw === "string") {
    try {
      return parseMessage(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  return isIdleChannelMessage(raw) ? raw : null;
}

/**
 * Create a cooperative idle channel for this tab.
 * Callers must ignore loopback echoes (BroadcastChannel does not deliver to self;
 * storage fallback may — filter by comparing leaderId / optional tab id later).
 */
export function createIdleSessionChannel(onMessage: IdleChannelHandler): IdleSessionChannel {
  let closed = false;
  let bc: BroadcastChannel | null = null;

  const deliver = (raw: unknown) => {
    if (closed) return;
    const message = parseMessage(raw);
    if (!message) return;
    onMessage(message);
  };

  if (typeof BroadcastChannel !== "undefined") {
    try {
      bc = new BroadcastChannel(IDLE_CHANNEL_NAME);
      bc.onmessage = (event: MessageEvent) => {
        deliver(event.data);
      };
    } catch {
      bc = null;
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== IDLE_STORAGE_BUS_KEY || event.newValue == null) return;
    deliver(event.newValue);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return {
    publish(message: IdleChannelMessage) {
      if (closed) return;

      if (bc) {
        try {
          bc.postMessage(message);
        } catch {
          // Fall through to storage.
        }
      }

      if (typeof localStorage === "undefined") return;
      try {
        // storage events fire in *other* documents only; include nonce so same-tab setItem
        // with identical payload still writes a distinct string for debugging.
        const payload = JSON.stringify({ ...message, _n: Date.now() });
        localStorage.setItem(IDLE_STORAGE_BUS_KEY, payload);
      } catch {
        // Quota / private mode — channel best-effort.
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (bc) {
        try {
          bc.close();
        } catch {
          // ignore
        }
        bc = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    },
  };
}

/** Validate helper exported for unit tests. */
export function parseIdleChannelMessageForTests(raw: unknown): IdleChannelMessage | null {
  return parseMessage(raw);
}
