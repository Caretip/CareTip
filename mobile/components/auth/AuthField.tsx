import { useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { authBrand } from "@/theme/authBrand";
import { motion, radius, spacing, typography } from "@/theme";

type AuthFieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
};

const AnimatedView = Animated.createAnimatedComponent(View);

export function AuthField({
  label,
  icon,
  error,
  value,
  onFocus,
  onBlur,
  style,
  ...rest
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false);
  const focusProgress = useSharedValue(0);
  const hasValue = Boolean(value && String(value).length > 0);
  const float = focused || hasValue;

  const ringStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [error ? "#E11D48" : "rgba(11, 18, 32, 0.08)", error ? "#E11D48" : authBrand.orange],
    ),
  }));

  return (
    <View style={styles.wrap}>
      <AnimatedView style={[styles.field, ringStyle]}>
        <View style={styles.iconSlot}>
          <Ionicons
            name={icon}
            size={18}
            color={focused ? authBrand.orange : authBrand.muted}
          />
        </View>
        <View style={styles.inputCol}>
          <Text style={[styles.label, float ? styles.labelFloat : null]}>{label}</Text>
          <TextInput
            value={value}
            accessibilityLabel={label}
            placeholderTextColor="transparent"
            style={[styles.input, style]}
            autoCapitalize="none"
            autoCorrect={false}
            importantForAutofill="yes"
            textAlignVertical="center"
            underlineColorAndroid="transparent"
            onFocus={(e) => {
              setFocused(true);
              focusProgress.value = withTiming(1, { duration: motion.duration.fast });
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              focusProgress.value = withTiming(0, { duration: motion.duration.fast });
              onBlur?.(e);
            }}
            {...rest}
          />
        </View>
      </AnimatedView>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  field: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.xl,
    backgroundColor: authBrand.inputFill,
    borderWidth: 1.5,
    borderColor: "rgba(11, 18, 32, 0.08)",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: "#0B1220",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  iconSlot: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  inputCol: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  label: {
    ...typography.caption,
    color: authBrand.muted,
    fontWeight: "600",
    marginBottom: 2,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  labelFloat: {
    color: authBrand.orange,
  },
  input: {
    ...typography.body,
    color: authBrand.dark,
    padding: 0,
    margin: 0,
    minHeight: 22,
  },
  error: {
    ...typography.caption,
    color: "#E11D48",
    fontWeight: "600",
    paddingHorizontal: spacing.xs,
  },
});
