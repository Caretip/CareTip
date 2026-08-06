import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import {
  isAppleSignInAvailable,
  isAppleSignInConfigured,
  mapAppleNativeError,
  requestAppleIdToken,
} from "@/services/apple/appleSignIn";
import {
  isFacebookSignInConfigured,
  mapFacebookNativeError,
  requestFacebookIdToken,
} from "@/services/facebook/facebookSignIn";
import {
  isGoogleSignInConfigured,
  isGoogleSignInNativeAvailable,
  mapGoogleNativeError,
  requestGoogleIdToken,
} from "@/services/google/googleSignIn";
import { showErrorToast } from "@/store/toastStore";
import type { OAuthProvider, UserRole } from "@/types/auth";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import {
  resolveOAuthErrorMessage,
  isOAuthAccountNotRegistered,
} from "@/utils/oauthErrorMessage";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";

function resolveTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

type SocialAuthMode = {
  isLogin: boolean;
  intendedRole?: UserRole;
  name?: string;
  inviteCode?: string;
};

type UseSocialAuthOptions = {
  onAccountNotRegistered?: () => void;
};

/** Platform button order: iOS Apple → Google → Facebook; Android Google → Facebook → Apple. */
export function socialProvidersForPlatform(): OAuthProvider[] {
  if (Platform.OS === "ios") {
    return ["apple", "google", "facebook"];
  }
  return ["google", "facebook", "apple"];
}

export function useSocialAuth(options?: UseSocialAuthOptions) {
  const router = useRouter();
  const { t } = useI18n();
  const { signInWithOAuth } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await isAppleSignInAvailable();
      if (!cancelled) setAppleAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const googleConfigured = isGoogleSignInConfigured() && isGoogleSignInNativeAvailable();
  const appleConfigured = isAppleSignInConfigured() && appleAvailable;
  const facebookConfigured = isFacebookSignInConfigured();

  /** Always show platform-order icons for UI parity; runSocialAuth gates unconfigured providers. */
  const configuredProviders = useMemo(() => socialProvidersForPlatform(), []);

  const anySocialConfigured = googleConfigured || appleConfigured || facebookConfigured;
  const socialBusy = loadingProvider != null;

  const runSocialAuth = useCallback(
    async (provider: OAuthProvider, mode: SocialAuthMode) => {
      if (provider === "google" && !googleConfigured) {
        showErrorToast(t("auth.googleNotConfigured"));
        return;
      }
      if (provider === "apple" && !appleConfigured) {
        showErrorToast(t("auth.appleNotConfigured"));
        return;
      }
      if (provider === "facebook" && !facebookConfigured) {
        showErrorToast(t("auth.facebookNotConfigured"));
        return;
      }

      setLoadingProvider(provider);
      try {
        let idToken: string;
        let name = mode.name;

        if (provider === "google") {
          idToken = await requestGoogleIdToken();
        } else if (provider === "apple") {
          const apple = await requestAppleIdToken();
          idToken = apple.idToken;
          if (!name && apple.fullName) name = apple.fullName;
        } else {
          idToken = await requestFacebookIdToken();
        }

        const result = await signInWithOAuth({
          provider,
          idToken,
          isLogin: mode.isLogin,
          intendedRole: mode.intendedRole,
          name,
          inviteCode: mode.inviteCode,
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
        const mapped =
          provider === "google"
            ? normalizeApiError(mapGoogleNativeError(error))
            : provider === "apple"
              ? normalizeApiError(mapAppleNativeError(error))
              : normalizeApiError(mapFacebookNativeError(error));

        if (isOAuthAccountNotRegistered(mapped)) {
          options?.onAccountNotRegistered?.();
        }
        showErrorToast(resolveOAuthErrorMessage(mapped, t, provider));
      } finally {
        setLoadingProvider(null);
      }
    },
    [
      appleConfigured,
      facebookConfigured,
      googleConfigured,
      options,
      router,
      signInWithOAuth,
      t,
    ],
  );

  /** @deprecated Prefer runSocialAuth("google", …) */
  const runGoogleAuth = useCallback(
    (mode: SocialAuthMode) => runSocialAuth("google", mode),
    [runSocialAuth],
  );

  return {
    runSocialAuth,
    runGoogleAuth,
    loadingProvider,
    socialBusy,
    anySocialConfigured,
    configuredProviders,
    googleConfigured,
    appleConfigured,
    facebookConfigured,
    googleLoading: loadingProvider === "google",
  };
}

/** Backward-compatible Google-only wrapper. */
export function useGoogleAuth(options?: UseSocialAuthOptions) {
  const social = useSocialAuth(options);
  return {
    runGoogleAuth: social.runGoogleAuth,
    googleLoading: social.googleLoading,
    googleConfigured: social.googleConfigured,
  };
}
