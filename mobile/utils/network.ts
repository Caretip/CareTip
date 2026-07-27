import NetInfo from "@react-native-community/netinfo";

/**
 * LAN/dev APIs often report isInternetReachable=false (no public internet probe)
 * even when the phone can reach the CareTip backend on the local network.
 * Treat "connected" as online unless the OS explicitly says disconnected.
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  if (state.isConnected === false) return false;
  // null/unknown reachability → still try API calls (device may be on LAN only).
  return true;
}

export function subscribeNetwork(onChange: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected === false) {
      onChange(false);
      return;
    }
    onChange(true);
  });
}
