import { memo } from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSignOutAction } from "@/hooks/useSignOutAction";
import { useI18n } from "@/hooks/useI18n";
import { colors, spacing, touchTarget, typography } from "@/theme";
import { TAB_BAR_HEIGHT } from "@/theme/navigation";
import { hapticSelection } from "@/utils/haptics";

/** Bottom bar — Home (left), Log out (center), Menu (right). Inspired by template/mime. */
export const MimeTabBar = memo(function MimeTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const onSignOut = useSignOutAction();
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
    const iconColor = isFocused ? colors.primary : colors.foreground;

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
      size: 24,
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
    <View style={[styles.outer, { paddingBottom: bottomInset }]}>
      <View style={styles.bar}>
        {renderTab(homeRoute)}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tabs.logout")}
          onPress={onSignOut}
          style={({ pressed }) => [styles.tabSlot, styles.tab, styles.logoutTab, pressed ? styles.tabPressed : null]}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.destructive} />
          <Text style={[styles.label, styles.logoutLabel]} numberOfLines={1}>
            {t("tabs.logout")}
          </Text>
        </Pressable>

        {renderTab(menuRoute)}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TAB_BAR_HEIGHT,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  tabSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tab: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    gap: spacing.xs,
  },
  logoutTab: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tabPressed: {
    opacity: 0.75,
  },
  label: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: "500",
    color: colors.foreground,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  logoutLabel: {
    color: colors.destructive,
    fontWeight: "600",
  },
});
