import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type CardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  glass?: boolean;
  padded?: boolean;
};

export function Card({
  children,
  style,
  elevated = true,
  glass = false,
  padded = true,
}: CardProps) {
  return (
    <View
      style={[
        styles.card,
        elevated ? shadows.md : shadows.xs,
        glass ? styles.glass : null,
        padded ? styles.padded : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

type CardHeaderProps = {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
};

export function CardHeader({ title, subtitle, trailing }: CardHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.lg,
    overflow: "hidden",
  },
  padded: {
    padding: spacing["2xl"],
  },
  glass: {
    backgroundColor: colors.cardGlass,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
});
