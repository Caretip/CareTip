import { Platform, type ViewStyle } from "react-native";

/** Softer elevation — Apple / Stripe depth without harsh glow. */
export const shadows = {
  none: {} as ViewStyle,
  xs: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 1 },
    },
    android: { elevation: 1 },
    default: {},
  })!,
  sm: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
    },
    android: { elevation: 2 },
    default: {},
  })!,
  md: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.07,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 4 },
    default: {},
  })!,
  lg: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.09,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
    },
    android: { elevation: 8 },
    default: {},
  })!,
  search: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {},
  })!,
  tabBar: Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B1220",
      shadowOpacity: 0.1,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 12 },
    default: {},
  })!,
} as const;
