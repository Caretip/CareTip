import { create } from "zustand";
import type { EmployeeProfile } from "@/types/user";

type EmployeeState = {
  profile: EmployeeProfile | null;
  isLoading: boolean;
  setProfile: (profile: EmployeeProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
  clear: () => void;
};

export const useEmployeeStore = create<EmployeeState>((set) => ({
  profile: null,
  isLoading: false,
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ profile: null, isLoading: false }),
}));
