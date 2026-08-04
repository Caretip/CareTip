import { useEffect, useState, type ReactNode } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AuthFooterSheet } from "@/components/auth/AuthFooterSheet";
import { AuthHeroLogo } from "@/components/auth/AuthHeroLogo";
import { AuthTopControls } from "@/components/auth/AuthTopControls";
import { LayeredScreenShell } from "@/components/layout/LayeredScreenShell";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { useI18n } from "@/hooks/useI18n";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";

type AuthExperienceShellProps = {
  children: ReactNode;
  showSecondaryActions?: boolean;
  onRegisterPress?: () => void;
};

const TABLET_MIN_WIDTH = 768;

export function AuthExperienceShell({
  children,
  showSecondaryActions = true,
  onRegisterPress,
}: AuthExperienceShellProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const [footerOpen, setFooterOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const heroOpacity = useSharedValue(0);
  const heroY = useSharedValue(14);
  const heroCompress = useSharedValue(1);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    heroCompress.value = withTiming(keyboardOpen ? 0.55 : 1, {
      duration: keyboardOpen ? 220 : 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [heroCompress, keyboardOpen]);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    heroOpacity.value = withTiming(1, { duration: 480, easing: ease });
    heroY.value = withTiming(0, { duration: 480, easing: ease });
  }, [heroOpacity, heroY]);

  const heroAnim = useAnimatedStyle(() => ({
    opacity: heroOpacity.value * (0.45 + heroCompress.value * 0.55),
    transform: [{ translateY: heroY.value }, { scale: 0.88 + heroCompress.value * 0.12 }],
  }));

  return (
    <View style={styles.root}>
      <SplashScreenAnchor source="auth" />
      <StatusBar style="light" />
      <AuthTopControls />
      <LayeredScreenShell
        background="auth-image"
        layout="floating"
        keyboardAware
        keyboardOpen={keyboardOpen}
        heroHeightRatio={isTablet ? 0.24 : 0.26}
        header={
          <Animated.View style={[styles.hero, heroAnim]}>
            <AuthHeroLogo height={isTablet ? 52 : 48} />
            <Text style={styles.brandName}>{t("auth.brandName")}</Text>
            <Text style={styles.tagline}>{t("auth.tagline")}</Text>
          </Animated.View>
        }
        footer={
          showSecondaryActions ? (
            <View style={styles.footer}>
              <View style={styles.secondaryRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    onRegisterPress ? onRegisterPress() : router.push("/(auth)/register")
                  }
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.secondaryLabel}>{t("auth.register")}</Text>
                </Pressable>
                <Text style={styles.secondaryPipe}>|</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/(auth)/join")}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.secondaryLabel}>{t("auth.enterInviteCode")}</Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("auth.footerMenuTitle")}
                accessibilityHint={t("auth.footerMenuTitle")}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                onPress={() => setFooterOpen(true)}
                style={({ pressed }) => [styles.pillOuter, pressed ? styles.pressed : null]}
              >
                <View style={styles.pillInner}>
                  <Ionicons name="sparkles-outline" size={16} color={authBrand.white} />
                  <Text style={styles.pillLabel}>{t("auth.footerMenuTitle")}</Text>
                  <Ionicons name="chevron-up" size={15} color="rgba(255,255,255,0.75)" />
                </View>
              </Pressable>
            </View>
          ) : null
        }
        scrollProps={{
          contentContainerStyle: {
            maxWidth: isTablet ? 560 : 520,
          },
        }}
      >
        {children}
      </LayeredScreenShell>

      <AuthFooterSheet visible={footerOpen} onClose={() => setFooterOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authBrand.dark,
  },
  hero: {
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  brandName: {
    ...typography.h2,
    color: authBrand.white,
    fontSize: 22,
    letterSpacing: -0.4,
    fontWeight: "700",
  },
  tagline: {
    ...typography.caption,
    color: authBrand.heroSubtitle,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 18,
    fontWeight: "500",
    paddingHorizontal: spacing.md,
  },
  footer: {
    gap: spacing.xl,
    alignItems: "center",
    paddingTop: spacing.md,
    width: "100%",
  },
  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  secondaryAction: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    ...typography.button,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "600",
    fontSize: 15,
    letterSpacing: 0.2,
    textDecorationLine: "underline",
    textDecorationColor: "rgba(255,255,255,0.28)",
  },
  secondaryPipe: {
    color: "rgba(255,255,255,0.22)",
    fontSize: 14,
    fontWeight: "300",
  },
  pillOuter: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authBrand.glassPillBorder,
    backgroundColor: authBrand.glassPillFill,
    minHeight: touchTarget,
    alignSelf: "center",
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
  },
  pillLabel: {
    ...typography.caption,
    color: authBrand.white,
    fontWeight: "700",
    letterSpacing: 0.35,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.82,
  },
});
