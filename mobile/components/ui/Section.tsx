import { useMemo } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { spacing, surface, typography } from "@/theme";

type SectionProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Section({ title, subtitle, children, highlighted = false, style }: SectionProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.section, highlighted ? styles.highlighted : null, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

type DividerProps = {
  inset?: boolean;
};

export function Divider({ inset = false }: DividerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.divider, inset ? styles.dividerInset : null]} />;
}

type GroupedListProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function GroupedList({ children, style }: GroupedListProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.group, style]}>{children}</View>;
}

type GroupedRowProps = {
  children: React.ReactNode;
  showDivider?: boolean;
};

export function GroupedRow({ children, showDivider = true }: GroupedRowProps) {
  return (
    <View>
      <GroupedRowContent>{children}</GroupedRowContent>
      {showDivider ? <Divider inset /> : null}
    </View>
  );
}

function GroupedRowContent({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.groupRow}>{children}</View>;
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    section: {
      gap: spacing.lg,
      marginBottom: spacing["3xl"],
    },
    content: {
      gap: spacing.lg,
    },
    highlighted: {
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.xl,
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    title: {
      ...typography.section,
      color: colors.foreground,
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: -0.2,
      lineHeight: 22,
    },
    subtitle: {
      ...typography.body,
      color: colors.mutedForeground,
      fontSize: 14,
      lineHeight: 20,
      marginTop: -spacing.sm,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      width: "100%",
    },
    dividerInset: {
      marginLeft: spacing.xl,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: surface.groupRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    groupRow: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      minHeight: 56,
      justifyContent: "center",
    },
  });
}
