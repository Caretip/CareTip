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

/**
 * Authenticated Socket.IO client — same origin + auth token pattern as web SocketProvider.
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

  useEffect(() => {
    if (status !== "authenticated" || !accessToken) {
      disconnect();
      return;
    }

    setConnectionStatus("connecting");
    const s = io(config.apiUrl, {
      auth: { token: accessToken },
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
    s.io.on("reconnect_attempt", () => setConnectionStatus("reconnecting"));
    s.io.on("reconnect", () => {
      setConnected(true);
      setConnectionStatus("connected");
    });

    return () => {
      s.removeAllListeners();
      s.close();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setConnectionStatus("idle");
    };
  }, [accessToken, status, disconnect]);

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
