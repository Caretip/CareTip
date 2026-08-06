import { authService } from "@/services/auth/authService";
import { establishAuthenticatedSession } from "@/services/auth/authCacheBoundary";
import { verifyMfaLogin } from "@/services/auth/mfaService";
import { sessionManager } from "@/services/auth/sessionManager";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import type { AuthResponse, OAuthRequest, SignInRequest, SignInResult } from "@/types/auth";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";

type CompleteMfaInput = {
  pendingMfaToken: string;
  code: string;
  mfaSetupRequired: boolean;
};

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const user = useUserStore((s) => s.user);

  const isAuthenticated = status === "authenticated" && Boolean(accessToken);

  async function signIn(payload: SignInRequest): Promise<SignInResult> {
    try {
      const result = await authService.login(payload);
      if (!isMfaChallenge(result)) {
        await establishAuthenticatedSession(result.token, result.user, "password-login");
      }
      return result;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async function completeMfaSignIn(input: CompleteMfaInput): Promise<AuthResponse> {
    try {
      const result = await verifyMfaLogin(input.pendingMfaToken, input.code, input.mfaSetupRequired);
      await establishAuthenticatedSession(result.token, result.user, "mfa-complete");
      return result;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async function signInWithOAuth(payload: OAuthRequest): Promise<SignInResult> {
    try {
      const result = await authService.oauthLogin(payload);
      if (!isMfaChallenge(result)) {
        await establishAuthenticatedSession(result.token, result.user, "oauth-login");
      }
      return result;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  /** @deprecated Prefer signInWithOAuth — kept for Google call-site compatibility. */
  async function signInWithGoogle(payload: OAuthRequest): Promise<SignInResult> {
    return signInWithOAuth({ ...payload, provider: payload.provider ?? "google" });
  }

  async function signOut(): Promise<void> {
    await sessionManager.signOut();
  }

  return {
    status,
    user,
    accessToken,
    isHydrated,
    isAuthenticated,
    signIn,
    signInWithOAuth,
    signInWithGoogle,
    completeMfaSignIn,
    signOut,
    bootstrap: sessionManager.bootstrapSession,
    retryBootstrap: sessionManager.retryBootstrapSession,
  };
}
