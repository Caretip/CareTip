import { sharedRateLimit } from "./sharedRateLimit.middleware.js";

export const leadSubmissionLimiter = sharedRateLimit({
  scope: "lead",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many submissions. Please wait a moment and try again.",
});
