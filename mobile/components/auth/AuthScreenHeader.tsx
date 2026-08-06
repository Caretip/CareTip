import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { useI18n } from "@/hooks/useI18n";
import { spacing } from "@/theme";

type AuthScreenHeaderProps = {
  title: string;
  subtitle?: string;
  /** Defaults to shared “WELCOME TO CARETIP” eyebrow. */
  eyebrow?: string;
  children?: ReactNode;
};

/** Shared auth title stack — welcome eyebrow, page title, subtitle. */
export function AuthScreenHeader({
  title,
  subtitle,
  eyebrow,
  children,
}: AuthScreenHeaderProps) {
  const { t } = useI18n();

  return (
    <View style={[authCardStyles.cardHeader, styles.header]}>
      <Text style={authCardStyles.cardEyebrow}>{eyebrow ?? t("auth.welcomeToCaretip")}</Text>
      <Text style={authCardStyles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={authCardStyles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
});
