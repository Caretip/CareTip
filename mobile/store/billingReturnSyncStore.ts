import { create } from "zustand";

type BillingReturnSyncState = {
  active: boolean;
  message: string | null;
  begin: (message: string) => void;
  end: () => void;
};

/** Lightweight overlay while post-browser subscription sync runs. */
export const useBillingReturnSyncStore = create<BillingReturnSyncState>((set) => ({
  active: false,
  message: null,
  begin: (message) => set({ active: true, message }),
  end: () => set({ active: false, message: null }),
}));
