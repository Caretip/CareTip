import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

function canHaptic(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

/** Light tap — tabs, list rows, secondary buttons. */
export function hapticLight(): void {
  if (!canHaptic()) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** Selection change — toggles, filters, period chips. */
export function hapticSelection(): void {
  if (!canHaptic()) return;
  void Haptics.selectionAsync().catch(() => undefined);
}

/** Success — toast, password saved, mark-all-read. */
export function hapticSuccess(): void {
  if (!canHaptic()) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** Warning / destructive confirm. */
export function hapticWarning(): void {
  if (!canHaptic()) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
