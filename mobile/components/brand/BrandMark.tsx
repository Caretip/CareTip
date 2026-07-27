import { Image, type ImageStyle, type StyleProp } from "react-native";

type BrandMarkProps = {
  /** Visual height in dp; width follows the wordmark aspect ratio. */
  height?: number;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
};

/**
 * Official CareTip primary wordmark (same asset as web `caretip-logo-primary.png`).
 */
export function BrandMark({
  height = 36,
  style,
  accessibilityLabel = "CareTip",
}: BrandMarkProps) {
  return (
    <Image
      source={require("../../assets/brand/caretip-logo-primary.png")}
      style={[{ height, width: height * 3.8 }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
