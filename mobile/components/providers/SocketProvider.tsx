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
import { io, type Socket } from "socket.io-client";
import { config } from "@/constants/config";
import { getMemoryAccessToken } from "@/services/api/client";
import { useAuthStore } from "@/store/authStore";

export type SocketConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
  connectionStatus: SocketConnectionStatus;
};

const SocketContext = createContext<SocketContextValue | null>(null);

function resolveLiveAccessToken(): string {
  return useAuthStore.getState().accessToken ?? getMemoryAccessToken() ?? "";
}

/**
 * Authenticated Socket.IO client — same origin + auth token pattern as web SocketProvider.
 * Socket lifetime follows auth *status*, not every access-token string change (avoids
 * reconnect → RealtimeQueryBridge invalidation storms after silent refresh).
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const status = useAuthStore((s) => s.status);
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

  const attachSocket = useCallback(() => {
    if (socketRef.current) return;
    const token = resolveLiveAccessToken();
    if (!token) return;

    setConnectionStatus("connecting");
    const s = io(config.apiUrl, {
      // Always read latest access token for connect + reconnect handshakes.
      auth: (cb: (data: { token: string }) => void) => {
        cb({ token: resolveLiveAccessToken() });
      },
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
    });

    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      setConnected(true);
      setConnectionStatus("connected");
    });
    s.on("disconnect", () => {
      setConnected(false);
      setConnectionStatus("disconnected");
    });
    s.on("connect_error", () => {
      setConnected(false);
      setConnectionStatus("disconnected");
    });
    const onReconnectAttempt = () => setConnectionStatus("reconnecting");
    const onReconnect = () => {
      setConnected(true);
      setConnectionStatus("connected");
    };
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.io.on("reconnect", onReconnect);

    return () => {
      s.io.off("reconnect_attempt", onReconnectAttempt);
      s.io.off("reconnect", onReconnect);
    };
  }, []);

  // Create / tear down once per authenticated session (not per token refresh).
  useEffect(() => {
    if (status !== "authenticated") {
      disconnect();
      return;
    }

    const detachListeners = attachSocket();

    return () => {
      detachListeners?.();
      // Only tear down when leaving authenticated (effect re-runs on status change).
      disconnect();
    };
  }, [status, disconnect, attachSocket]);

  // Late token after status=authenticated, or patch auth after refresh — never recreate.
  useEffect(() => {
    if (status !== "authenticated") return;
    const token = accessToken ?? getMemoryAccessToken();
    if (!token) return;

    if (!socketRef.current) {
      attachSocket();
      return;
    }
    socketRef.current.auth = { token };
  }, [accessToken, status, attachSocket]);

  const value = useMemo(
    () => ({ socket, connected, connectionStatus }),
    [socket, connected, connectionStatus],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    return { socket: null, connected: false, connectionStatus: "idle" };
  }
  return ctx;
}
