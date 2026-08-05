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
import { resolveMediaUrl, withMediaCacheBust } from "@/utils/mediaUrl";

export type RemoteAvatarTone = "brand" | "neutral" | "success" | "info";
export type RemoteAvatarVariant = "round" | "square";

export type RemoteAvatarProps = {
  displayName: string;
  uri?: string | null;
  size?: number;
  tone?: RemoteAvatarTone;
  variant?: RemoteAvatarVariant;
  /** Extra bust (e.g. query dataUpdatedAt). Combined with global media generation. */
  cacheBust?: number | string | null;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

function toneBg(colors: ColorPalette, tone: RemoteAvatarTone) {
  if (tone === "neutral") return colors.secondary;
  if (tone === "success") return colors.successSoft;
  if (tone === "info") return colors.infoSoft;
  return colors.primarySoft;
}

function toneFg(colors: ColorPalette, tone: RemoteAvatarTone) {
  if (tone === "neutral") return colors.secondaryForeground;
  if (tone === "success") return colors.success;
  if (tone === "info") return colors.info;
  return colors.primary;
}

export function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

/**
 * Employee / person photo — remote image when URL exists, initials fallback,
 * fixed size (no layout shift), loading shimmer, error → initials.
 */
export const RemoteAvatar = memo(function RemoteAvatar({
  displayName,
  uri,
  size = 40,
  tone = "brand",
  variant = "round",
  cacheBust,
  style,
  accessibilityLabel,
}: RemoteAvatarProps) {
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
  const radius = variant === "round" ? size / 2 : Math.max(8, size * 0.28);
  const label = displayName.trim() || "?";

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: toneBg(colors, tone),
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {!showPhoto ? (
        <Text style={[styles.text, { color: toneFg(colors, tone), fontSize: size * 0.34 }]}>
          {initialsFromLabel(label)}
        </Text>
      ) : (
        <>
          {!loaded ? (
            <View style={styles.loading} accessibilityElementsHidden>
              <ActivityIndicator size="small" color={toneFg(colors, tone)} />
            </View>
          ) : null}
          <Image
            source={{ uri: resolved }}
            style={[styles.image, { borderRadius: radius, opacity: loaded ? 1 : 0 }]}
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    text: {
      ...typography.caption,
      fontWeight: "700",
    },
    image: {
      ...StyleSheet.absoluteFillObject,
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
