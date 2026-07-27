import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows, spacing, touchTarget, typography } from "@/theme";

type SearchFieldProps = TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search…",
  onFocus,
  onBlur,
  ...rest
}: SearchFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrap, shadows.search, focused ? styles.focused : null]}>
      <Ionicons
        name="search"
        size={18}
        color={focused ? colors.primary : colors.mutedForeground}
        style={styles.icon}
      />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius["2xl"],
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget,
  },
  focused: {
    borderColor: colors.primary,
  },
  icon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: touchTarget,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.foreground,
  },
});
