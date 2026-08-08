import { memo, useMemo } from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, typography } from "@/theme";
import { TAB_BAR_HEIGHT } from "@/theme/navigation";
import { useTheme } from "@/hooks/useTheme";
import { hapticSelection } from "@/utils/haptics";

type MimeTabBarProps = BottomTabBarProps & {
  /** Ordered route names to show; defaults to every route without `href: null`. */
  primaryRoutes?: readonly string[];
};

function isHiddenByHref(options: { href?: string | null } | undefined): boolean {
  return options?.href === null;
}

/**
 * Fixed full-width bottom tab bar — solid surface + 1px top rule.
 * Renders only primary destinations; secondary routes stay in More.
 */
export const MimeTabBar = memo(function MimeTabBar({
  state,
  descriptors,
  navigation,
  primaryRoutes,
}: MimeTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? spacing.xs : spacing.sm);

  const routes = useMemo(() => {
    if (primaryRoutes && primaryRoutes.length > 0) {
      return primaryRoutes
        .map((name) => state.routes.find((route) => route.name === name))
        .filter((route): route is (typeof state.routes)[number] => Boolean(route));
    }
    return state.routes.filter((route) => {
      const descriptor = descriptors[route.key];
      return !isHiddenByHref(descriptor?.options as { href?: string | null } | undefined);
    });
  }, [descriptors, primaryRoutes, state.routes]);

  function renderTab(route: (typeof state.routes)[number]) {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const descriptor = descriptors[route.key];
    if (!descriptor) return null;

    const { options } = descriptor;
    const label =
      options.tabBarLabel !== undefined
        ? String(options.tabBarLabel)
        : options.title !== undefined
          ? String(options.title)
          : route.name;
    const isFocused = state.index === index;
    const iconColor = isFocused ? colors.primary : colors.mutedForeground;
    const badge =
      typeof options.tabBarBadge === "number"
        ? options.tabBarBadge
        : typeof options.tabBarBadge === "string"
          ? Number(options.tabBarBadge)
          : undefined;

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
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        onPress={onPress}
        style={({ pressed }) => [styles.tabSlot, styles.tab, pressed ? styles.tabPressed : null]}
      >
        <View style={styles.iconWrap}>
          {icon}
          {badge != null && Number.isFinite(badge) && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 9 ? "9+" : String(badge)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.label, isFocused ? styles.labelActive : null]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: bottomInset }]}>
      {routes.map((route) => renderTab(route))}
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
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      backgroundColor: colors.tabBar,
      borderTopWidth: 1,
      borderTopColor: colors.tabBarBorder,
      // Reference: crisp rule only — avoid heavy elevation that looks unfinished.
    },
    tabSlot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 0,
    },
    tab: {
      minHeight: TAB_BAR_HEIGHT - 8,
      gap: 2,
      paddingVertical: spacing.xs,
      paddingHorizontal: 2,
    },
    tabPressed: {
      opacity: 0.85,
    },
    iconWrap: {
      position: "relative",
      alignItems: "center",
      justifyContent: "center",
    },
    badge: {
      position: "absolute",
      top: -4,
      right: -10,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      borderWidth: 1.5,
      borderColor: colors.tabBar,
    },
    badgeText: {
      color: colors.primaryForeground,
      fontSize: 9,
      fontWeight: "700",
      lineHeight: 11,
    },
    label: {
      ...typography.caption,
      fontSize: 10,
      fontWeight: "500",
      color: colors.mutedForeground,
      letterSpacing: 0.1,
      textAlign: "center",
    },
    labelActive: {
      color: colors.primary,
      fontWeight: "600",
    },
  });
}
