import Svg, { Path } from "react-native-svg";

type FacebookIconProps = {
  size?: number;
  /** Full app icon (blue) vs white “f” for brand-blue circle buttons. */
  variant?: "appIcon" | "markOnBrand";
};

/** Facebook mark — default app icon, or white “f” for branded circles. */
export function FacebookIcon({ size = 20, variant = "appIcon" }: FacebookIconProps) {
  if (variant === "markOnBrand") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityRole="image">
        <Path
          fill="#FFFFFF"
          d="M14 8.2h2.2V5H14.1C11.4 5 10 6.6 10 9.2v1.6H8v3.1h2V22h3.2v-8.1h2.4l.4-3.1H13.2V9.5c0-.8.3-1.3.8-1.3Z"
        />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityRole="image">
      <Path
        fill="#1877F2"
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953h-1.513c-1.491 0-1.956.928-1.956 1.88v2.257h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
      />
    </Svg>
  );
}
