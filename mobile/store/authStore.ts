import { create } from "zustand";
import type { AuthSessionStatus } from "@/types/auth";

type AuthState = {
  status: AuthSessionStatus;
  accessToken: string | null;
  isHydrated: boolean;
  setStatus: (status: AuthSessionStatus) => void;
  setAuthenticated: (token: string) => void;
  setUnauthenticated: () => void;
  /** Offline / timeout with secrets retained for retry — never mounts authenticated shell. */
  setSessionRecovery: () => void;
  setHydrated: (value: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "idle",
  accessToken: null,
  isHydrated: false,
  setStatus: (status) => set({ status }),
  setAuthenticated: (token) =>
    set({
      status: "authenticated",
      accessToken: token,
      isHydrated: true,
    }),
  setUnauthenticated: () =>
    set({
      status: "unauthenticated",
      accessToken: null,
      isHydrated: true,
    }),
  setSessionRecovery: () =>
    set({
      status: "session_recovery",
      accessToken: null,
      isHydrated: true,
    }),
  setHydrated: (isHydrated) => set({ isHydrated }),
}));
