import { useEffect, useState } from "react";
import { subscribeNetwork, isOnline } from "@/utils/network";
import { useUiStore } from "@/store/uiStore";

export function useNetworkStatus() {
  const setOnline = useUiStore((s) => s.setOnline);
  const isOnlineStore = useUiStore((s) => s.isOnline);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void isOnline().then((online) => {
      if (!mounted) return;
      setOnline(online);
      setReady(true);
    });
    const unsubscribe = subscribeNetwork((online) => {
      setOnline(online);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [setOnline]);

  return { isOnline: isOnlineStore, ready };
}
