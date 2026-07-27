import { SvgXml } from "react-native-svg";
import { CARETIP_WHITE_LOGO_SVG } from "@/assets/brand/caretipWhiteLogo";

type BrandMarkWhiteProps = {
  height?: number;
  accessibilityLabel?: string;
};

/**
 * Official white CareTip wordmark for orange / dark surfaces.
 * Source: assets/brand/CareTip_White.svg (not recreated).
 */
export function BrandMarkWhite({
  height = 36,
  accessibilityLabel = "CareTip",
}: BrandMarkWhiteProps) {
  const width = Math.round(height * (958 / 298));
  return (
    <SvgXml
      xml={CARETIP_WHITE_LOGO_SVG}
      width={width}
      height={height}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
