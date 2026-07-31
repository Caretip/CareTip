import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { authBrand } from "@/theme/authBrand";
import { layered } from "@/theme/layered";
import { colors, motion, radius, shadows, spacing, touchTarget, typography } from "@/theme";

type AuthFieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
};

const AnimatedView = Animated.createAnimatedComponent(View);

export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  {
    label,
    icon,
    error,
    value,
    onFocus,
    onBlur,
    editable = true,
    style,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const focusProgress = useSharedValue(0);
  const errorColor = colors.destructive;

  useImperativeHandle(ref, () => inputRef.current as TextInput);

  const fieldStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [error ? errorColor : "rgba(11, 18, 32, 0.08)", error ? errorColor : authBrand.orange],
    ),
    ...Platform.select({
      ios: {
        shadowOpacity: interpolate(focusProgress.value, [0, 1], [0.06, 0.12]),
        shadowRadius: interpolate(focusProgress.value, [0, 1], [10, 16]),
      },
      default: {},
    }),
  }));

  const focusInput = () => {
    if (editable !== false) {
      inputRef.current?.focus();
    }
  };

  return (
    <View style={styles.wrap} collapsable={false}>
      <Text style={styles.label} pointerEvents="none">
        {label}
      </Text>
      <Pressable
        accessibilityRole="none"
        disabled={editable === false}
        onPress={focusInput}
        style={({ pressed }) => [pressed && editable !== false ? styles.pressed : null]}
      >
        <AnimatedView style={[styles.field, shadows.sm, fieldStyle]}>
          <View style={styles.iconSlot} pointerEvents="none">
            <Ionicons
              name={icon}
              size={20}
              color={focused ? authBrand.orange : authBrand.muted}
            />
          </View>
          <TextInput
            ref={inputRef}
            value={value}
            accessibilityLabel={label}
            placeholderTextColor={authBrand.muted}
            style={[styles.input, style]}
            autoCapitalize="none"
            autoCorrect={false}
            importantForAutofill="yes"
            textAlignVertical="center"
            underlineColorAndroid="transparent"
            editable={editable}
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
        </AnimatedView>
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: authBrand.muted,
    fontWeight: "600",
    fontSize: 13,
    paddingHorizontal: spacing.xxs,
  },
  field: {
    minHeight: touchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: authBrand.white,
    borderWidth: 1.5,
    borderColor: "rgba(11, 18, 32, 0.08)",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  iconSlot: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    ...typography.body,
    color: authBrand.dark,
    padding: 0,
    margin: 0,
    minHeight: touchTarget,
  },
  pressed: {
    opacity: 0.96,
  },
  error: {
    ...typography.caption,
    color: colors.destructive,
    fontWeight: "600",
    paddingHorizontal: spacing.xxs,
  },
});
