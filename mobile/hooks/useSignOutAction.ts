import { useCallback } from "react";
import { useRouter } from "expo-router";
import { confirmSignOut } from "@/features/settings/settingsMenuConfig";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { hapticWarning } from "@/utils/haptics";

export function useSignOutAction() {
  const router = useRouter();
  const { t } = useI18n();
  const { signOut } = useAuth();

  return useCallback(() => {
    hapticWarning();
    confirmSignOut(t, () => {
      void (async () => {
        await signOut();
        router.replace("/(auth)/login");
      })();
    });
  }, [router, signOut, t]);
}
