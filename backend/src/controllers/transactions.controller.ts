import type { Request, Response } from "express";
import json2csv from "json2csv";
import { DateTime } from "luxon";
import * as businessService from "../services/business.service.js";
import { sanitizeIanaTimezone } from "../utils/businessTime.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";

export async function exportTransactions(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const tz = sanitizeIanaTimezone((business as { timezone?: string | null }).timezone);
    const tips = await businessService.getTipsForExport(business.id);
    const rows = tips.map((t) => {
      // tips.created_at is naive UTC wall time; project to venue local for SSOT day labels.
      const local = DateTime.fromJSDate(t.createdAt, { zone: "utc" }).setZone(tz);
      return {
        tip_id: t.id,
        amount: Number(t.amount).toFixed(2),
        status: t.status,
        created_at_utc: t.createdAt.toISOString(),
        created_at_local: local.toFormat("yyyy-MM-dd HH:mm:ss"),
        created_at_local_day: local.toFormat("yyyy-MM-dd"),
        timezone: tz,
        employee_id: t.employeeId,
        employee_name: t.employee.name,
        job_title: t.employee.jobTitle,
        stripe_payment_intent_id: t.stripePaymentIntentId ?? "",
        business_name: business.name,
      };
    });

    const fields = [
      "tip_id",
      "amount",
      "status",
      "created_at_utc",
      "created_at_local",
      "created_at_local_day",
      "timezone",
      "employee_id",
      "employee_name",
      "job_title",
      "stripe_payment_intent_id",
      "business_name",
    ];
    const csv = json2csv.parse(rows, { fields });
    const dateStr = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");
    const filename = `CareTip_Transactions_${dateStr}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv);
  } catch (err) {
    logServerError("transactions.export", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.exportCsv),
    });
  }
}
