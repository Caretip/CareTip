import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({ eyebrow, title, subtitle, trailing, style }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.text}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
};

export function SectionHeader({ title, subtitle, trailing }: SectionHeaderProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.section}>
      <View style={styles.text}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

type HeroCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  glass?: boolean;
};

export function HeroCard({ children, style }: HeroCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.hero, style]}>{children}</View>;
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.lg,
    },
    text: {
      flex: 1,
      gap: spacing.xs,
    },
    eyebrow: {
      ...typography.overline,
      color: colors.primary,
    },
    title: {
      ...typography.h1,
      color: colors.foreground,
    },
    subtitle: {
      ...typography.smallBody,
      color: colors.mutedForeground,
    },
    section: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    sectionTitle: {
      ...typography.h2,
      color: colors.foreground,
      fontWeight: "700",
    },
    sectionSub: {
      ...typography.caption,
      color: colors.mutedForeground,
      marginTop: spacing.xxs,
    },
    hero: {
      gap: spacing.xl,
      paddingBottom: spacing.sm,
      marginBottom: spacing.md,
    },
  });
}
