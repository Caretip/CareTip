import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/ui/Screen";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { hitSlop, spacing, touchTarget, typography } from "@/theme";

type InfoScreenShellProps = {
  title: string;
  children: React.ReactNode;
  /** When false, body is a flex container (for WebView / nested scroll). */
  scroll?: boolean;
  /** Enable KeyboardAvoidingView for search / form inputs inside the shell. */
  keyboardAware?: boolean;
};

export function InfoScreenShell({
  title,
  children,
  scroll = true,
  keyboardAware = false,
}: InfoScreenShellProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/login"))}
          style={styles.back}
          hitSlop={hitSlop.sm}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backSpacer} />
      </View>
      {scroll ? (
        <Screen
          padded
          tabSafe={false}
          keyboardAware={keyboardAware}
          safeAreaEdges={["left", "right"]}
          contentContainerStyle={styles.content}
        >
          {children}
        </Screen>
      ) : (
        <View style={[styles.embeddedBody, styles.content]}>{children}</View>
      )}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    back: {
      width: touchTarget,
      height: touchTarget,
      alignItems: "center",
      justifyContent: "center",
    },
    backSpacer: {
      width: touchTarget,
    },
    title: {
      ...typography.h2,
      color: colors.foreground,
      flex: 1,
      textAlign: "center",
    },
    content: {
      gap: spacing.lg,
      paddingTop: spacing.lg,
    },
    embeddedBody: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
    },
  });
}
