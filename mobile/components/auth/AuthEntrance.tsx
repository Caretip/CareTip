import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

type AuthEntranceProps = {
  children: ReactNode;
  /** Stagger index — kept for call-site compatibility. */
  index?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Login form grouping. Entrance fade was removed so the destination is
 * already painted when the splash overlay peels (no empty-card flash).
 */
export function AuthEntrance({ children, style }: AuthEntranceProps) {
  return (
    <View style={style} collapsable={false}>
      {children}
    </View>
  );
}
