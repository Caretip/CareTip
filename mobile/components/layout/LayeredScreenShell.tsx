import type { ReactNode } from "react";
import {
  ImageBackground,
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
import { layered, layeredSheetShadow } from "@/theme/layered";
import { spacing } from "@/theme";
import { useTheme } from "@/hooks/useTheme";

export type LayeredBackgroundVariant = "gradient" | "auth-image";

type LayeredScreenShellProps = {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  background?: LayeredBackgroundVariant;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardAware?: boolean;
  tabSafe?: boolean;
  heroHeightRatio?: number;
  scrollProps?: ScrollViewProps;
};

const TABLET_MIN_WIDTH = 768;

export function LayeredScreenShell({
  header,
  children,
  footer,
  background = "gradient",
  refreshing,
  onRefresh,
  keyboardAware = false,
  tabSafe = false,
  heroHeightRatio = layered.heroHeightRatio,
  scrollProps,
}: LayeredScreenShellProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const pagePadding = isTablet ? spacing["4xl"] : layered.pagePadding;
  const heroHeight = Math.max(height * heroHeightRatio, layered.heroMinHeight);
  const { colors, isDark } = useTheme();
  const sheetBackground = isDark ? colors.card : layered.sheetBackground;

  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      bounces
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={authBrand.white}
            colors={[authBrand.orange]}
            progressBackgroundColor={sheetBackground}
          />
        ) : undefined
      }
      contentContainerStyle={[
        styles.scrollContent,
        tabSafe ? styles.tabClearance : null,
        { paddingBottom: Math.max(insets.bottom, layered.pagePadding) + (tabSafe ? 88 : 0) },
      ]}
      {...scrollProps}
    >
      <View style={[styles.heroZone, { minHeight: heroHeight, paddingHorizontal: pagePadding }]}>
        {header}
      </View>

      <View
        style={[
          styles.foregroundSheet,
          layeredSheetShadow,
          {
            marginTop: -layered.sheetOverlap,
            borderTopLeftRadius: layered.sheetRadius,
            borderTopRightRadius: layered.sheetRadius,
            paddingHorizontal: pagePadding,
            paddingTop: layered.sectionGap,
            paddingBottom: layered.sectionGap,
            backgroundColor: sheetBackground,
          },
        ]}
      >
        {children}
      </View>

      {footer ? (
        <View style={[styles.footerZone, { paddingHorizontal: pagePadding }]}>{footer}</View>
      ) : null}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      {background === "auth-image" ? (
        <View style={styles.backgroundLayer} pointerEvents="none">
          <ImageBackground
            source={authBackground}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          >
            <LinearGradient
              colors={[
                authBrand.overlayTop,
                authBrand.overlayMid,
                "rgba(11, 18, 32, 0.52)",
                authBrand.overlayBottom,
              ]}
              locations={[0, 0.28, 0.62, 1]}
              style={StyleSheet.absoluteFill}
            />
          </ImageBackground>
        </View>
      ) : null}

      {background === "gradient" ? (
        <LinearGradient
          colors={[...layered.heroGradient.colors]}
          start={layered.heroGradient.start}
          end={layered.heroGradient.end}
          style={[styles.heroGradient, { height: heroHeight + layered.sheetOverlap }]}
          pointerEvents="none"
        />
      ) : (
        <LinearGradient
          colors={["rgba(235, 153, 44, 0.18)", "rgba(235, 153, 44, 0.06)", "transparent"]}
          locations={[0, 0.45, 1]}
          style={[styles.heroGradient, { height: heroHeight + layered.sheetOverlap }]}
          pointerEvents="none"
        />
      )}

      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(insets.top, spacing.lg) : 0}
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
    backgroundColor: authBrand.dark,
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
  scrollContent: {
    flexGrow: 1,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  heroZone: {
    justifyContent: "flex-end",
    paddingTop: spacing["3xl"],
    paddingBottom: layered.sheetOverlap + spacing.lg,
    zIndex: 1,
  },
  foregroundSheet: {
    zIndex: 2,
    gap: layered.elementGap,
  },
  footerZone: {
    paddingTop: spacing["2xl"],
    paddingBottom: spacing.lg,
    zIndex: 1,
  },
  tabClearance: {
    paddingBottom: spacing["6xl"],
  },
});
