import { memo, useMemo } from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, touchTarget, typography } from "@/theme";
import { TAB_BAR_HEIGHT } from "@/theme/navigation";
import { floatingTabShadow } from "@/theme/layered";
import { useTheme } from "@/hooks/useTheme";
import { hapticSelection } from "@/utils/haptics";

/** Floating bottom bar — Home (left), Menu (right). */
export const MimeTabBar = memo(function MimeTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? spacing.sm : spacing.md);

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
      size: isFocused ? 26 : 24,
    });

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        onPress={onPress}
        style={({ pressed }) => [styles.tabSlot, styles.tab, pressed ? styles.tabPressed : null]}
      >
        <View style={[styles.iconSlot, isFocused ? styles.iconSlotActive : null]}>{icon}</View>
        <Text style={[styles.label, isFocused ? styles.labelActive : null]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.outer, { paddingBottom: bottomInset }]}>
      <View style={[styles.bar, floatingTabShadow]}>
        {renderTab(homeRoute)}
        {renderTab(menuRoute)}
      </View>
    </View>
  );
});

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    outer: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing["2xl"],
      backgroundColor: "transparent",
    },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: TAB_BAR_HEIGHT,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.tabBar,
      borderRadius: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.tabBarBorder,
    },
    tabSlot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    tab: {
      minWidth: touchTarget,
      minHeight: touchTarget,
      gap: spacing.xxs,
    },
    tabPressed: {
      opacity: 0.82,
    },
    iconSlot: {
      alignItems: "center",
      justifyContent: "center",
      width: 40,
      height: 32,
    },
    iconSlotActive: {
      transform: [{ scale: 1.04 }],
    },
    label: {
      ...typography.caption,
      fontSize: 11,
      fontWeight: "500",
      color: colors.mutedForeground,
      letterSpacing: 0.2,
    },
    labelActive: {
      color: colors.primary,
      fontWeight: "700",
    },
  });
}
