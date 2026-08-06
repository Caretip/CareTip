import { useMemo } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import {
  OAuthProviderCircle,
  type OAuthProviderCircleVariant,
} from "@/components/auth/OAuthProviderCircle";
import { useI18n } from "@/hooks/useI18n";
import type { OAuthProvider } from "@/types/auth";
import { spacing } from "@/theme";

import googleLogo from "@/assets/oauth/google.png";
import facebookLogo from "@/assets/oauth/facebook.png";
import appleLogo from "@/assets/oauth/apple.png";

type SocialAuthButtonsProps = {
  providers: OAuthProvider[];
  loadingProvider: OAuthProvider | null;
  disabled?: boolean;
  variant?: OAuthProviderCircleVariant;
  onPressProvider: (provider: OAuthProvider) => void;
};

const LOGO_SOURCE = {
  google: googleLogo,
  facebook: facebookLogo,
  apple: appleLogo,
} as const;

/**
 * Shared CareTip OAuth row — approved template logos (unmodified), equal spacing.
 */
export function SocialAuthButtons({
  providers,
  loadingProvider,
  disabled = false,
  variant = "hero",
  onPressProvider,
}: SocialAuthButtonsProps) {
  const { t } = useI18n();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xl,
          width: "100%",
          flexWrap: "wrap",
        },
        logo: {
          width: "100%",
          height: "100%",
        },
      }),
    [],
  );

  if (providers.length === 0) return null;

  const labelFor = (provider: OAuthProvider) => {
    if (provider === "apple") return t("auth.continueWithApple");
    if (provider === "facebook") return t("auth.continueWithFacebook");
    return t("auth.continueWithGoogle");
  };

  return (
    <View style={styles.row}>
      {providers.map((provider) => {
        const loading = loadingProvider === provider;
        const busy = disabled || loadingProvider != null;
        return (
          <OAuthProviderCircle
            key={provider}
            accessibilityLabel={labelFor(provider)}
            loading={loading}
            disabled={busy}
            variant={variant}
            fillColor="#FFFFFF"
            borderColor="transparent"
            spinnerColor="#EB992C"
            icon={
              <Image
                source={LOGO_SOURCE[provider]}
                style={styles.logo}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            }
            onPress={() => onPressProvider(provider)}
          />
        );
      })}
    </View>
  );
}
