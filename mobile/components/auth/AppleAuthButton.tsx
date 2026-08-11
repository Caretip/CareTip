import type { PressableProps } from "react-native";
import { Image, StyleSheet } from "react-native";
import {
  OAuthProviderCircle,
  type OAuthProviderCircleVariant,
} from "@/components/auth/OAuthProviderCircle";
import appleLogo from "@/assets/oauth/apple.png";
import { authBrand } from "@/theme/authBrand";

type AppleAuthButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: OAuthProviderCircleVariant;
};

/** Circular Apple control — approved Sign in with Apple logo. */
export function AppleAuthButton({
  label,
  loading = false,
  variant = "hero",
  ...rest
}: AppleAuthButtonProps) {
  return (
    <OAuthProviderCircle
      accessibilityLabel={label}
      loading={loading}
      variant={variant}
      fillColor="transparent"
      borderColor="transparent"
      spinnerColor={authBrand.orange}
      icon={<Image source={appleLogo} style={styles.logo} resizeMode="cover" />}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: "100%", height: "100%" },
});
