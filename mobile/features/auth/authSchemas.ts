import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .min(1, "Please enter your email address.")
  .email("Please enter a valid email address.");

const passwordField = z.string().min(8, "Password must be at least 8 characters.");

export const registerSchema = z
  .object({
    name: z.string().trim().optional(),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password."),
    role: z.enum(["business", "employee"]),
    inviteCode: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
    if (values.role === "employee" && !values.inviteCode?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "An invite code is required for staff registration.",
        path: ["inviteCode"],
      });
    }
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

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
