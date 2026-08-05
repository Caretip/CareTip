import { memo, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useMediaCacheGeneration } from "@/hooks/useMediaCacheGeneration";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { typography } from "@/theme";
import { initialsFromLabel } from "@/components/ui/RemoteAvatar";
import { resolveMediaUrl, withMediaCacheBust } from "@/utils/mediaUrl";

export type BusinessLogoProps = {
  businessName: string;
  uri?: string | null;
  size?: number;
  /** `contain` preserves aspect for wide logos; `cover` fills a square tile. */
  fit?: "contain" | "cover";
  rounded?: number;
  cacheBust?: number | string | null;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Venue / business logo — remote image when available, initials fallback.
 * Fixed outer box avoids layout shift when the image loads or fails.
 */
export const BusinessLogo = memo(function BusinessLogo({
  businessName,
  uri,
  size = 44,
  fit = "contain",
  rounded,
  cacheBust,
  style,
  accessibilityLabel,
}: BusinessLogoProps) {
  const { colors } = useTheme();
  const mediaGen = useMediaCacheGeneration();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const resolved = useMemo(
    () => withMediaCacheBust(resolveMediaUrl(uri), cacheBust ?? mediaGen),
    [uri, cacheBust, mediaGen],
  );
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [resolved]);

  const showPhoto = Boolean(resolved) && !failed;
  const corner = rounded ?? Math.max(10, size * 0.22);
  const label = businessName.trim() || "Business";
  const maxWidth = fit === "contain" ? size * 1.75 : size;

  return (
    <View
      style={[
        styles.base,
        {
          width: fit === "contain" ? maxWidth : size,
          height: size,
          borderRadius: corner,
          backgroundColor: showPhoto && loaded ? "transparent" : colors.primarySoft,
          borderWidth: showPhoto && loaded ? 0 : StyleSheet.hairlineWidth,
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {!showPhoto ? (
        <Text style={[styles.text, { color: colors.primary, fontSize: size * 0.34 }]}>
          {initialsFromLabel(label)}
        </Text>
      ) : (
        <>
          {!loaded ? (
            <View style={styles.loading} accessibilityElementsHidden>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}
          <Image
            source={{ uri: resolved }}
            resizeMode={fit}
            style={[
              styles.image,
              {
                borderRadius: corner,
                opacity: loaded ? 1 : 0,
              },
            ]}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        </>
      )}
    </View>
  );
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    base: {
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      borderColor: colors.border,
    },
    text: {
      ...typography.caption,
      fontWeight: "700",
    },
    image: {
      width: "100%",
      height: "100%",
    },
    loading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
