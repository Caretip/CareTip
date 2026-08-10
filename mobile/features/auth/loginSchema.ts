import { z } from "zod";

type TranslateFn = (key: string) => string;

export function createLoginSchema(t: TranslateFn) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t("validation.emailPasswordRequired"))
      .email(t("validation.emailInvalid")),
    password: z.string().min(1, t("validation.emailPasswordRequired")),
  });
}

/** @deprecated Prefer createLoginSchema(t) for localized validation. */
export const loginSchema = createLoginSchema((key) => {
  const en: Record<string, string> = {
    "validation.emailPasswordRequired": "Please enter both email and password.",
    "validation.emailInvalid": "Please enter a valid email address.",
  };
  return en[key] ?? key;
});

export type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>;

export function createMfaSchema(t: TranslateFn) {
  return z.object({
    code: z
      .string()
      .trim()
      .min(6, t("validation.mfaCodeRequired"))
      .max(8, t("validation.mfaCodeTooLong")),
  });
}

/** @deprecated Prefer createMfaSchema(t). */
export const mfaSchema = createMfaSchema((key) => {
  const en: Record<string, string> = {
    "validation.mfaCodeRequired": "Enter the 6-digit code from your authenticator app.",
    "validation.mfaCodeTooLong": "That code is too long. Please check and try again.",
  };
  return en[key] ?? key;
});

export type MfaFormValues = z.infer<ReturnType<typeof createMfaSchema>>;
