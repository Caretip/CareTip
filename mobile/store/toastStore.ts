import { create } from "zustand";

export type ToastTone = "success" | "error" | "info";

export type ToastPayload = {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type ToastState = {
  toast: ToastPayload | null;
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
  clearToast: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  showToast: (message, tone = "success", durationMs = 2800) =>
    set({
      toast: {
        id: `${Date.now()}`,
        message,
        tone,
        durationMs,
      },
    }),
  clearToast: () => set({ toast: null }),
}));

export function showSuccessToast(message: string): void {
  useToastStore.getState().showToast(message, "success");
}

export function showErrorToast(message: string): void {
  useToastStore.getState().showToast(message, "error");
}

export function showInfoToast(message: string, durationMs = 3600): void {
  useToastStore.getState().showToast(message, "info", durationMs);
}
