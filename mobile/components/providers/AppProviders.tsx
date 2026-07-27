import { useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/services/api/queryClient";
import { sessionManager } from "@/services/auth/sessionManager";
import { subscribeGlobalErrors } from "@/utils/errors";
import { bindReactQueryOnlineManager } from "@/utils/reactQueryOnline";
import { useUiStore } from "@/store/uiStore";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { PushNotificationBridge } from "@/components/providers/PushNotificationBridge";
import { SessionExpiryBridge } from "@/components/providers/SessionExpiryBridge";
import { SocketProvider } from "@/components/providers/SocketProvider";
import { RealtimeQueryBridge } from "@/components/providers/RealtimeQueryBridge";
import { LocaleBridge } from "@/components/providers/LocaleBridge";

bindReactQueryOnlineManager();

function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    void sessionManager.bootstrapSession();
  }, []);
  return <>{children}</>;
}

function GlobalErrorBridge({ children }: { children: ReactNode }) {
  const setGlobalError = useUiStore((s) => s.setGlobalError);
  useEffect(() => subscribeGlobalErrors(setGlobalError), [setGlobalError]);
  return <>{children}</>;
}

function NetworkBridge({ children }: { children: ReactNode }) {
  useNetworkStatus();
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleBridge>
        <NetworkBridge>
          <GlobalErrorBridge>
            <AuthBootstrap>
              <SocketProvider>
                <SessionExpiryBridge />
                <PushNotificationBridge />
                <RealtimeQueryBridge />
                {children}
              </SocketProvider>
            </AuthBootstrap>
          </GlobalErrorBridge>
        </NetworkBridge>
      </LocaleBridge>
    </QueryClientProvider>
  );
}
