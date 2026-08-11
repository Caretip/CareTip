import type { PressableProps } from "react-native";
import { Image, StyleSheet } from "react-native";
import {
  OAuthProviderCircle,
  type OAuthProviderCircleVariant,
} from "@/components/auth/OAuthProviderCircle";
import googleLogo from "@/assets/oauth/google.png";
import { authBrand } from "@/theme/authBrand";

type GoogleAuthButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: OAuthProviderCircleVariant;
};

/** Circular Google control — approved template logo. */
export function GoogleAuthButton({
  label,
  loading = false,
  variant = "hero",
  ...rest
}: GoogleAuthButtonProps) {
  return (
    <OAuthProviderCircle
      accessibilityLabel={label}
      loading={loading}
      variant={variant}
      fillColor="transparent"
      borderColor="transparent"
      spinnerColor={authBrand.orange}
      icon={<Image source={googleLogo} style={styles.logo} resizeMode="contain" />}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: "100%", height: "100%" },
});
