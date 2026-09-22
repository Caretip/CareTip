import { create } from "zustand";

type BillingWebInfoState = {
  visible: boolean;
  open: () => void;
  close: () => void;
};

/** Controls the manage-subscription-on-web informational modal. */
export const useBillingWebInfoStore = create<BillingWebInfoState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
