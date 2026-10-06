import { createContext } from "react";

export type BusinessGuidelinesContextValue = {
  openGuidelines: () => void;
  closeGuidelines: () => void;
};

/** Single context instance — import this module only; avoids duplicate createContext across Vite chunks/HMR. */
export const BusinessGuidelinesReactContext =
  createContext<BusinessGuidelinesContextValue | null>(null);
