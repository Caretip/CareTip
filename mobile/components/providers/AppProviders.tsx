import { useEffect, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/services/api/queryClient";
import { subscribeGlobalErrors } from "@/utils/errors";
import { bindReactQueryOnlineManager } from "@/utils/reactQueryOnline";
import { useUiStore } from "@/store/uiStore";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { PushNotificationBridge } from "@/components/providers/PushNotificationBridge";
import { SessionExpiryBridge } from "@/components/providers/SessionExpiryBridge";
import { IdleSessionBridge } from "@/components/providers/IdleSessionBridge";
import { SocketProvider } from "@/components/providers/SocketProvider";
import { RealtimeQueryBridge } from "@/components/providers/RealtimeQueryBridge";
import { LocaleBridge } from "@/components/providers/LocaleBridge";
import { ThemeBridge } from "@/components/providers/ThemeBridge";
import { StartupBridge } from "@/components/providers/StartupBridge";
import { DeepLinkBridge } from "@/components/providers/DeepLinkBridge";

bindReactQueryOnlineManager();

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
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StartupBridge>
          <ThemeBridge>
            <LocaleBridge>
              <NetworkBridge>
                <GlobalErrorBridge>
                  <SocketProvider>
                    <SessionExpiryBridge />
                    <IdleSessionBridge>
                      <PushNotificationBridge />
                      <RealtimeQueryBridge />
                      <DeepLinkBridge />
                      {children}
                    </IdleSessionBridge>
                  </SocketProvider>
                </GlobalErrorBridge>
              </NetworkBridge>
            </LocaleBridge>
          </ThemeBridge>
        </StartupBridge>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
