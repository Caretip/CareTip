import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/brand/BrandMark";
import { t } from "@/i18n";
import { lightColors } from "@/theme/colors";
import { spacing, typography } from "@/theme";

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
 * Uses light palette — renders outside ThemeBridge.
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

    const colors = lightColors;

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} accessibilityRole="alert">
        <BrandMark height={32} />
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {this.state.message || t("errors.generic")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.handleRetry}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
            {t("errors.tryAgain")}
          </Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["2xl"],
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    textAlign: "center",
  },
  button: {
    marginTop: spacing.md,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    ...typography.body,
    fontWeight: "700",
  },
});
