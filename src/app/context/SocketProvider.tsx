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

  const disconnect = useCallback(() => {
    const s = socketRef.current;
    if (s) {
      s.removeAllListeners();
      s.close();
    }
    socketRef.current = null;
    setSocket(null);
    setConnected(false);
    setConnectionStatus("idle");
  }, []);

  const connect = useCallback(async () => {
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
      auth: { token },
      transports: ["polling", "websocket"],
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
      setConnected(true);
      setConnectionStatus("connected");
      dispatchSocketConnected();
    };
    const onDisconnect = () => {
      setConnected(false);
      setConnectionStatus("disconnected");
    };
    const onConnectError = () => {
      setConnected(false);
      setConnectionStatus("disconnected");
    };
    const onReconnectAttempt = () => setConnectionStatus("reconnecting");
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
  }, []);

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
      <SocketStatusContext.Provider value={statusValue}>{children}</SocketStatusContext.Provider>
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
