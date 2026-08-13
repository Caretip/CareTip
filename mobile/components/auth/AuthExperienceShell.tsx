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
import { Ionicons } from "@expo/vector-icons";
import { AuthFooterSheet } from "@/components/auth/AuthFooterSheet";
import { AuthHeroLogo } from "@/components/auth/AuthHeroLogo";
import { AuthTopControls } from "@/components/auth/AuthTopControls";
import { LayeredScreenShell } from "@/components/layout/LayeredScreenShell";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { useI18n } from "@/hooks/useI18n";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";
import { authLoginLayout } from "@/utils/authLoginLayout";

type AuthExperienceShellProps = {
  children: ReactNode;
  /** Explore CareTip footer pill — login only. Signup shortcuts live on the signup choice screen. */
  showSecondaryActions?: boolean;
};

const TABLET_MIN_WIDTH = 768;

export function AuthExperienceShell({
  children,
  showSecondaryActions = true,
}: AuthExperienceShellProps) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const [footerOpen, setFooterOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const heroOpacity = useSharedValue(1);
  const heroY = useSharedValue(0);
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
      duration: keyboardOpen ? 180 : 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [heroCompress, keyboardOpen]);

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
        heroHeightRatio={isTablet ? 0.18 : 0.16}
        header={
          <Animated.View style={[styles.hero, heroAnim]}>
            <View style={styles.brandRow}>
              <AuthHeroLogo height={isTablet ? authLoginLayout.logoHeightTablet : authLoginLayout.logoHeight} />
              <Text style={styles.brandName}>{t("auth.brandName")}</Text>
            </View>
            <Text style={styles.tagline}>{t("auth.tagline")}</Text>
          </Animated.View>
        }
        footer={
          showSecondaryActions ? (
            <View style={styles.footer}>
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
    gap: authLoginLayout.brandStackGap,
    paddingBottom: 0,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: authLoginLayout.brandRowGap,
    paddingHorizontal: spacing["5xl"],
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
    gap: spacing.md,
    alignItems: "center",
    paddingTop: spacing.sm,
    width: "100%",
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
