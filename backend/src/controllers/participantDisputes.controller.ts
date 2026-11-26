/**
 * Dispute views for business managers and employees. The scope comes from the authenticated user only;
 * no business or employee id is read from the request.
 */
import type { Request, Response } from "express";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { listDisputesForBusiness, listDisputesForEmployee } from "../services/disputes/stripeDisputeParticipant.service.js";

export async function getMyBusinessDisputes(req: Request, res: Response) {
  const userId = resolveRequestUserId(req);
  if (!userId) return res.status(401).json({ message: "Authentication required" });
  try {
    const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
    if (!business) return res.status(404).json({ message: "Business not found" });
    return res.json(await listDisputesForBusiness(business.id));
  } catch (err) {
    logServerError("participantDisputes.business", err);
    return res.status(500).json({ message: "Disputes could not be loaded." });
  }
}

export async function getMyEmployeeDisputes(req: Request, res: Response) {
  const userId = resolveRequestUserId(req);
  if (!userId) return res.status(401).json({ message: "Authentication required" });
  try {
    const employee = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) return res.json({ items: [] });
    return res.json(await listDisputesForEmployee(employee.id));
  } catch (err) {
    logServerError("participantDisputes.employee", err);
    return res.status(500).json({ message: "Disputes could not be loaded." });
  }
}
