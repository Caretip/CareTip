import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { fetchPublicSocketRoomToken } from "../lib/api";
import { resolveApiBaseUrl } from "../lib/apiOrigin";

function getSocketUrl(): string {
  const base = resolveApiBaseUrl();
  if (base) return base;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export type PublicSocketStatus = "idle" | "connecting" | "connected" | "disconnected" | "reconnecting";

/** Fetch a new room token this long before the old one expires (tokens live 5 minutes). */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const FALLBACK_TOKEN_LIFETIME_MS = 4 * 60_000;
const REJOIN_BASE_MS = 2_000;
const REJOIN_MAX_MS = 60_000;

type RoomToken = { token: string; expiresAtMs: number };

function tokenExpiry(expiresAt: unknown): number {
  const ms = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : Date.now() + FALLBACK_TOKEN_LIFETIME_MS;
}

/**
 * Read-only Socket.io for guest flows: requires a short-lived signed `publicRoomToken`
 * from GET /api/socket/public-room-token before joining `public:business:{id}`.
 * Every connection attempt presents a token that is still valid (re-fetched near expiry), so a
 * reconnect after a deploy or a network drop is not refused for an expired token.
 */
export function usePublicSocket(businessId: string | null | undefined) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<PublicSocketStatus>("idle");

  useEffect(() => {
    const url = getSocketUrl();
    if (!businessId || !url) {
      setSocket(null);
      setConnected(false);
      setConnectionStatus("idle");
      return;
    }

    let cancelled = false;
    let activeSocket: Socket | null = null;
    let current: RoomToken | null = null;
    let tokenRequest: Promise<RoomToken> | null = null;
    let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
    let rejoinAttempt = 0;

    const freshToken = (): Promise<RoomToken> => {
      if (current && current.expiresAtMs - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
        return Promise.resolve(current);
      }
      if (!tokenRequest) {
        tokenRequest = fetchPublicSocketRoomToken({ businessId })
          .then((r) => {
            current = { token: r.token, expiresAtMs: tokenExpiry(r.expiresAt) };
            return current;
          })
          .finally(() => {
            tokenRequest = null;
          });
      }
      return tokenRequest;
    };

    const connect = async () => {
      setConnectionStatus("connecting");
      try {
        await freshToken();
        if (cancelled) return;

        const s = io(url, {
          // Called on every (re)connection attempt.
          auth: (cb) => {
            freshToken()
              .then((t) => cb({ publicRoomToken: t.token }))
              .catch(() => cb({ publicRoomToken: current?.token ?? "" }));
          },
          // Polling would need sticky sessions across API instances; REST fallback covers this page.
          transports: ["websocket"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
          timeout: 20000,
        });

        const onConnect = () => {
          rejoinAttempt = 0;
          setConnected(true);
          setConnectionStatus("connected");
        };
        const onDisconnect = () => {
          setConnected(false);
          setConnectionStatus("disconnected");
        };
        const onConnectError = () => {
          setConnected(false);
          setConnectionStatus("disconnected");
          // A refused handshake is not retried by Socket.IO itself. Retry with backoff and a newly
          // fetched token; an unknown business keeps being refused, so the backoff caps the load.
          if (!s.active && !rejoinTimer && !cancelled) {
            current = null;
            const delay = Math.min(REJOIN_MAX_MS, REJOIN_BASE_MS * 2 ** rejoinAttempt);
            rejoinAttempt += 1;
            rejoinTimer = setTimeout(() => {
              rejoinTimer = null;
              if (!cancelled && activeSocket === s && !s.connected) s.connect();
            }, delay);
          }
        };
        const onReconnectAttempt = () => setConnectionStatus("reconnecting");
        const onReconnect = () => {
          setConnected(true);
          setConnectionStatus("connected");
        };

        s.on("connect", onConnect);
        s.on("disconnect", onDisconnect);
        s.on("connect_error", onConnectError);
        s.io.on("reconnect_attempt", onReconnectAttempt);
        s.io.on("reconnect", onReconnect);

        activeSocket = s;
        setSocket(s);
      } catch {
        if (!cancelled) {
          setSocket(null);
          setConnected(false);
          setConnectionStatus("disconnected");
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (rejoinTimer) clearTimeout(rejoinTimer);
      if (activeSocket) {
        activeSocket.removeAllListeners();
        activeSocket.close();
      }
      setSocket(null);
      setConnected(false);
      setConnectionStatus("idle");
    };
  }, [businessId]);

  return { socket, connected, connectionStatus };
}
