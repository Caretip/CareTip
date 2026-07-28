import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { clientSafeMessage, logServerError } from "../utils/httpErrors.js";
import { buildBrandedQrImageDto } from "../services/qr/brandedQrRender.service.js";
import { resolveEmployeePublicTipUrl } from "../services/qr/employeeQrUrl.service.js";
import {
  BrandedQrNotFoundError,
  BrandedQrRenderUnavailableError,
} from "../services/qr/brandedQr.errors.js";
import type { BrandedQrErrorDto } from "../services/qr/brandedQr.dto.js";

function resolveAuthUserId(req: Request): string | null {
  return req.user?.sub ?? req.user?.userId ?? req.user?.id ?? null;
}

async function resolveManagerBusinessId(req: Request): Promise<string | null> {
  const userId = resolveAuthUserId(req);
  if (!userId) return null;
  const business = await prisma.business.findFirst({
    where: { userId },
    select: { id: true },
  });
  return business?.id ?? null;
}

function sendBrandedQrError(
  res: Response,
  status: number,
  message: string,
  code: string,
): void {
  const body: BrandedQrErrorDto = { success: false, message, code };
  res.status(status).json(body);
}

/** Manager / business QR studio — branded PNG metadata + image for any venue tip URL. */
export async function getBusinessBrandedQr(req: Request, res: Response): Promise<void> {
  const targetUrl = String(req.query.targetUrl ?? "").trim();
  try {
    const businessId = await resolveManagerBusinessId(req);
    if (!businessId) {
      sendBrandedQrError(res, 403, "Business context required", "BUSINESS_CONTEXT_REQUIRED");
      return;
    }

    if (!targetUrl) {
      sendBrandedQrError(res, 400, "targetUrl query parameter is required", "TARGET_URL_REQUIRED");
      return;
    }

    const payload = await buildBrandedQrImageDto(businessId, targetUrl, "manager");
    res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=3600");
    res.setHeader("ETag", `"${payload.brandingVersion}"`);
    res.setHeader("X-CareTip-Qr-Branding-Version", `"${payload.brandingVersion}"`);
    res.json(payload);
  } catch (err) {
    if (err instanceof BrandedQrNotFoundError) {
      sendBrandedQrError(res, 404, err.message, err.code);
      return;
    }
    if (err instanceof BrandedQrRenderUnavailableError) {
      sendBrandedQrError(res, 503, err.message, err.code);
      return;
    }
    logServerError("qr.getBusinessBrandedQr", err, { targetUrl });
    sendBrandedQrError(
      res,
      500,
      clientSafeMessage(err, "Could not generate branded QR image."),
      "BRANDED_QR_INTERNAL_ERROR",
    );
  }
}

/** Employee My QR — server resolves canonical tip URL; client does not supply targetUrl. */
export async function getEmployeeBrandedQr(req: Request, res: Response): Promise<void> {
  const userId = resolveAuthUserId(req);
  try {
    if (!userId) {
      sendBrandedQrError(res, 401, "Authentication required", "AUTHENTICATION_REQUIRED");
      return;
    }

    const employee = await prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        slug: true,
        businessId: true,
        business: { select: { slug: true } },
      },
    });
    if (!employee) {
      sendBrandedQrError(res, 404, "Employee not found", "EMPLOYEE_NOT_FOUND");
      return;
    }

    const targetUrl = resolveEmployeePublicTipUrl({
      employeeId: employee.id,
      employeeSlug: employee.slug,
      businessSlug: employee.business.slug,
    });

    const payload = await buildBrandedQrImageDto(employee.businessId, targetUrl, "employee");
    res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=3600");
    res.setHeader("ETag", `"${payload.brandingVersion}"`);
    res.setHeader("X-CareTip-Qr-Branding-Version", `"${payload.brandingVersion}"`);
    res.json(payload);
  } catch (err) {
    if (err instanceof BrandedQrNotFoundError) {
      sendBrandedQrError(res, 404, err.message, err.code);
      return;
    }
    if (err instanceof BrandedQrRenderUnavailableError) {
      sendBrandedQrError(res, 503, err.message, err.code);
      return;
    }
    logServerError("qr.getEmployeeBrandedQr", err, { userId });
    sendBrandedQrError(
      res,
      500,
      clientSafeMessage(err, "Could not generate branded QR image."),
      "BRANDED_QR_INTERNAL_ERROR",
    );
  }
}

/** @deprecated Raw PNG alias — prefer JSON `/qr/branded` endpoints. */
export async function getBusinessBrandedQrPng(req: Request, res: Response): Promise<void> {
  await getBusinessBrandedQr(req, res);
}

/** @deprecated Raw PNG alias — prefer JSON `/qr/branded` endpoints. */
export async function getEmployeeBrandedQrPng(req: Request, res: Response): Promise<void> {
  await getEmployeeBrandedQr(req, res);
}
