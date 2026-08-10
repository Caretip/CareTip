import { z } from "zod";

type TranslateFn = (key: string) => string;

function emailField(t: TranslateFn) {
  return z
    .string()
    .trim()
    .min(1, t("validation.emailRequired"))
    .email(t("validation.emailInvalid"));
}

function passwordField(t: TranslateFn) {
  return z.string().min(8, t("validation.passwordMin"));
}

/** Manager / business account creation only — employees use AcceptInviteScreen. */
export function createManagerRegisterSchema(t: TranslateFn) {
  return z
    .object({
      name: z.string().trim().optional(),
      email: emailField(t),
      password: passwordField(t),
      confirmPassword: z.string().min(1, t("validation.confirmPasswordRequired")),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.passwordsMismatch"),
          path: ["confirmPassword"],
        });
      }
    });
}

/** @deprecated Prefer createManagerRegisterSchema(t). */
export const managerRegisterSchema = createManagerRegisterSchema((key) => {
  const en: Record<string, string> = {
    "validation.emailRequired": "Please enter your email address.",
    "validation.emailInvalid": "Please enter a valid email address.",
    "validation.passwordMin": "Password must be at least 8 characters.",
    "validation.confirmPasswordRequired": "Please confirm your password.",
    "validation.passwordsMismatch": "Passwords do not match.",
  };
  return en[key] ?? key;
});

export type ManagerRegisterFormValues = z.infer<ReturnType<typeof createManagerRegisterSchema>>;

/** @deprecated Prefer managerRegisterSchema */
export const registerSchema = managerRegisterSchema;
export type RegisterFormValues = ManagerRegisterFormValues;

export function createForgotPasswordSchema(t: TranslateFn) {
  return z.object({
    email: emailField(t),
  });
}

/** @deprecated Prefer createForgotPasswordSchema(t). */
export const forgotPasswordSchema = createForgotPasswordSchema((key) => {
  const en: Record<string, string> = {
    "validation.emailRequired": "Please enter your email address.",
    "validation.emailInvalid": "Please enter a valid email address.",
  };
  return en[key] ?? key;
});

export type ForgotPasswordFormValues = z.infer<ReturnType<typeof createForgotPasswordSchema>>;

export function createResetPasswordSchema(t: TranslateFn) {
  return z
    .object({
      password: passwordField(t),
      confirmPassword: z.string().min(1, t("validation.confirmPasswordRequired")),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.passwordsMismatch"),
          path: ["confirmPassword"],
        });
      }
    });
}

/** @deprecated Prefer createResetPasswordSchema(t). */
export const resetPasswordSchema = createResetPasswordSchema((key) => {
  const en: Record<string, string> = {
    "validation.passwordMin": "Password must be at least 8 characters.",
    "validation.confirmPasswordRequired": "Please confirm your password.",
    "validation.passwordsMismatch": "Passwords do not match.",
  };
  return en[key] ?? key;
});

export type ResetPasswordFormValues = z.infer<ReturnType<typeof createResetPasswordSchema>>;

export function createJoinSchema(t: TranslateFn) {
  return z.object({
    inviteCode: z.string().trim().min(1, t("validation.inviteCodeRequired")),
  });
}

/** @deprecated Prefer createJoinSchema(t). */
export const joinSchema = createJoinSchema((key) => {
  const en: Record<string, string> = {
    "validation.inviteCodeRequired": "Please enter your invite code.",
  };
  return en[key] ?? key;
});

export type JoinFormValues = z.infer<ReturnType<typeof createJoinSchema>>;

export function createAcceptInviteSchema(t: TranslateFn) {
  return z
    .object({
      name: z.string().trim().min(1, t("validation.nameRequired")),
      email: emailField(t),
      password: passwordField(t),
      confirmPassword: z.string().min(1, t("validation.confirmPasswordRequired")),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.passwordsMismatch"),
          path: ["confirmPassword"],
        });
      }
    });
}

export type AcceptInviteFormValues = z.infer<ReturnType<typeof createAcceptInviteSchema>>;
