import { Platform, type ViewStyle } from "react-native";

/** Soft fintech elevation — Wise / Revolut depth without heavy glow. */
export const shadows = {
  none: {} as ViewStyle,
  xs: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.03,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    android: { elevation: 1 },
    default: {},
  })!,
  sm: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  })!,
  md: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 3 },
    default: {},
  })!,
  lg: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.08,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 6 },
    default: {},
  })!,
  search: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {},
  })!,
  /** Bottom tab chrome — soft lift under content (shadow casts upward). */
  tabBar: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#111827",
      shadowOpacity: 0.07,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
    },
    android: { elevation: 6 },
    default: {},
  })!,
} as const;
