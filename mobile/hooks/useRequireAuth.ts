import { useAuth } from "@/hooks/useAuth";

export function useRequireAuth() {
  const auth = useAuth();
  return {
    ...auth,
    isReady: auth.isHydrated && auth.status !== "bootstrapping" && auth.status !== "idle",
  };
}
