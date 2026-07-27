import { onlineManager } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { subscribeNetwork, isOnline } from "@/utils/network";

/**
 * Wire React Query to NetInfo so `refetchOnReconnect` works on React Native.
 * Call once at app bootstrap (AppProviders).
 */
export function bindReactQueryOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    void isOnline().then(setOnline);
    return subscribeNetwork(setOnline);
  });

  // Initial sync (event listener may not fire until first change).
  void NetInfo.fetch().then((state) => {
    onlineManager.setOnline(state.isConnected !== false);
  });
}
