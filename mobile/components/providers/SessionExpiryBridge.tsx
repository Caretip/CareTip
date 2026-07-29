import { useEffect } from "react";
import { useRouter } from "expo-router";
import { registerSessionExpiredHandler } from "@/utils/sessionExpiry";
import { sessionManager } from "@/services/auth/sessionManager";

export function SessionExpiryBridge() {
  const router = useRouter();

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      void sessionManager.signOut().then(() => {
        router.replace("/(auth)/login");
      });
    });
    return () => registerSessionExpiredHandler(null);
  }, [router]);

  return null;
}
