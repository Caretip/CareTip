import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/brand/BrandMark";
import { t } from "@/i18n";
import { colors, spacing, typography } from "@/theme";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

/**
 * Last-resort UI for unexpected render crashes.
 * API failures are handled by screen ErrorStates — this catches React tree failures only.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(_error: unknown): State {
    return { hasError: true, message: t("errors.generic") };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (__DEV__) {
      console.warn("[CareTip][ErrorBoundary]", error, info.componentStack);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <BrandMark height={32} />
        <Text style={styles.body}>{this.state.message || t("errors.generic")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.handleRetry}
          style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        >
          <Text style={styles.buttonLabel}>{t("errors.tryAgain")}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["2xl"],
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    ...typography.body,
    color: colors.primaryForeground,
    fontWeight: "700",
  },
});
