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
import { motion, radius, spacing, touchTarget, typography } from "@/theme";

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
  const errorColor = "#FCA5A5";

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

  const iosFocusShadowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(focusProgress.value, [0, 1], [0.14, 0.28]),
    shadowRadius: interpolate(focusProgress.value, [0, 1], [12, 18]),
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
        <AnimatedView
          style={[
            styles.field,
            fieldStyle,
            Platform.OS === "ios" ? styles.fieldIosShadow : null,
            Platform.OS === "ios" ? iosFocusShadowStyle : null,
          ]}
        >
          <View style={styles.iconSlot} pointerEvents="none">
            <Ionicons
              name={icon}
              size={20}
              color={focused ? authBrand.orangeSoft : authBrand.fieldIcon}
            />
          </View>
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
    color: authBrand.fieldLabel,
    fontWeight: "600",
    fontSize: 13,
    paddingHorizontal: spacing.xxs,
    letterSpacing: 0.2,
  },
  field: {
    minHeight: touchTarget + 10,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.xl,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    ...Platform.select({
      android: { elevation: 4 },
      default: {},
    }),
  },
  fieldIosShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
  },
  iconSlot: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    ...typography.body,
    color: authBrand.fieldText,
    padding: 0,
    margin: 0,
    minHeight: touchTarget,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.96,
  },
  error: {
    ...typography.caption,
    color: "#FCA5A5",
    fontWeight: "600",
    paddingHorizontal: spacing.xxs,
  },
});
