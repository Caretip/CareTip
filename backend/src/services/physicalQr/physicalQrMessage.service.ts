import { prisma } from "../../prisma.js";
import { getPhysicalQrOrderForAdmin } from "./physicalQrFulfillment.service.js";
import { PhysicalQrOrderError } from "./physicalQrOrder.service.js";

const MAX_BODY = 2000;

function parseBody(raw: unknown): string {
  const body = String(raw ?? "").trim();
  if (!body) {
    throw new PhysicalQrOrderError("MESSAGE_REQUIRED", "Message text is required.");
  }
  if (body.length > MAX_BODY) {
    throw new PhysicalQrOrderError("MESSAGE_TOO_LONG", `Message must be at most ${MAX_BODY} characters.`);
  }
  return body;
}

export function toInternalNoteDto(row: {
  id: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    body: row.body,
    authorName: "Admin",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPhysicalQrInternalNotes(orderId: string) {
  await getPhysicalQrOrderForAdmin(orderId);
  const rows = await prisma.physicalQrOrderInternalNote.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rows.map(toInternalNoteDto);
}

export async function postPhysicalQrInternalNote(input: {
  userId: string;
  orderId: string;
  body: unknown;
}) {
  await getPhysicalQrOrderForAdmin(input.orderId);
  const body = parseBody(input.body);
  const row = await prisma.physicalQrOrderInternalNote.create({
    data: {
      orderId: input.orderId,
      authorUserId: input.userId,
      body,
    },
  });
  return toInternalNoteDto(row);
}
