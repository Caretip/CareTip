import { create } from "zustand";
import type { NormalizedApiError } from "@/types/api";

type UiState = {
  isOnline: boolean;
  globalError: NormalizedApiError | null;
  setOnline: (isOnline: boolean) => void;
  setGlobalError: (error: NormalizedApiError | null) => void;
  clearGlobalError: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  isOnline: true,
  globalError: null,
  setOnline: (isOnline) => set({ isOnline }),
  setGlobalError: (globalError) => set({ globalError }),
  clearGlobalError: () => set({ globalError: null }),
}));
