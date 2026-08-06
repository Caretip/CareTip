import type { PressableProps } from "react-native";
import { Image, StyleSheet } from "react-native";
import {
  OAuthProviderCircle,
  type OAuthProviderCircleVariant,
} from "@/components/auth/OAuthProviderCircle";
import facebookLogo from "@/assets/oauth/facebook.png";

type FacebookAuthButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: OAuthProviderCircleVariant;
};

/** Circular Facebook control — approved Facebook primary logo. */
export function FacebookAuthButton({
  label,
  loading = false,
  variant = "hero",
  ...rest
}: FacebookAuthButtonProps) {
  return (
    <OAuthProviderCircle
      accessibilityLabel={label}
      loading={loading}
      variant={variant}
      fillColor="transparent"
      borderColor="transparent"
      spinnerColor="#EB992C"
      icon={<Image source={facebookLogo} style={styles.logo} resizeMode="cover" />}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: "100%", height: "100%" },
});
