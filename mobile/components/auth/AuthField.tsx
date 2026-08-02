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
import { BlurView } from "expo-blur";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { authBrand } from "@/theme/authBrand";
import { notifyIdleTrustedActivity } from "@/lib/idleSession/idleSessionActivity";
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
    onChangeText,
    editable = true,
    style,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const focusProgress = useSharedValue(0);
  const errorColor = authBrand.fieldError;

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
    shadowOpacity: interpolate(focusProgress.value, [0, 1], [0.1, 0.22]),
    shadowRadius: interpolate(focusProgress.value, [0, 1], [10, 16]),
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
          {Platform.OS === "ios" ? (
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
          ) : null}
          <View style={styles.fieldInner}>
            <View style={styles.iconSlot} pointerEvents="none">
              <Ionicons
                name={icon}
                size={19}
                color={focused ? authBrand.orangeMuted : authBrand.fieldIcon}
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
              onChangeText={(text) => {
                notifyIdleTrustedActivity();
                onChangeText?.(text);
              }}
              {...rest}
            />
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
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: authBrand.fieldLabel,
    fontWeight: "600",
    fontSize: 12,
    paddingHorizontal: spacing.xxs,
    letterSpacing: 0.3,
  },
  field: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    overflow: "hidden",
    ...Platform.select({
      android: { elevation: 3 },
      default: {},
    }),
  },
  fieldInner: {
    minHeight: touchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  fieldIosShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
  },
  iconSlot: {
    width: 26,
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
    color: authBrand.fieldError,
    fontWeight: "600",
    paddingHorizontal: spacing.xxs,
  },
});
