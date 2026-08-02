import { useEffect, useState, type ReactNode } from "react";
import {
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import authBackground from "@/assets/auth/mobileauth.png";
import { authBrand } from "@/theme/authBrand";
import { brand } from "@/theme/colors";
import { premiumHeroGradient, premiumPalette } from "@/theme/dashboardPremium";
import { layered, layeredSheetShadow } from "@/theme/layered";
import { spacing } from "@/theme";
import { useTheme } from "@/hooks/useTheme";

export type LayeredBackgroundVariant = "gradient" | "auth-image";
export type LayeredLayoutVariant = "sheet" | "floating";

type LayeredScreenShellProps = {
  header?: ReactNode;
  /** Pinned below hero title — stays visible while scrolling (period toggle, etc.). */
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  background?: LayeredBackgroundVariant;
  layout?: LayeredLayoutVariant;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardAware?: boolean;
  keyboardOpen?: boolean;
  tabSafe?: boolean;
  heroHeightRatio?: number;
  scrollProps?: ScrollViewProps;
};

const TABLET_MIN_WIDTH = 768;

export function LayeredScreenShell({
  header,
  headerExtra,
  children,
  footer,
  background = "gradient",
  layout = "sheet",
  refreshing,
  onRefresh,
  keyboardAware = false,
  keyboardOpen: keyboardOpenProp,
  tabSafe = false,
  heroHeightRatio = layered.heroHeightRatio,
  scrollProps,
}: LayeredScreenShellProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const isFloating = layout === "floating";
  const isDashboard = background === "gradient" && !isFloating;
  const pagePadding = isTablet ? spacing["4xl"] : layered.pagePadding;
  const [keyboardOpenLocal, setKeyboardOpenLocal] = useState(false);
  const keyboardOpen = keyboardOpenProp ?? keyboardOpenLocal;

  useEffect(() => {
    if (keyboardOpenProp !== undefined || !keyboardAware || !isFloating) return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardOpenLocal(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOpenLocal(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardAware, isFloating, keyboardOpenProp]);

  const compressedRatio = keyboardOpen && isFloating ? heroHeightRatio * 0.42 : heroHeightRatio;
  const heroHeight = Math.max(
    height * compressedRatio,
    keyboardOpen && isFloating ? 88 : isFloating ? 200 : layered.heroMinHeight,
  );
  const { colors, isDark } = useTheme();
  const sheetBackground = isDark ? colors.background : layered.sheetBackground;
  const pageBackground = isDark ? colors.background : layered.pageBackground;
  const rootBackground = isDashboard ? pageBackground : isFloating ? authBrand.dark : brand.orange;

  const stickyHeaderIndices = isDashboard && headerExtra ? [1] : undefined;

  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      bounces
      stickyHeaderIndices={stickyHeaderIndices}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={isFloating ? authBrand.white : authBrand.white}
            colors={[premiumPalette.primary]}
            progressBackgroundColor={isDashboard ? premiumPalette.primary : sheetBackground}
          />
        ) : undefined
      }
      contentContainerStyle={[
        styles.scrollContent,
        isDashboard ? styles.scrollContentDashboard : null,
        tabSafe ? styles.tabClearance : null,
        {
          minHeight: height,
          paddingBottom:
            Math.max(insets.bottom, isFloating ? spacing["3xl"] : spacing.lg) + (tabSafe ? 80 : 0),
        },
      ]}
      {...scrollProps}
    >
      <View
        style={[
          styles.heroZone,
          isFloating ? styles.heroZoneFloating : null,
          isDashboard ? styles.heroZoneDashboard : null,
          keyboardOpen && isFloating ? styles.heroZoneCompressed : null,
          { minHeight: heroHeight, paddingHorizontal: pagePadding },
        ]}
      >
        {header}
      </View>

      {headerExtra && isDashboard ? (
        <View
          style={[
            styles.stickyHeaderExtra,
            { paddingHorizontal: pagePadding, backgroundColor: premiumPalette.primary },
          ]}
        >
          {headerExtra}
        </View>
      ) : null}

      {isFloating ? (
        <View style={[styles.floatingContent, { paddingHorizontal: pagePadding }]}>
          {children}
        </View>
      ) : (
        <View
          style={[
            styles.foregroundSheet,
            layeredSheetShadow,
            {
              marginTop: -layered.sheetOverlap,
              borderTopLeftRadius: layered.sheetRadius,
              borderTopRightRadius: layered.sheetRadius,
              paddingHorizontal: pagePadding,
              paddingTop: spacing["2xl"],
              paddingBottom: spacing["3xl"],
              backgroundColor: sheetBackground,
              minHeight: height - heroHeight + layered.sheetOverlap + (tabSafe ? 88 : 0),
            },
          ]}
        >
          {children}
        </View>
      )}

      {footer ? (
        <View
          style={[
            styles.footerZone,
            isFloating ? styles.footerZoneFloating : null,
            keyboardOpen && isFloating ? styles.footerCompressed : null,
            { paddingHorizontal: pagePadding },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <View style={[styles.root, { backgroundColor: rootBackground }]}>
      {background === "auth-image" ? (
        <View style={styles.backgroundLayer} pointerEvents="none">
          <ImageBackground
            source={authBackground}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          >
            <LinearGradient
              colors={[authBrand.overlayTop, authBrand.overlayMid, authBrand.overlayBottom]}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
          </ImageBackground>
        </View>
      ) : null}

      {background === "gradient" ? (
        <>
          <LinearGradient
            colors={[...premiumHeroGradient.colors]}
            locations={[...premiumHeroGradient.locations]}
            start={premiumHeroGradient.start}
            end={premiumHeroGradient.end}
            style={[
              styles.heroGradient,
              { height: heroHeight + layered.sheetOverlap },
            ]}
            pointerEvents="none"
          />
          <View
            style={[
              styles.heroGlow,
              { top: heroHeight * 0.12, left: pagePadding - spacing.md },
            ]}
            pointerEvents="none"
          />
        </>
      ) : background === "auth-image" ? null : (
        <LinearGradient
          colors={["rgba(245, 166, 35, 0.18)", "rgba(245, 166, 35, 0.06)", "transparent"]}
          locations={[0, 0.45, 1]}
          style={[styles.heroGradient, { height: heroHeight + layered.sheetOverlap }]}
          pointerEvents="none"
        />
      )}

      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(insets.top, spacing.md) : 0}
        >
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.flex}>{scroll}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
    zIndex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  heroGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  heroGlow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    zIndex: 0,
  },
  scrollContent: {
    flexGrow: 1,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  scrollContentDashboard: {
    flexGrow: 1,
  },
  heroZone: {
    justifyContent: "flex-end",
    paddingTop: spacing.xl,
    paddingBottom: layered.sheetOverlap + spacing.md,
    zIndex: 1,
  },
  heroZoneDashboard: {
    paddingBottom: spacing.lg,
    paddingTop: spacing.lg,
  },
  stickyHeaderExtra: {
    zIndex: 3,
    paddingTop: spacing.xxs,
    paddingBottom: layered.sheetOverlap + spacing.md,
  },
  heroZoneFloating: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  heroZoneCompressed: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  foregroundSheet: {
    zIndex: 2,
    gap: layered.elementGap,
    flexGrow: 1,
  },
  floatingContent: {
    zIndex: 2,
    gap: spacing["2xl"],
    paddingTop: spacing.sm,
  },
  footerZone: {
    paddingTop: spacing["2xl"],
    paddingBottom: spacing.lg,
    zIndex: 1,
  },
  footerZoneFloating: {
    paddingTop: spacing["2xl"],
    paddingBottom: spacing["2xl"],
  },
  footerCompressed: {
    paddingTop: spacing.lg,
    opacity: 0.85,
  },
  tabClearance: {
    paddingBottom: spacing["5xl"],
  },
});
