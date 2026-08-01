import { useEffect, useState, type ReactNode } from "react";
import {
  Image,
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
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import caretipAppIcon from "@/assets/caretip-app-icon-ref.png";
import { AuthFooterSheet } from "@/components/auth/AuthFooterSheet";
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

  const heroOpacity = useSharedValue(0);
  const heroY = useSharedValue<number>(12);
  const sheetOpacity = useSharedValue(0);
  const sheetY = useSharedValue<number>(20);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    heroOpacity.value = withTiming(1, { duration: 400, easing: ease });
    heroY.value = withTiming(0, { duration: 400, easing: ease });
    sheetOpacity.value = withDelay(80, withTiming(1, { duration: 420, easing: ease }));
    sheetY.value = withDelay(80, withTiming(0, { duration: 420, easing: ease }));
  }, [heroOpacity, heroY, sheetOpacity, sheetY]);

  const heroAnim = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroY.value }],
  }));

  const sheetAnim = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: sheetY.value }],
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
        heroHeightRatio={isTablet ? 0.32 : 0.36}
        header={
          <Animated.View style={[styles.hero, heroAnim]}>
            <View style={styles.logoMark}>
              <Image
                source={caretipAppIcon}
                style={styles.logoImage}
                accessibilityLabel="CareTip"
              />
            </View>
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
                onPress={() => setFooterOpen(true)}
                style={({ pressed }) => [styles.pillOuter, pressed ? styles.pressed : null]}
              >
                <View style={styles.pillInner}>
                  <Ionicons name="sparkles-outline" size={16} color={authBrand.white} />
                  <Text style={styles.pillLabel}>{t("auth.footerMenuTitle")}</Text>
                  <Ionicons name="chevron-up" size={15} color="rgba(255,255,255,0.8)" />
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
        <Animated.View style={[styles.formContent, sheetAnim]}>{children}</Animated.View>
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
    gap: spacing.lg,
    paddingBottom: spacing.md,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(255,255,255,0.35)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  logoImage: {
    width: "100%",
    height: "100%",
  },
  brandName: {
    ...typography.hero,
    color: authBrand.white,
    fontSize: 32,
    letterSpacing: -0.6,
  },
  tagline: {
    ...typography.body,
    color: "rgba(255, 255, 255, 0.88)",
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
    fontWeight: "500",
    paddingHorizontal: spacing.md,
  },
  formContent: {
    gap: spacing["3xl"],
  },
  footer: {
    gap: spacing["3xl"],
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  secondaryAction: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  secondaryLabel: {
    ...typography.button,
    color: authBrand.white,
    fontWeight: "600",
    fontSize: 15,
  },
  secondaryPipe: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 16,
  },
  pillOuter: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authBrand.glassPillBorder,
    backgroundColor: authBrand.glassPillFill,
    minHeight: touchTarget,
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  pillLabel: {
    ...typography.caption,
    color: authBrand.white,
    fontWeight: "700",
    letterSpacing: 0.3,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.85,
  },
});
