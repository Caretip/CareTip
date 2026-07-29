import { useWindowDimensions } from "react-native";

const TABLET_MIN_WIDTH = 768;
const LARGE_PHONE_MIN_WIDTH = 414;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const isLargePhone = width >= LARGE_PHONE_MIN_WIDTH;
  const isLandscape = width > height;

  return {
    width,
    height,
    isTablet,
    isLargePhone,
    isLandscape,
    contentMaxWidth: isTablet ? 960 : 720,
    chartColumn: isTablet && !isLandscape,
  };
}
