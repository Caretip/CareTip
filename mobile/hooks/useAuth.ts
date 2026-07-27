import { authService } from "@/services/auth/authService";
import { verifyMfaLogin } from "@/services/auth/mfaService";
import { sessionManager } from "@/services/auth/sessionManager";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import type { AuthResponse, SignInRequest, SignInResult } from "@/types/auth";
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
        useUserStore.getState().setUser(result.user);
        useAuthStore.getState().setAuthenticated(result.token);
      }
      return result;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async function completeMfaSignIn(input: CompleteMfaInput): Promise<AuthResponse> {
    try {
      const result = await verifyMfaLogin(input.pendingMfaToken, input.code, input.mfaSetupRequired);
      useUserStore.getState().setUser(result.user);
      useAuthStore.getState().setAuthenticated(result.token);
      return result;
    } catch (error) {
      throw normalizeApiError(error);
    }
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
    completeMfaSignIn,
    signOut,
    bootstrap: sessionManager.bootstrapSession,
  };
}
