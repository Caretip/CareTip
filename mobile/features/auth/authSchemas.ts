import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .min(1, "Please enter your email address.")
  .email("Please enter a valid email address.");

const passwordField = z.string().min(8, "Password must be at least 8 characters.");

/** Manager / business account creation only — employees use AcceptInviteScreen. */
export const managerRegisterSchema = z
  .object({
    name: z.string().trim().optional(),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
  });

export type ManagerRegisterFormValues = z.infer<typeof managerRegisterSchema>;

/** @deprecated Prefer managerRegisterSchema */
export const registerSchema = managerRegisterSchema;
export type RegisterFormValues = ManagerRegisterFormValues;

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const joinSchema = z.object({
  inviteCode: z.string().trim().min(1, "Please enter your invite code."),
});

export type JoinFormValues = z.infer<typeof joinSchema>;
