import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/ui/Screen";
import { colors, spacing, touchTarget, typography } from "@/theme";

type InfoScreenShellProps = {
  title: string;
  children: React.ReactNode;
};

export function InfoScreenShell({ title, children }: InfoScreenShellProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/login"))}
          style={styles.back}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backSpacer} />
      </View>
      <Screen padded contentContainerStyle={styles.content}>
        {children}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
