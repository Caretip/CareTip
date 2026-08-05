import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

type MediaUploadControlProps = {
  preview: ReactNode;
  actionLabel: string;
  uploadingLabel: string;
  hint?: string;
  disabled?: boolean;
  uploading?: boolean;
  onPress: () => void;
};

/** Shared tap-to-upload chrome for logo / avatar settings. */
export function MediaUploadControl({
  preview,
  actionLabel,
  uploadingLabel,
  hint,
  disabled,
  uploading,
  onPress,
}: MediaUploadControlProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const busy = Boolean(uploading);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {preview}
        <View style={styles.meta}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || disabled, busy }}
            disabled={busy || disabled}
            onPress={() => {
              hapticLight();
              onPress();
            }}
            style={({ pressed }) => [
              styles.button,
              (busy || disabled) && styles.buttonDisabled,
              pressed && !busy && !disabled ? styles.pressed : null,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : null}
            <Text style={styles.buttonLabel}>{busy ? uploadingLabel : actionLabel}</Text>
          </Pressable>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      marginBottom: spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
    },
    meta: {
      flex: 1,
      gap: spacing.sm,
      minWidth: 0,
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.secondary,
    },
    buttonDisabled: {
      opacity: 0.65,
    },
    pressed: {
      opacity: 0.88,
    },
    buttonLabel: {
      ...typography.body,
      fontWeight: "600",
      color: colors.primary,
    },
    hint: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
  });
}
