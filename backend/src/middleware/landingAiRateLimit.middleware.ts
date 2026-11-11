import { sharedRateLimit } from "./sharedRateLimit.middleware.js";

export const landingAiChatLimiter = sharedRateLimit({
  scope: "landing-ai-chat",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many messages. Please wait a moment and try again.",
});

export const landingAiEventsLimiter = sharedRateLimit({
  scope: "landing-ai-events",
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many events.",
});
