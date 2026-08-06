import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
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
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { notifyIdleTrustedActivity } from "@/lib/idleSession/idleSessionActivity";
import { motion, radius, shadows, spacing, touchTarget, typography } from "@/theme";

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
    onChangeText,
    editable = true,
    ...rest
  },
  ref,
) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const focusProgress = useSharedValue(0);

  useImperativeHandle(ref, () => inputRef.current as TextInput);

  const errorBorderColor = error ? colors.destructive : null;

  const inputStyle = useAnimatedStyle(
    () => ({
      borderColor: interpolateColor(
        focusProgress.value,
        [0, 1],
        [errorBorderColor ?? colors.borderStrong, errorBorderColor ?? colors.primary],
      ),
    }),
    [errorBorderColor, colors.borderStrong, colors.primary],
  );

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
      <Pressable accessibilityRole="none" disabled={editable === false} onPress={focusInput}>
        <View style={[styles.inputShell, shadows.sm]}>
          <AnimatedView style={[styles.input, inputStyle, error ? styles.inputError : null]}>
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
              onChangeText={(text) => {
                notifyIdleTrustedActivity();
                onChangeText?.(text);
              }}
              {...rest}
            />
          </AnimatedView>
        </View>
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      gap: spacing.sm,
    },
    label: {
      ...typography.label,
      color: colors.foreground,
    },
    inputShell: {
      borderRadius: radius.lg,
      overflow: "hidden",
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
      ...typography.input,
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
      ...typography.helper,
      color: colors.destructive,
    },
  });
}
