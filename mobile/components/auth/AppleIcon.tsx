import Svg, { Path } from "react-native-svg";

type AppleIconProps = {
  size?: number;
  color?: string;
};

/** Apple logo mark for Sign in with Apple. */
export function AppleIcon({ size = 20, color = "#FFFFFF" }: AppleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityRole="image">
      <Path
        fill={color}
        d="M16.365 1.43c0 1.14-.42 2.21-1.18 3.05-.8.9-2.12 1.59-3.28 1.5-.14-1.1.4-2.25 1.15-3.08.82-.9 2.23-1.55 3.31-1.47zM20.79 17.38c-.58 1.33-.86 1.92-1.61 3.1-1.05 1.62-2.53 3.64-4.37 3.66-1.63.02-2.05-1.07-4.27-1.05-2.21.01-2.68 1.08-4.31 1.06-1.84-.02-3.24-1.84-4.29-3.46C-.01 16.96-.9 12.3.86 9.2c1.12-1.96 2.9-3.2 4.56-3.2 1.7 0 2.77 1.1 4.18 1.1 1.36 0 2.19-1.11 4.17-1.11 1.49 0 3.07 1.02 4.18 2.78-3.67 2.01-3.07 7.24.84 8.61z"
      />
    </Svg>
  );
}
