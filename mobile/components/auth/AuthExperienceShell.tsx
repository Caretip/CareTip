import { useEffect, useState, type ReactNode } from "react";
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import hospitalityBackground from "@/assets/auth/hospitality-background.jpg";
import { BrandMarkWhite } from "@/components/brand/BrandMarkWhite";
import { AuthFooterSheet } from "@/components/auth/AuthFooterSheet";
import { authWebPaths } from "@/constants/authLinks";
import { useI18n } from "@/hooks/useI18n";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import { colors, motion, spacing, touchTarget, typography } from "@/theme";

type AuthExperienceShellProps = {
  children: ReactNode;
  /** Show register / invite secondary actions (login only). */
  showSecondaryActions?: boolean;
};

const TABLET_MIN_WIDTH = 768;

export function AuthExperienceShell({
  children,
  showSecondaryActions = true,
}: AuthExperienceShellProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const [footerOpen, setFooterOpen] = useState(false);

  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue<number>(motion.entrance.translateY);
  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue<number>(motion.entrance.translateY + 6);

  useEffect(() => {
    const easing = Easing.out(Easing.cubic);
    headerOpacity.value = withTiming(1, { duration: motion.entrance.fade, easing });
    headerY.value = withTiming(0, { duration: motion.entrance.fade, easing });
    cardOpacity.value = withTiming(1, { duration: motion.entrance.fade + 80, easing });
    cardY.value = withTiming(0, { duration: motion.entrance.fade + 80, easing });
  }, [cardOpacity, cardY, headerOpacity, headerY]);

  const headerAnim = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));

  const cardAnim = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={hospitalityBackground}
        style={styles.background}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      >
        <View style={styles.overlayTop} />
        <View style={styles.overlayBottom} />
        <View style={styles.tint} />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? spacing.lg : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, spacing.lg) + spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl,
              paddingHorizontal: isTablet ? spacing["4xl"] : spacing.xl,
            },
          ]}
        >
          <Animated.View style={[styles.brandBlock, headerAnim]}>
            <BrandMarkWhite height={isTablet ? 48 : 42} />
            <Text style={styles.brandName}>{t("auth.brandName")}</Text>
            <Text style={styles.tagline}>{t("auth.tagline")}</Text>
          </Animated.View>

          <Animated.View style={[styles.cardSlot, cardAnim]}>{children}</Animated.View>

          {showSecondaryActions ? (
            <View style={styles.secondaryRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void openCareTipWeb(authWebPaths.signup)}
                style={({ pressed }) => [styles.secondaryAction, pressed ? styles.pressed : null]}
              >
                <Text style={styles.secondaryLabel}>{t("auth.register")}</Text>
              </Pressable>
              <View style={styles.secondaryDivider} />
              <Pressable
                accessibilityRole="button"
                onPress={() => void openCareTipWeb(authWebPaths.join)}
                style={({ pressed }) => [styles.secondaryAction, pressed ? styles.pressed : null]}
              >
                <Text style={styles.secondaryLabel}>{t("auth.enterInviteCode")}</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("auth.footerMenuTitle")}
            onPress={() => setFooterOpen(true)}
            style={({ pressed }) => [styles.footerTrigger, pressed ? styles.pressed : null]}
          >
            <Ionicons name="grid-outline" size={18} color="#FFFFFF" />
            <Text style={styles.footerTriggerLabel}>{t("auth.footerMenuTitle")}</Text>
            <Ionicons name="chevron-up" size={16} color="rgba(255,255,255,0.75)" />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <AuthFooterSheet visible={footerOpen} onClose={() => setFooterOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  flex: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11, 18, 32, 0.48)",
  },
  overlayBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    backgroundColor: "rgba(11, 18, 32, 0.62)",
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(233, 120, 28, 0.08)",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    gap: spacing["2xl"],
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  brandName: {
    ...typography.h1,
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginTop: spacing.xs,
  },
  tagline: {
    ...typography.body,
    color: "rgba(255, 255, 255, 0.88)",
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
  },
  cardSlot: {
    width: "100%",
  },
  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    flexWrap: "wrap",
  },
  secondaryAction: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  secondaryLabel: {
    ...typography.button,
    color: "#FFFFFF",
    fontWeight: "600",
    textDecorationLine: "underline",
    textDecorationColor: "rgba(255,255,255,0.45)",
  },
  secondaryDivider: {
    width: 1,
    height: 18,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  footerTrigger: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  footerTriggerLabel: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  pressed: {
    opacity: 0.82,
  },
});
