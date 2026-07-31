import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors, motion, radius, shadows, spacing, touchTarget, typography } from "@/theme";

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

const AnimatedView = Animated.createAnimatedComponent(View);

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    error,
    containerStyle,
    style,
    accessibilityLabel,
    onFocus,
    onBlur,
    editable = true,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const focusProgress = useSharedValue(0);

  useImperativeHandle(ref, () => inputRef.current as TextInput);

  const inputStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [error ? colors.destructive : colors.borderStrong, error ? colors.destructive : colors.primary],
    ),
  }));

  const focusInput = () => {
    if (editable !== false) {
      inputRef.current?.focus();
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={styles.label} pointerEvents="none" accessibilityRole="text">
        {label}
      </Text>
      <Pressable
        accessibilityRole="none"
        disabled={editable === false}
        onPress={focusInput}
      >
        <AnimatedView
          style={[
            styles.input,
            shadows.sm,
            inputStyle,
            error ? styles.inputError : null,
          ]}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel={accessibilityLabel ?? label}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.inputText, style]}
            autoCapitalize="none"
            autoCorrect={false}
            editable={editable}
            textAlignVertical="center"
            underlineColorAndroid="transparent"
            onFocus={(e) => {
              focusProgress.value = withTiming(1, { duration: motion.duration.fast });
              onFocus?.(e);
            }}
            onBlur={(e) => {
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
  container: {
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: colors.foreground,
    fontWeight: "600",
    fontSize: 13,
  },
  input: {
    minHeight: touchTarget + 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  inputText: {
    ...typography.body,
    color: colors.foreground,
    padding: 0,
    margin: 0,
    minHeight: touchTarget,
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
