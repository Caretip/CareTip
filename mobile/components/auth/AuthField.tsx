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
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "@/hooks/useI18n";
import { authBrand } from "@/theme/authBrand";
import { notifyIdleTrustedActivity } from "@/lib/idleSession/idleSessionActivity";
import { hapticSelection } from "@/utils/haptics";
import { hitSlop, motion, radius, spacing, touchTarget, typography } from "@/theme";

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
    onChangeText,
    editable = true,
    secureTextEntry = false,
    style,
    ...rest
  },
  ref,
) {
  const { t } = useI18n();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const focusProgress = useSharedValue(0);
  const errorColor = authBrand.fieldError;
  const isPasswordField = Boolean(secureTextEntry);
  const hidePassword = isPasswordField && !passwordVisible;

  useImperativeHandle(ref, () => inputRef.current as TextInput);

  const borderIdle = error ? errorColor : authBrand.fieldBorder;
  const borderFocus = error ? errorColor : authBrand.fieldBorderFocused;
  const fillIdle = authBrand.fieldFill;
  const fillFocus = authBrand.fieldFillFocused;

  const fieldStyle = useAnimatedStyle(
    () => ({
      borderColor: interpolateColor(focusProgress.value, [0, 1], [borderIdle, borderFocus]),
      backgroundColor: interpolateColor(focusProgress.value, [0, 1], [fillIdle, fillFocus]),
    }),
    [borderIdle, borderFocus, fillIdle, fillFocus],
  );

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
        <AnimatedView style={[styles.field, fieldStyle]}>
          <View style={styles.fieldInner}>
            <View style={styles.iconSlot} pointerEvents="none">
              <Ionicons
                name={icon}
                size={18}
                color={focused ? authBrand.orangeMuted : authBrand.fieldIcon}
              />
            </View>
            <View style={styles.iconDivider} pointerEvents="none" />
            <TextInput
              ref={inputRef}
              value={value}
              accessibilityLabel={label}
              placeholderTextColor={authBrand.fieldPlaceholder}
              selectionColor={authBrand.orangeSoft}
              cursorColor={authBrand.orangeSoft}
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
              onChangeText={(text) => {
                notifyIdleTrustedActivity();
                onChangeText?.(text);
              }}
              {...rest}
              secureTextEntry={hidePassword}
            />
            {isPasswordField ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  passwordVisible ? t("auth.hidePassword") : t("auth.showPassword")
                }
                hitSlop={hitSlop.sm}
                disabled={editable === false}
                onPress={() => {
                  hapticSelection();
                  setPasswordVisible((visible) => !visible);
                }}
                style={({ pressed }) => [
                  styles.revealSlot,
                  pressed ? styles.revealPressed : null,
                ]}
              >
                <Ionicons
                  name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={focused ? authBrand.orangeMuted : authBrand.fieldIcon}
                />
              </Pressable>
            ) : null}
          </View>
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
    gap: spacing.md,
  },
  label: {
    ...typography.label,
    color: authBrand.fieldLabel,
    paddingHorizontal: spacing.xxs,
    letterSpacing: 0.4,
  },
  field: {
    borderRadius: radius["2xl"],
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: authBrand.fieldFill,
    overflow: "hidden",
  },
  fieldInner: {
    minHeight: touchTarget + 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  iconSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: spacing.md,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  input: {
    flex: 1,
    ...typography.input,
    color: authBrand.fieldText,
    backgroundColor: "transparent",
    paddingVertical: Platform.OS === "ios" ? spacing.md + 2 : spacing.md,
    paddingHorizontal: 0,
    margin: 0,
    minHeight: touchTarget + 4,
    borderWidth: 0,
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    ...(Platform.OS === "android"
      ? {
          includeFontPadding: false,
          textAlignVertical: "center" as const,
        }
      : null),
  },
  revealSlot: {
    width: 36,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -spacing.sm,
  },
  revealPressed: {
    opacity: 0.72,
  },
  pressed: {
    opacity: 0.96,
  },
  error: {
    ...typography.helper,
    color: authBrand.fieldError,
    fontWeight: "600",
    paddingHorizontal: spacing.xxs,
  },
});
