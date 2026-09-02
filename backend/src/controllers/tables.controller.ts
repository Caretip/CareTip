import type { Request, Response } from "express";
import * as tablesService from "../services/tables.service.js";
import { isEntitlementDeniedError } from "../services/subscriptionEntitlement.service.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";

export async function listTables(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const tables = await tablesService.listTablesForBusinessUser(userId);
    return res.json(tables);
  } catch (err) {
    logServerError("tables.list", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function createTable(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const { name, locationId, qrSlug } = req.body ?? {};
    if (typeof name !== "string" || typeof locationId !== "string") {
      return res.status(400).json({ message: "name and locationId are required" });
    }
    const table = await tablesService.createTableForBusinessUser(userId, {
      name,
      locationId,
      qrSlug: typeof qrSlug === "string" ? qrSlug : undefined,
    });
    return res.status(201).json(table);
  } catch (err) {
    if (isEntitlementDeniedError(err)) {
      return res.status(err.status).json(err.payload);
    }
    logServerError("tables.create", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}
