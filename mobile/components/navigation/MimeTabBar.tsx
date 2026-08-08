import { memo, useMemo } from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shadows, spacing, typography } from "@/theme";
import { TAB_BAR_HEIGHT } from "@/theme/navigation";
import { useTheme } from "@/hooks/useTheme";
import { hapticSelection } from "@/utils/haptics";

/**
 * Bottom tab bar — solid white (theme) surface with a full-width top rule
 * and soft upward shadow so it stays visually independent from dashboard content.
 */
export const MimeTabBar = memo(function MimeTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? spacing.xs : spacing.sm);

  const homeRoute = state.routes.find((route) => route.name === "index");
  const menuRoute = state.routes.find((route) => route.name === "menu");

  function renderTab(route: (typeof state.routes)[number] | undefined) {
    if (!route) return <View style={styles.tabSlot} />;

    const index = state.routes.findIndex((r) => r.key === route.key);
    const descriptor = descriptors[route.key];
    if (!descriptor) return <View style={styles.tabSlot} />;

    const { options } = descriptor;
    const label =
      options.tabBarLabel !== undefined
        ? String(options.tabBarLabel)
        : options.title !== undefined
          ? String(options.title)
          : route.name;
    const isFocused = state.index === index;
    const iconColor = isFocused ? colors.primary : colors.mutedForeground;

    const onPress = () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        hapticSelection();
        navigation.navigate(route.name, route.params);
      }
    };

    const icon = options.tabBarIcon?.({
      focused: isFocused,
      color: iconColor,
      size: isFocused ? 22 : 21,
    });

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        onPress={onPress}
        style={({ pressed }) => [styles.tabSlot, styles.tab, pressed ? styles.tabPressed : null]}
      >
        {icon}
        <Text style={[styles.label, isFocused ? styles.labelActive : null]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: bottomInset }]}>
      {renderTab(homeRoute)}
      {renderTab(menuRoute)}
    </View>
  );
});

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
      flexDirection: "row",
      alignItems: "center",
      minHeight: TAB_BAR_HEIGHT,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      backgroundColor: colors.tabBar,
      // Full-width 1px rule — hairline is too weak on many Android densities.
      borderTopWidth: 1,
      borderTopColor: colors.tabBarBorder,
      ...shadows.tabBar,
    },
    tabSlot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    tab: {
      minHeight: TAB_BAR_HEIGHT - 8,
      gap: 2,
      paddingVertical: spacing.xs,
    },
    tabPressed: {
      opacity: 0.85,
    },
    label: {
      ...typography.caption,
      fontSize: 10,
      fontWeight: "500",
      color: colors.mutedForeground,
      letterSpacing: 0.1,
    },
    labelActive: {
      color: colors.primary,
      fontWeight: "600",
    },
  });
}
