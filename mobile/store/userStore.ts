import { create } from "zustand";
import type { AuthUser } from "@/types/auth";

type UserState = {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  clear: () => void;
};

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
