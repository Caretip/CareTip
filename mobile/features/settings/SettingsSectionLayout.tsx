import { StyleSheet, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { spacing } from "@/theme";

type SettingsSectionLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  keyboardAware?: boolean;
};

export function SettingsSectionLayout({
  title,
  subtitle,
  children,
  keyboardAware = false,
}: SettingsSectionLayoutProps) {
  return (
    <Screen keyboardAware={keyboardAware} tabSafe>
      <DetailScreenHeader title={title} subtitle={subtitle} />
      <View style={styles.body}>{children}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.xl,
    paddingBottom: spacing["3xl"],
  },
});
