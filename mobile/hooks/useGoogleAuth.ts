import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { isGoogleSignInConfigured, isGoogleSignInNativeAvailable, mapGoogleNativeError, requestGoogleIdToken } from "@/services/google/googleSignIn";
import { showErrorToast } from "@/store/toastStore";
import type { UserRole } from "@/types/auth";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { resolveOAuthErrorMessage, isGoogleAccountNotRegistered } from "@/utils/oauthErrorMessage";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";

function resolveTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

type GoogleAuthMode = {
  isLogin: boolean;
  intendedRole?: UserRole;
  name?: string;
};

type UseGoogleAuthOptions = {
  onAccountNotRegistered?: () => void;
};

export function useGoogleAuth(options?: UseGoogleAuthOptions) {
  const router = useRouter();
  const { t } = useI18n();
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);

  const runGoogleAuth = useCallback(
    async (mode: GoogleAuthMode) => {
      if (!isGoogleSignInConfigured()) {
        showErrorToast(t("auth.googleNotConfigured"));
        return;
      }

      setLoading(true);
      try {
        const idToken = await requestGoogleIdToken();
        const result = await signInWithGoogle({
          idToken,
          isLogin: mode.isLogin,
          intendedRole: mode.intendedRole,
          name: mode.name,
          locale: resolveLoginLocale(),
          timeZone: resolveTimeZone(),
        });

        if (isMfaChallenge(result)) {
          router.push({
            pathname: "/(auth)/mfa",
            params: {
              pendingMfaToken: result.pendingMfaToken,
              mfaSetupRequired: result.mfaSetupRequired ? "1" : "0",
            },
          });
          return;
        }

        await navigateAfterAuth(router, result.user);
      } catch (error) {
        const mapped = normalizeApiError(mapGoogleNativeError(error));
        if (isGoogleAccountNotRegistered(mapped)) {
          options?.onAccountNotRegistered?.();
        }
        showErrorToast(resolveOAuthErrorMessage(mapped, t));
      } finally {
        setLoading(false);
      }
    },
    [options, router, signInWithGoogle, t],
  );

  return {
    runGoogleAuth,
    googleLoading: loading,
    googleConfigured: isGoogleSignInConfigured() && isGoogleSignInNativeAvailable(),
  };
}
