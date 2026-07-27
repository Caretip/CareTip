import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Please enter both email and password.")
    .email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter both email and password."),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const mfaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "Enter the 6-digit code from your authenticator app.")
    .max(8, "Code is too long"),
});

export type MfaFormValues = z.infer<typeof mfaSchema>;
