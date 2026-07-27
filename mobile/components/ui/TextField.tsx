import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export function TextField({
  label,
  error,
  containerStyle,
  style,
  accessibilityLabel,
  ...rest
}: TextFieldProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={styles.label} accessibilityRole="text">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, error ? styles.inputError : null, style]}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: colors.foreground,
    fontWeight: "600",
  },
  input: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBackground,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    ...typography.body,
    color: colors.foreground,
  },
  inputError: {
    borderColor: colors.destructive,
    backgroundColor: colors.destructiveSoft,
  },
  error: {
    ...typography.caption,
    color: colors.destructive,
  },
});
