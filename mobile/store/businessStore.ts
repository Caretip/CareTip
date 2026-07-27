import { create } from "zustand";
import type { BusinessProfile } from "@/types/user";

type BusinessState = {
  profile: BusinessProfile | null;
  isLoading: boolean;
  setProfile: (profile: BusinessProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
  clear: () => void;
};

export const useBusinessStore = create<BusinessState>((set) => ({
  profile: null,
  isLoading: false,
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ profile: null, isLoading: false }),
}));
