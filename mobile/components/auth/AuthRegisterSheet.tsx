import { useEffect, useMemo } from "react";
import { InteractionManager, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import type { OAuthProvider } from "@/types/auth";
import { radius, spacing, touchTarget, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

type AuthRegisterSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onContinueWithProvider: (provider: OAuthProvider) => void;
  configuredProviders?: OAuthProvider[];
  socialLoadingProvider?: OAuthProvider | null;
};

export function AuthRegisterSheet({
  visible,
  onClose,
  onSignIn,
  onContinueWithProvider,
  configuredProviders = ["google"],
  socialLoadingProvider = null,
}: AuthRegisterSheetProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(56);
  const opacity = useSharedValue(0);

  const loadingProvider = socialLoadingProvider;
  const providers = configuredProviders;
  const socialBusy = loadingProvider != null;

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
      translateY.value = withTiming(0, { duration: 360, easing: Easing.out(Easing.cubic) });
    } else {
      opacity.value = 0;
      translateY.value = 56;
    }
  }, [opacity, translateY, visible]);

  const backdropAnim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetAnim = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropAnim]}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
          ) : null}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel={t("common.cancel")}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm },
            sheetAnim,
          ]}
        >
          <View style={styles.handle} accessibilityElementsHidden />
          <Text style={styles.title}>{t("auth.createAccountTitle")}</Text>
          <Text style={styles.subtitle}>{t("auth.createAccountSubtitle")}</Text>

          <View style={styles.actions}>
            <SocialAuthButtons
              providers={providers}
              loadingProvider={loadingProvider}
              disabled={socialBusy}
              variant="surface"
              onPressProvider={onContinueWithProvider}
            />
            <Button
              label={t("auth.continueWithEmail")}
              variant="outline"
              disabled={socialBusy}
              onPress={() => {
                hapticLight();
                onClose();
                InteractionManager.runAfterInteractions(() => {
                  router.push("/(auth)/register");
                });
              }}
            />
            <Button
              label={t("auth.haveInviteCta")}
              variant="ghost"
              disabled={socialBusy}
              onPress={() => {
                hapticLight();
                onClose();
                InteractionManager.runAfterInteractions(() => {
                  router.push("/(auth)/join");
                });
              }}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              hapticLight();
              onClose();
              onSignIn();
            }}
            style={({ pressed }) => [styles.signInRow, pressed ? styles.pressed : null]}
          >
            <Text style={styles.signInPrompt}>{t("auth.alreadyHaveAccount")} </Text>
            <Text style={styles.signInLink}>{t("auth.signInLink")}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing["2xl"],
      paddingTop: spacing.md,
      gap: spacing.lg,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: -8 },
        },
        android: { elevation: 16 },
        default: {},
      }),
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.sm,
    },
    title: {
      ...typography.h1,
      fontSize: 24,
      color: colors.foreground,
      letterSpacing: -0.4,
    },
    subtitle: {
      ...typography.body,
      color: colors.mutedForeground,
      lineHeight: 22,
      marginTop: -spacing.sm,
      fontWeight: "500",
    },
    actions: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    signInRow: {
      minHeight: touchTarget,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.sm,
    },
    signInPrompt: {
      ...typography.body,
      color: colors.mutedForeground,
      fontWeight: "500",
    },
    signInLink: {
      ...typography.body,
      color: authBrand.orange,
      fontWeight: "700",
    },
    pressed: { opacity: 0.78 },
  });
}
