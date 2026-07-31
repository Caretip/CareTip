import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { useI18n } from "@/hooks/useI18n";
import { joinSchema, type JoinFormValues } from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";

export function JoinScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<JoinFormValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: { inviteCode: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const validation = await authService.validateInviteCode(values.inviteCode.trim());
      if (!validation.valid) {
        setFormError(t("auth.inviteInvalid"));
        return;
      }
      router.push({
        pathname: "/(auth)/register",
        params: {
          role: "employee",
          inviteCode: values.inviteCode.trim(),
          ...(validation.businessName ? { businessName: validation.businessName } : {}),
        },
      });
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.inviteInvalid"), t));
    }
  });

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <View style={authCardStyles.cardHeader}>
          <Text style={authCardStyles.cardEyebrow}>{t("auth.enterInviteCode")}</Text>
          <Text style={authCardStyles.cardTitle}>{t("auth.joinTitle")}</Text>
          <Text style={authCardStyles.cardSubtitle}>{t("auth.joinSubtitle")}</Text>
        </View>

        <Controller
          control={control}
          name="inviteCode"
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthField
              label={t("auth.inviteCode")}
              icon="ticket-outline"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              editable={!isSubmitting}
              error={errors.inviteCode?.message}
            />
          )}
        />

        {formError ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}

        <AuthContinueButton
          label={t("common.continue")}
          onPress={onSubmit}
          loading={isSubmitting}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            hapticLight();
            router.replace("/(auth)/login");
          }}
          style={({ pressed }) => [authCardStyles.backRow, pressed ? authCardStyles.pressed : null]}
        >
          <Text style={authCardStyles.backLink}>{t("auth.backToSignIn")}</Text>
        </Pressable>
      </View>
    </AuthExperienceShell>
  );
}
