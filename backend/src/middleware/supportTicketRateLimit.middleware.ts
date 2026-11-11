import type { Request } from "express";
import { resolveClientIp } from "../lib/clientIp.js";
import { sharedRateLimit } from "./sharedRateLimit.middleware.js";

const byUser = (req: Request) => `user:${req.user?.userId ?? req.user?.id ?? resolveClientIp(req)}`;

/** Limit new support tickets per business manager (abuse protection). */
export const supportTicketCreateLimiter = sharedRateLimit({
  scope: "support-ticket-create",
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SUPPORT_TICKET_MAX_PER_HOUR ?? 8),
  message: "Too many support requests. Please try again later.",
  key: byUser,
});

export const supportTicketReplyLimiter = sharedRateLimit({
  scope: "support-ticket-reply",
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SUPPORT_TICKET_REPLY_MAX_PER_WINDOW ?? 30),
  message: "Too many messages. Please wait a few minutes.",
  key: byUser,
});
