import { useEffect, useState, type ReactNode } from "react";
import {
  Image,
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
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import hospitalityBackground from "@/assets/auth/hospitality-background.jpg";
import caretipAppIcon from "@/assets/caretip-app-icon-ref.png";
import { AuthFooterSheet } from "@/components/auth/AuthFooterSheet";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { authWebPaths } from "@/constants/authLinks";
import { useI18n } from "@/hooks/useI18n";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";

type AuthExperienceShellProps = {
  children: ReactNode;
  showSecondaryActions?: boolean;
};

const TABLET_MIN_WIDTH = 768;

export function AuthExperienceShell({
  children,
  showSecondaryActions = true,
}: AuthExperienceShellProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const [footerOpen, setFooterOpen] = useState(false);

  const heroOpacity = useSharedValue(0);
  const heroY = useSharedValue<number>(14);
  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue<number>(28);
  const footerOpacity = useSharedValue(0);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    heroOpacity.value = withTiming(1, { duration: 420, easing: ease });
    heroY.value = withTiming(0, { duration: 420, easing: ease });
    cardOpacity.value = withDelay(120, withTiming(1, { duration: 480, easing: ease }));
    cardY.value = withDelay(120, withTiming(0, { duration: 480, easing: ease }));
    footerOpacity.value = withDelay(280, withTiming(1, { duration: 360, easing: ease }));
  }, [cardOpacity, cardY, footerOpacity, heroOpacity, heroY]);

  const heroAnim = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroY.value }],
  }));

  const cardAnim = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  const footerAnim = useAnimatedStyle(() => ({
    opacity: footerOpacity.value,
  }));

  const heroMinHeight = Math.max(height * 0.36, 248);

  return (
    <View style={styles.root}>
      <SplashScreenAnchor source="auth" />
      <StatusBar style="light" />
      <View style={styles.background} pointerEvents="none">
        <ImageBackground
          source={hospitalityBackground}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        >
        {Platform.OS !== "web" ? (
          <BlurView
            intensity={12}
            tint="dark"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
        <LinearGradient
          colors={[
            authBrand.overlayTop,
            authBrand.overlayMid,
            "rgba(11, 18, 32, 0.52)",
            authBrand.overlayBottom,
          ]}
          locations={[0, 0.28, 0.62, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["rgba(0, 0, 0, 0.38)", "transparent", "rgba(0, 0, 0, 0.52)"]}
          locations={[0, 0.42, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["rgba(0, 0, 0, 0.22)", "transparent", "rgba(0, 0, 0, 0.22)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </ImageBackground>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? spacing.md : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces
          nestedScrollEnabled
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, spacing.lg) + spacing.sm,
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing["2xl"],
              paddingHorizontal: isTablet ? spacing["4xl"] : spacing["2xl"],
              minHeight: height,
            },
          ]}
        >
          <Animated.View
            style={[styles.hero, { minHeight: heroMinHeight }, heroAnim]}
          >
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

          <View style={styles.lowerZone}>
            <Animated.View style={[styles.cardSlot, cardAnim]}>{children}</Animated.View>

            {showSecondaryActions ? (
              <Animated.View style={[styles.secondaryRow, footerAnim]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void openCareTipWeb(authWebPaths.signup)}
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
                  onPress={() => void openCareTipWeb(authWebPaths.join)}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.secondaryLabel}>{t("auth.enterInviteCode")}</Text>
                </Pressable>
              </Animated.View>
            ) : null}

            <Animated.View style={[styles.pillWrap, footerAnim]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("auth.footerMenuTitle")}
                onPress={() => setFooterOpen(true)}
                style={({ pressed }) => [styles.pillOuter, pressed ? styles.pressed : null]}
              >
                {Platform.OS === "web" ? (
                  <View style={[StyleSheet.absoluteFill, styles.pillFallback]} />
                ) : (
                  <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
                )}
                <View style={styles.pillInner}>
                  <Ionicons name="sparkles-outline" size={16} color={authBrand.white} />
                  <Text style={styles.pillLabel}>{t("auth.footerMenuTitle")}</Text>
                  <Ionicons name="chevron-up" size={15} color="rgba(255,255,255,0.8)" />
                </View>
              </Pressable>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <AuthFooterSheet visible={footerOpen} onClose={() => setFooterOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authBrand.dark,
  },
  flex: {
    flex: 1,
    zIndex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing["2xl"],
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
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 6 },
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
    fontSize: 36,
    letterSpacing: -0.8,
    marginTop: spacing.md,
  },
  tagline: {
    ...typography.body,
    color: "rgba(255, 255, 255, 0.9)",
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 24,
    fontWeight: "500",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  lowerZone: {
    gap: spacing["3xl"],
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  cardSlot: {
    width: "100%",
  },
  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
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
    letterSpacing: 0.2,
  },
  secondaryPipe: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 16,
    fontWeight: "300",
  },
  pillWrap: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  pillOuter: {
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authBrand.glassPillBorder,
    minHeight: touchTarget,
  },
  pillFallback: {
    backgroundColor: authBrand.glassPillFill,
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: authBrand.glassPillFill,
  },
  pillLabel: {
    ...typography.caption,
    color: authBrand.white,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.85,
  },
});
