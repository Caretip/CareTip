/**
 * Tells other tabs that this browser's session ended, so a tab cannot stay on a dashboard after
 * sign-out. Carries no token or user data.
 *
 * "logout" is a confirmed user action. "expired" only means this tab was refused: receivers verify
 * with their own refresh, so one tab's mistake cannot sign every tab out.
 *
 * BroadcastChannel is the primary transport; a localStorage write covers browsers without it.
 */
export type SessionEndedReason = "logout" | "expired";

type SessionEndedMessage = { id: string; reason: SessionEndedReason; at: number };

const CHANNEL_NAME = "caretip-auth-session-v1";
const STORAGE_KEY = "caretip_auth_session_ended";
/** A storage value older than this is history, not an event. */
const MESSAGE_MAX_AGE_MS = 10_000;
const SEEN_IDS_MAX = 20;

const seenIds: string[] = [];

function alreadySeen(id: string): boolean {
  if (seenIds.includes(id)) return true;
  seenIds.push(id);
  if (seenIds.length > SEEN_IDS_MAX) seenIds.shift();
  return false;
}

function parseMessage(value: unknown): SessionEndedMessage | null {
  if (!value || typeof value !== "object") return null;
  const { id, reason, at } = value as Partial<SessionEndedMessage>;
  if (typeof id !== "string" || typeof at !== "number") return null;
  if (reason !== "logout" && reason !== "expired") return null;
  return { id, reason, at };
}

export function publishSessionEnded(reason: SessionEndedReason): void {
  if (typeof window === "undefined") return;
  const message: SessionEndedMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    reason,
    at: Date.now(),
  };
  alreadySeen(message.id);
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    } catch {
      // storage below still delivers it
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    // private mode: BroadcastChannel above still delivers it
  }
}

export function subscribeSessionEnded(handler: (reason: SessionEndedReason) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const receive = (raw: unknown) => {
    const message = parseMessage(raw);
    if (!message || alreadySeen(message.id)) return;
    if (Date.now() - message.at > MESSAGE_MAX_AGE_MS) return;
    handler(message.reason);
  };

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => receive(event.data);
    } catch {
      channel = null;
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // ignore malformed values
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
