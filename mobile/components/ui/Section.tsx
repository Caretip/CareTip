import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, spacing, surface, typography } from "@/theme";

type SectionProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Elevated white card — charts and focus blocks. */
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
};

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
    borderRadius: surface.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    ...typography.overline,
    color: colors.mutedForeground,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
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
  },
  groupRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: 52,
    justifyContent: "center",
  },
});
