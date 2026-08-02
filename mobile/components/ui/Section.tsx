import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { dashboardTextColors, premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";

type SectionProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Section({ title, subtitle, children, highlighted = false, style }: SectionProps) {
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(colors, text), [colors, text]);

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
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(colors, text), [colors, text]);
  return <View style={[styles.divider, inset ? styles.dividerInset : null]} />;
}

type GroupedListProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function GroupedList({ children, style }: GroupedListProps) {
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(colors, text), [colors, text]);
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
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(colors, text), [colors, text]);
  return <View style={styles.groupRow}>{children}</View>;
}

function createStyles(colors: ColorPalette, text: ReturnType<typeof dashboardTextColors>) {
  return StyleSheet.create({
    section: {
      gap: spacing.lg,
      marginBottom: spacing["2xl"],
    },
    content: {
      gap: spacing.md,
    },
    highlighted: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
      padding: spacing.lg,
    },
    title: {
      ...typography.section,
      color: text.primary,
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: -0.3,
      lineHeight: 22,
    },
    subtitle: {
      ...typography.body,
      color: text.secondary,
      fontSize: 14,
      lineHeight: 20,
      marginTop: -spacing.sm,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: premiumPalette.border,
      width: "100%",
    },
    dividerInset: {
      marginLeft: spacing.xl,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
      overflow: "hidden",
    },
    groupRow: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      minHeight: 56,
      justifyContent: "center",
    },
  });
}
