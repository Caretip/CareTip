import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IsolateProviderChildren } from "../lib/isolateProviderChildren";
import type { Socket } from "socket.io-client";
import { resolveApiBaseUrl } from "../lib/apiOrigin";
import { AUTH_STORAGE_SYNC_EVENT } from "../lib/authStorageSync";
import { getMemoryAccessToken } from "../lib/accessTokenStore";
import { SOCKET_CONNECTED_EVENT, SOCKET_RECONNECTED_EVENT } from "../lib/realtime/realtimeContracts";

/** Same origin as REST: VITE_API_URL or current origin (Vite proxy for /socket.io in dev). */
function getSocketUrl(): string {
  const base = resolveApiBaseUrl();
  if (base) return base;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export type SocketConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

type SocketInstanceContextValue = {
  socket: Socket | null;
  registerInterest: () => () => void;
};

type SocketStatusContextValue = {
  connected: boolean;
  connectionStatus: SocketConnectionStatus;
};

/**
 * WebSocket only. Long-polling needs every request of a session to reach the same API instance,
 * and the API runs on several instances without sticky sessions. Where WebSockets are blocked,
 * screens keep refreshing over REST (useRealtimeFallback).
 */
const SOCKET_TRANSPORTS = ["websocket"];
/** Backoff for recovering after the server refused the token (expired while idle, deploy, ...). */
const AUTH_RECOVERY_BASE_MS = 5_000;
const AUTH_RECOVERY_MAX_MS = 5 * 60_000;

const SocketInstanceContext = createContext<SocketInstanceContextValue | null>(null);
const SocketStatusContext = createContext<SocketStatusContextValue | null>(null);

/**
 * Single authenticated Socket.IO connection shared across the app.
 * Instance vs status are split so connection-flag churn does not re-render
 * consumers that only need the socket handle (tip listeners, verification sync).
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const interestRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<SocketConnectionStatus>("idle");

  const authRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authRecoveryAttemptRef = useRef(0);

  const clearAuthRecovery = useCallback(() => {
    if (authRecoveryTimerRef.current) clearTimeout(authRecoveryTimerRef.current);
    authRecoveryTimerRef.current = null;
  }, []);

  const disconnect = useCallback(() => {
    clearAuthRecovery();
    const s = socketRef.current;
    if (s) {
      s.removeAllListeners();
      s.close();
    }
    socketRef.current = null;
    setSocket(null);
    setConnected(false);
    setConnectionStatus("idle");
  }, [clearAuthRecovery]);

  const connect = useCallback(async () => {
    clearAuthRecovery();
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    }

    const url = getSocketUrl();
    const token = getMemoryAccessToken();
    if (!url || !token) {
      setConnectionStatus("idle");
      return;
    }

    setConnectionStatus("connecting");
    const { io } = await import("socket.io-client");
    const s = io(url, {
      // Read on every (re)connection attempt, so a reconnect never replays an old access token.
      auth: (cb) => cb({ token: getMemoryAccessToken() ?? "" }),
      transports: SOCKET_TRANSPORTS,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    const dispatchSocketConnected = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SOCKET_CONNECTED_EVENT));
      }
    };
    const onConnect = () => {
      authRecoveryAttemptRef.current = 0;
      setConnected(true);
      setConnectionStatus("connected");
      dispatchSocketConnected();
    };
    /**
     * The server refused the handshake, so Socket.IO will not retry on its own. Refresh the session
     * once (a new token reconnects through AUTH_STORAGE_SYNC_EVENT) and retry with backoff.
     */
    const scheduleAuthRecovery = () => {
      if (authRecoveryTimerRef.current) return;
      const attempt = authRecoveryAttemptRef.current;
      authRecoveryAttemptRef.current = attempt + 1;
      const delay = Math.min(AUTH_RECOVERY_MAX_MS, AUTH_RECOVERY_BASE_MS * 2 ** attempt);
      authRecoveryTimerRef.current = setTimeout(() => {
        authRecoveryTimerRef.current = null;
        if (socketRef.current !== s) return;
        void import("../lib/api")
          .then(({ refreshSessionAPI }) => refreshSessionAPI())
          .catch(() => undefined)
          .finally(() => {
            // A changed token already replaced this socket; otherwise try again with what we have.
            if (socketRef.current === s && !s.connected && getMemoryAccessToken()) s.connect();
          });
      }, delay);
    };
    const onDisconnect = () => {
      setConnected(false);
      setConnectionStatus("disconnected");
    };
    const onConnectError = (err: Error) => {
      setConnected(false);
      setConnectionStatus("disconnected");
      // Middleware refusals leave the socket inactive. "Forbidden" (no matching profile) stays
      // down; retrying could not change the answer.
      if (!s.active && err?.message === "Unauthorized") scheduleAuthRecovery();
    };
    const onReconnectAttempt = () => {
      setConnectionStatus("reconnecting");
    };
    const onReconnect = () => {
      setConnected(true);
      setConnectionStatus("connected");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SOCKET_RECONNECTED_EVENT));
        window.dispatchEvent(new CustomEvent(SOCKET_CONNECTED_EVENT));
      }
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.io.on("reconnect", onReconnect);

    void import("../lib/dashboardRuntimeProfiler").then(
      ({ isDashboardProfilerEnabled, markDashboardSocketMessage }) => {
        if (!isDashboardProfilerEnabled()) return;
        s.onAny((eventName: string) => {
          markDashboardSocketMessage(String(eventName));
        });
      },
    );

    socketRef.current = s;
    setSocket(s);
  }, [clearAuthRecovery]);

  const registerInterest = useCallback(() => {
    interestRef.current += 1;
    if (interestRef.current === 1) connect();
    return () => {
      interestRef.current = Math.max(0, interestRef.current - 1);
      if (interestRef.current === 0) disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    const reconnectWithFreshToken = () => {
      if (interestRef.current <= 0) return;
      disconnect();
      connect();
    };
    const onAuthSync = () => reconnectWithFreshToken();
    window.addEventListener(AUTH_STORAGE_SYNC_EVENT, onAuthSync);
    return () => {
      window.removeEventListener(AUTH_STORAGE_SYNC_EVENT, onAuthSync);
    };
  }, [connect, disconnect]);

  const instanceValue = useMemo(
    () => ({ socket, registerInterest }),
    [socket, registerInterest],
  );
  const statusValue = useMemo(
    () => ({ connected, connectionStatus }),
    [connected, connectionStatus],
  );

  return (
    <SocketInstanceContext.Provider value={instanceValue}>
      <SocketStatusContext.Provider value={statusValue}>
        <IsolateProviderChildren>{children}</IsolateProviderChildren>
      </SocketStatusContext.Provider>
    </SocketInstanceContext.Provider>
  );
}

function useSocketInstanceContext(): SocketInstanceContextValue {
  const ctx = useContext(SocketInstanceContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

function useSocketStatusContext(): SocketStatusContextValue {
  const ctx = useContext(SocketStatusContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

/** Connection flags only — does not re-render when the socket instance is assigned. */
export function useSocketStatus(): SocketStatusContextValue {
  return useSocketStatusContext();
}

/**
 * Socket handle + interest registration. Does not re-render on connect/disconnect
 * status flips (use useSocketStatus for badges / fallbacks).
 */
export function useSocketInstance(enabled: boolean): { socket: Socket | null } {
  const { socket, registerInterest } = useSocketInstanceContext();

  useEffect(() => {
    if (!enabled) return;
    return registerInterest();
  }, [enabled, registerInterest]);

  return { socket: enabled ? socket : null };
}

/**
 * Full socket subscription (instance + status). Prefer useSocketInstance /
 * useSocketStatus when a consumer only needs one half.
 */
export function useSocket(enabled: boolean) {
  const { socket, registerInterest } = useSocketInstanceContext();
  const { connected, connectionStatus } = useSocketStatusContext();

  useEffect(() => {
    if (!enabled) return;
    return registerInterest();
  }, [enabled, registerInterest]);

  if (!enabled) {
    return {
      socket: null as Socket | null,
      connected: false,
      connectionStatus: "idle" as SocketConnectionStatus,
    };
  }

  return { socket, connected, connectionStatus };
}

/**
 * Delays enabling the socket to the next macrotask so route paint and critical
 * fetches are not blocked by the WebSocket handshake.
 */
export function useDeferSocketConnect(shouldConnect: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!shouldConnect) {
      setReady(false);
      return;
    }
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, [shouldConnect]);
  return ready;
}
