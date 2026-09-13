import { useCallback } from "react";
import { confirmSignOut } from "@/features/settings/settingsMenuConfig";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";

export function useSignOutAction() {
  const { t } = useI18n();
  const { signOut } = useAuth();

  return useCallback(() => {
    confirmSignOut(t, () => {
      void signOut();
    });
  }, [signOut, t]);
}
