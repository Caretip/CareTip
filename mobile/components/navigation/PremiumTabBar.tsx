import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadows, spacing, touchTarget, typography } from "@/theme";
import { TAB_BAR_HEIGHT } from "@/theme/navigation";

export function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? spacing.sm : spacing.md);

  return (
    <View style={[styles.outer, { paddingBottom: bottomInset }]} pointerEvents="box-none">
      <View style={styles.floatingSurface}>
        {state.routes.map((route, index) => {
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

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          const icon = options.tabBarIcon?.({
            focused: isFocused,
            color: iconColor,
            size: 22,
          });

          const badge = options.tabBarBadge;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.tab, pressed ? styles.tabPressed : null]}
            >
              <View style={[styles.iconWrap, isFocused ? styles.iconWrapActive : null]}>
                {icon}
                {badge != null && badge !== 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, isFocused ? styles.labelActive : null]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
  },
  floatingSurface: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TAB_BAR_HEIGHT,
    borderRadius: radius["2xl"],
    backgroundColor: colors.tabBar,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.tabBarBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.tabBar,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingVertical: spacing.xs,
    gap: 4,
  },
  tabPressed: {
    opacity: 0.75,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 32,
    borderRadius: radius.lg,
  },
  iconWrapActive: {
    backgroundColor: colors.primarySoft,
  },
  label: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: "500",
    color: colors.mutedForeground,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: colors.foreground,
    fontWeight: "700",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.tabBar,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.primaryForeground,
    lineHeight: 12,
  },
});
