import {
  SupportTicketCategory,
  SupportTicketStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { sanitizeLikeContainsSearch } from "../utils/likeSearch.js";
import {
  notifySupportTicketCreated,
  notifySupportTicketReply,
  notifySupportTicketStatus,
} from "./supportTicketNotify.service.js";

const SUPPORT_NOTIFICATION_TYPES = [
  "support_ticket_created",
  "support_ticket_reply",
  "support_ticket_status",
] as const;

export const SUPPORT_CATEGORIES: SupportTicketCategory[] = [
  "technical",
  "billing",
  "kyc",
  "feature_request",
  "general",
];

export const SUPPORT_STATUSES: SupportTicketStatus[] = [
  "OPEN",
  "PENDING",
  "RESOLVED",
  "CLOSED",
];

export type SupportTicketDto = {
  id: string;
  ticketNumber: string;
  businessId: string;
  businessName: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
};

export type SupportTicketMessageDto = {
  id: string;
  authorUserId: string | null;
  authorRole: "business" | "admin";
  body: string;
  createdAt: string;
};

export type SupportTicketDetailDto = SupportTicketDto & {
  messages: SupportTicketMessageDto[];
};

function ticketListSelect() {
  return {
    id: true,
    ticketNumber: true,
    businessId: true,
    subject: true,
    category: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    closedAt: true,
    business: { select: { name: true } },
    messages: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { body: true },
    },
    _count: { select: { messages: true } },
  };
}

async function toListDto(
  row: Prisma.SupportTicketGetPayload<{ select: ReturnType<typeof ticketListSelect> }>,
): Promise<SupportTicketDto> {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    businessId: row.businessId,
    businessName: row.business.name,
    subject: row.subject,
    category: row.category,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    messageCount: row._count.messages,
    lastMessagePreview: row.messages[0]?.body?.slice(0, 160) ?? null,
  };
}

async function generateTicketNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const num = `CT-${ymd}-${suffix}`;
    const exists = await prisma.supportTicket.findUnique({
      where: { ticketNumber: num },
      select: { id: true },
    });
    if (!exists) return num;
  }
  return `CT-${ymd}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

export async function getBusinessForManager(userId: string) {
  return prisma.business.findFirst({
    where: { userId },
    select: { id: true, name: true, userId: true },
  });
}

export async function createSupportTicket(input: {
  userId: string;
  subject: string;
  category: SupportTicketCategory;
  message: string;
}): Promise<SupportTicketDetailDto> {
  const business = await getBusinessForManager(input.userId);
  if (!business) throw new Error("Business account not found");

  const subject = input.subject.trim().slice(0, 256);
  const message = input.message.trim();
  if (!subject || subject.length < 3) throw new Error("Subject must be at least 3 characters");
  if (!message || message.length < 10) throw new Error("Message must be at least 10 characters");
  if (!SUPPORT_CATEGORIES.includes(input.category)) throw new Error("Invalid category");

  const ticketNumber = await generateTicketNumber();

  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber,
      businessId: business.id,
      createdByUserId: input.userId,
      subject,
      category: input.category,
      status: "OPEN",
      messages: {
        create: {
          authorUserId: input.userId,
          authorRole: "business",
          body: message,
        },
      },
    },
    include: {
      business: { select: { name: true } },
      messages: { orderBy: { createdAt: "asc" } },
      _count: { select: { messages: true } },
    },
  });

  void writeAuditLog({
    userId: input.userId,
    action: "support_ticket_created",
    metadata: JSON.stringify({ ticketId: ticket.id, ticketNumber, businessId: business.id }),
  });

  const detail = await ticketToDetail(ticket);
  notifySupportTicketCreated({
    ticket: detail,
    businessName: business.name,
    managerUserId: business.userId,
  });

  return detail;
}

async function ticketToDetail(
  ticket: Prisma.SupportTicketGetPayload<{
    include: {
      business: { select: { name: true } };
      messages: true;
      _count: { select: { messages: true } };
    };
  }>,
): Promise<SupportTicketDetailDto> {
  const base = await toListDto({
    ...ticket,
    messages: ticket.messages.length
      ? [{ body: ticket.messages[ticket.messages.length - 1]!.body }]
      : [],
    _count: ticket._count,
  });
  return {
    ...base,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorUserId: m.authorUserId,
      authorRole: m.authorRole === "admin" ? "admin" : "business",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function listBusinessSupportTickets(
  userId: string,
  options?: { status?: SupportTicketStatus; search?: string },
): Promise<SupportTicketDto[]> {
  const business = await getBusinessForManager(userId);
  if (!business) return [];

  const search = sanitizeLikeContainsSearch(options?.search);
  const where: Prisma.SupportTicketWhereInput = {
    businessId: business.id,
    ...(options?.status ? { status: options.status } : {}),
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { ticketNumber: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.supportTicket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: ticketListSelect(),
  });
  return Promise.all(rows.map((r) => toListDto(r)));
}

export async function getBusinessSupportTicket(
  userId: string,
  ticketId: string,
): Promise<SupportTicketDetailDto | null> {
  const business = await getBusinessForManager(userId);
  if (!business) return null;

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, businessId: business.id },
    include: {
      business: { select: { name: true } },
      messages: { orderBy: { createdAt: "asc" } },
      _count: { select: { messages: true } },
    },
  });
  if (!ticket) return null;
  return ticketToDetail(ticket);
}

export async function addBusinessReply(input: {
  userId: string;
  ticketId: string;
  body: string;
}): Promise<SupportTicketDetailDto> {
  const business = await getBusinessForManager(input.userId);
  if (!business) throw new Error("Business account not found");

  const body = input.body.trim();
  if (!body || body.length < 2) throw new Error("Reply cannot be empty");

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: input.ticketId, businessId: business.id },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED") throw new Error("This ticket is closed");

  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorUserId: input.userId,
      authorRole: "business",
      body,
    },
  });

  const nextStatus: SupportTicketStatus =
    ticket.status === "RESOLVED" ? "OPEN" : ticket.status;

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      updatedAt: new Date(),
      status: nextStatus,
    },
  });

  const detail = await getBusinessSupportTicket(input.userId, ticket.id);
  if (!detail) throw new Error("Ticket not found");

  notifySupportTicketReply({
    ticket: detail,
    businessName: business.name,
    managerUserId: business.userId,
    repliedBy: "business",
    preview: body.slice(0, 200),
  });

  return detail;
}

export async function listPlatformSupportTickets(options?: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  search?: string;
}): Promise<SupportTicketDto[]> {
  const search = sanitizeLikeContainsSearch(options?.search);
  const where: Prisma.SupportTicketWhereInput = {
    ...(options?.status ? { status: options.status } : {}),
    ...(options?.category ? { category: options.category } : {}),
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { ticketNumber: { contains: search, mode: "insensitive" } },
            { business: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.supportTicket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: ticketListSelect(),
  });
  return Promise.all(rows.map((r) => toListDto(r)));
}

export async function getPlatformSupportTicket(ticketId: string): Promise<SupportTicketDetailDto | null> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      business: { select: { name: true, userId: true } },
      messages: { orderBy: { createdAt: "asc" } },
      _count: { select: { messages: true } },
    },
  });
  if (!ticket) return null;
  return ticketToDetail(ticket);
}

export async function addAdminReply(input: {
  adminUserId: string;
  ticketId: string;
  body: string;
}): Promise<SupportTicketDetailDto> {
  const body = input.body.trim();
  if (!body || body.length < 2) throw new Error("Reply cannot be empty");

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: input.ticketId },
    include: { business: { select: { name: true, userId: true } } },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED") throw new Error("This ticket is closed");

  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorUserId: input.adminUserId,
      authorRole: "admin",
      body,
    },
  });

  const nextStatus: SupportTicketStatus =
    ticket.status === "OPEN" ? "PENDING" : ticket.status;

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { updatedAt: new Date(), status: nextStatus },
  });

  void writeAuditLog({
    userId: input.adminUserId,
    action: "support_ticket_admin_reply",
    metadata: JSON.stringify({ ticketId: ticket.id, ticketNumber: ticket.ticketNumber }),
  });

  const detail = await getPlatformSupportTicket(ticket.id);
  if (!detail) throw new Error("Ticket not found");

  notifySupportTicketReply({
    ticket: detail,
    businessName: ticket.business.name,
    managerUserId: ticket.business.userId,
    repliedBy: "admin",
    preview: body.slice(0, 200),
  });

  return detail;
}

const STATUS_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  OPEN: ["PENDING", "RESOLVED", "CLOSED"],
  PENDING: ["OPEN", "RESOLVED", "CLOSED"],
  RESOLVED: ["PENDING", "CLOSED"],
  CLOSED: [],
};

export async function updateSupportTicketStatus(input: {
  adminUserId: string;
  ticketId: string;
  status: SupportTicketStatus;
}): Promise<SupportTicketDetailDto> {
  if (!SUPPORT_STATUSES.includes(input.status)) throw new Error("Invalid status");

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: input.ticketId },
    include: { business: { select: { name: true, userId: true } } },
  });
  if (!ticket) throw new Error("Ticket not found");

  const allowed = STATUS_TRANSITIONS[ticket.status];
  if (!allowed.includes(input.status) && ticket.status !== input.status) {
    throw new Error(`Cannot change status from ${ticket.status} to ${input.status}`);
  }

  const closedAt = input.status === "CLOSED" ? new Date() : null;

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: input.status,
      closedAt,
      updatedAt: new Date(),
    },
  });

  void writeAuditLog({
    userId: input.adminUserId,
    action: "support_ticket_status",
    metadata: JSON.stringify({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      from: ticket.status,
      to: input.status,
    }),
  });

  const detail = await getPlatformSupportTicket(ticket.id);
  if (!detail) throw new Error("Ticket not found");

  notifySupportTicketStatus({
    ticket: detail,
    businessName: ticket.business.name,
    managerUserId: ticket.business.userId,
    previousStatus: ticket.status,
  });

  return detail;
}

export function parseSupportCategory(value: string): SupportTicketCategory | null {
  const v = value.trim().toLowerCase().replace(/-/g, "_") as SupportTicketCategory;
  return SUPPORT_CATEGORIES.includes(v) ? v : null;
}

export function parseSupportStatus(value: string): SupportTicketStatus | null {
  const v = value.trim().toUpperCase() as SupportTicketStatus;
  return SUPPORT_STATUSES.includes(v) ? v : null;
}

export { SUPPORT_NOTIFICATION_TYPES };
