import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type SectionProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Soft elevated surface — use sparingly (charts, primary focus). */
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section grouping via typography + spacing (not a card by default).
 */
export function Section({ title, subtitle, children, highlighted = false, style }: SectionProps) {
  return (
    <View style={[styles.section, highlighted ? styles.highlighted : null, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

type DividerProps = {
  inset?: boolean;
};

export function Divider({ inset = false }: DividerProps) {
  return <View style={[styles.divider, inset ? styles.dividerInset : null]} />;
}

type GroupedListProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Single surface for related settings/rows with internal dividers.
 */
export function GroupedList({ children, style }: GroupedListProps) {
  return <View style={[styles.group, style]}>{children}</View>;
}

type GroupedRowProps = {
  children: React.ReactNode;
  showDivider?: boolean;
};

export function GroupedRow({ children, showDivider = true }: GroupedRowProps) {
  return (
    <View>
      <View style={styles.groupRow}>{children}</View>
      {showDivider ? <Divider inset /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    marginBottom: spacing["2xl"],
  },
  highlighted: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
    ...shadows.xs,
  },
  title: {
    ...typography.section,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginBottom: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    width: "100%",
    marginBottom: spacing["2xl"],
  },
  dividerInset: {
    marginLeft: spacing.xl,
    marginBottom: 0,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  groupRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: 52,
    justifyContent: "center",
  },
});
