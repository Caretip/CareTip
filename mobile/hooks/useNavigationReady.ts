import { useRootNavigationState } from "expo-router";

/** True once the Expo Router navigation container has mounted. */
export function useNavigationReady(): boolean {
  const state = useRootNavigationState();
  return Boolean(state?.key);
}
