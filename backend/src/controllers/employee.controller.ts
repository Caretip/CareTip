import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import * as employeeService from "../services/employee.service.js";
import { QR_SCAN_TYPES, recordQrScanEvent } from "../services/qr/qrScanEvent.service.js";
import * as businessService from "../services/business.service.js";
import { kycStatusToLegacyMirror } from "../lib/verificationWorkflow.js";
import {
  GO_LIVE_REQUIRED_CODE,
  GO_LIVE_REQUIRED_MESSAGE,
  hasBusinessVerificationCapability,
} from "../config/businessVerificationCapabilities.js";
import {
  enforceFeatureForRequest,
} from "../services/subscriptionEntitlement.service.js";
import { uploadEmployeeAvatarImage } from "../services/upload.service.js";
import { removeUploadedObjectByPublicUrlIfPossible } from "../lib/supabaseStorageClient.js";
import {
  logServerError,
  clientSafeMessage,
  CLIENT_FALLBACK,
} from "../utils/httpErrors.js";

const VERIFICATION_REQUIRED_MSG = "QR code will be available after business verification.";

/** JSON body may send "" for cleared selects — treat as null for FK fields. */
function parseLocationIdFromBody(body: { locationId?: unknown }): string | null | undefined {
  if (body.locationId === undefined) return undefined;
  if (body.locationId === null) return null;
  const s = String(body.locationId).trim();
  return s === "" ? null : s;
}

export async function ensureMySlug(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const profile = await employeeService.ensureEmployeeSlugForUser(userId);
    return res.json(profile);
  } catch (err) {
    logServerError("employee.ensureMySlug", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg === VERIFICATION_REQUIRED_MSG) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function getMyProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const profile = await employeeService.getEmployeeProfileForUser(userId);
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }
    return res.json(profile);
  } catch (err) {
    logServerError("employee.getMyProfile", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function patchMyProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const { name, bio, monthlyGoal, emailNotifications, pushNotifications, phone } = req.body;
    if (monthlyGoal !== undefined) {
      if (monthlyGoal !== null) {
        const n = Number(monthlyGoal);
        if (Number.isNaN(n) || n < 0) {
          return res.status(400).json({ message: "Monthly goal must be a non-negative number" });
        }
      }
      if (!(await enforceFeatureForRequest(req, res, "employeeGoals"))) {
        return;
      }
    }
    const updated = await employeeService.updateEmployeeSelf(userId, {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(bio !== undefined ? { bio: bio === null ? null : String(bio) } : {}),
      ...(monthlyGoal !== undefined
        ? { monthlyGoal: monthlyGoal === null ? null : Number(monthlyGoal) }
        : {}),
      ...(phone !== undefined ? { phone: String(phone).trim() || null } : {}),
      ...(emailNotifications !== undefined ? { emailNotifications: Boolean(emailNotifications) } : {}),
      ...(pushNotifications !== undefined ? { pushNotifications: Boolean(pushNotifications) } : {}),
    });
    if (pushNotifications === false) {
      const { removeAllPushDeviceTokensForUser } = await import(
        "../services/push/pushNotification.service.js"
      );
      await removeAllPushDeviceTokensForUser(userId);
    }
    return res.json(updated);
  } catch (err) {
    logServerError("employee.patchMyProfile", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function uploadMyAvatar(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "Image file is required (field name: avatar)" });
    }
    const url = await uploadEmployeeAvatarImage(file.buffer, file.mimetype);
    try {
      const result = await employeeService.setEmployeeAvatarUrl(userId, url);
      return res.json(result);
    } catch (dbErr) {
      await removeUploadedObjectByPublicUrlIfPossible(url);
      throw dbErr;
    }
  } catch (err) {
    logServerError("employee.uploadMyAvatar", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't upload your photo. Please try again."),
    });
  }
}

export async function exportMyData(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const data = await employeeService.exportEmployeeData(userId);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="caretip-my-data-${dateStr}.json"`);
    return res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    logServerError("employee.exportMyData", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't export your data. Please try again."),
    });
  }
}

export async function deleteMyAccount(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    await employeeService.deleteEmployeeAccount(userId);
    return res.status(204).send();
  } catch (err) {
    logServerError("employee.deleteMyAccount", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't delete your account. Please try again."),
    });
  }
}

export async function getEmployees(req: Request, res: Response) {
  try {
    const businessId = req.query.businessId ?? req.params.businessId;
    if (!businessId || typeof businessId !== "string") {
      return res.status(400).json({ message: "businessId is required" });
    }

    const uid = req.user?.userId ?? req.user?.id;
    let managerOwnsBusiness = false;
    if (uid && req.user?.role === Role.MANAGER) {
      const owned = await prisma.business.findUnique({
        where: { userId: uid },
        select: { id: true },
      });
      managerOwnsBusiness = owned?.id === businessId;
    }

    if (!managerOwnsBusiness) {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { kycVerificationStatus: true, onboardingVerificationStatus: true },
      });
      if (
        !business ||
        !hasBusinessVerificationCapability(
          kycStatusToLegacyMirror(business.kycVerificationStatus),
          "activateTipping",
          {
            onboardingVerificationStatus: business.onboardingVerificationStatus,
          },
        )
      ) {
        return res.status(403).json({
          message: GO_LIVE_REQUIRED_MESSAGE,
          code: GO_LIVE_REQUIRED_CODE,
        });
      }
    }

    const employees = await employeeService.getEmployeesByBusinessId(businessId);
    return res.json(employees);
  } catch (err) {
    logServerError("employee.getEmployees", err);
    return res.status(404).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function getEmployeeById(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    const trimmed = employeeId.trim();
    const employee = await employeeService.getEmployeeById(trimmed);
    if (!employee) {
      console.warn("[employee.getEmployeeById] not resolved", { scannedRouteId: trimmed });
      return res.status(404).json({ message: "Staff member not found" });
    }
    recordQrScanEvent({
      businessId: employee.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
      employeeId: employee.id,
      req,
    });
    return res.json(employee);
  } catch (err) {
    logServerError("employee.getEmployeeById", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg === VERIFICATION_REQUIRED_MSG) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function updateEmployee(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can update employees" });
    }
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    const { name, role, jobTitle, monthlyGoal, isActive, email, locationId, tableIds } = req.body;
    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (tableIds !== undefined && !Array.isArray(tableIds)) {
      return res.status(400).json({ message: "tableIds must be an array" });
    }
    if (monthlyGoal !== undefined) {
      if (!(await enforceFeatureForRequest(req, res, "employeeGoals"))) {
        return;
      }
    }
    const tableIdList =
      tableIds === undefined
        ? []
        : (tableIds as unknown[]).map((x) => String(x).trim()).filter((id) => id.length > 0);
    if (tableIdList.length > 0) {
      if (!(await enforceFeatureForRequest(req, res, "tableQr"))) {
        return;
      }
    }
    const updated = await employeeService.updateEmployeeForBusiness(business.id, employeeId.trim(), {
      name,
      jobTitle: role ?? jobTitle,
      monthlyGoal:
        monthlyGoal === undefined
          ? undefined
          : monthlyGoal === null
            ? null
            : Number(monthlyGoal),
      isActive,
      email,
      ...(locationId !== undefined
        ? {
            locationId:
              locationId === null
                ? null
                : (() => {
                    const s = String(locationId).trim();
                    return s === "" ? null : s;
                  })(),
          }
        : {}),
      ...(tableIds !== undefined
        ? {
            tableIds: tableIdList,
          }
        : {}),
    });
    return res.json(updated);
  } catch (err) {
    logServerError("employee.updateEmployee", err);
    const msg = err instanceof Error ? err.message : "";
    const status = msg === "Employee not found" ? 404 : 400;
    return res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function patchEmployeeStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can update employees" });
    }
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    const isActive = (req.body as { isActive?: unknown })?.isActive;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }

    const updated = await employeeService.updateEmployeeActiveStatusForBusiness(
      business.id,
      employeeId.trim(),
      isActive
    );
    return res.json(updated);
  } catch (err) {
    logServerError("employee.patchEmployeeStatus", err);
    const msg = err instanceof Error ? err.message : "";
    const status = msg === "Employee not found" ? 404 : 400;
    return res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function ensureMissingEmployeeSlugs(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can update employees" });
    }
    const result = await employeeService.ensureMissingEmployeeSlugsForBusiness(business.id);
    return res.json(result);
  } catch (err) {
    logServerError("employee.ensureMissingEmployeeSlugs", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg === VERIFICATION_REQUIRED_MSG) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function ensureEmployeeSlug(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can update employees" });
    }
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    const updated = await employeeService.ensureEmployeeSlugForBusiness(
      business.id,
      employeeId.trim(),
    );
    return res.json(updated);
  } catch (err) {
    logServerError("employee.ensureEmployeeSlug", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg === VERIFICATION_REQUIRED_MSG) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    const status = msg === "Employee not found" ? 404 : 400;
    return res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function regenerateEmployeeSlug(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can update employees" });
    }
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    const updated = await employeeService.regenerateEmployeeSlugForBusiness(
      business.id,
      employeeId.trim()
    );
    return res.json(updated);
  } catch (err) {
    logServerError("employee.regenerateEmployeeSlug", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg === VERIFICATION_REQUIRED_MSG) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    const status = msg === "Employee not found" ? 404 : 400;
    return res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function deleteEmployee(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can remove employees" });
    }
    const { employeeId } = req.params;
    if (!employeeId?.trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }
    await employeeService.deleteEmployeeForBusiness(business.id, employeeId.trim());
    return res.status(204).send();
  } catch (err) {
    logServerError("employee.deleteEmployee", err);
    const msg = err instanceof Error ? err.message : "";
    const status = msg === "Employee not found" ? 404 : 500;
    return res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function createEmployee(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Only business owners can add employees" });
    }
    const { name, role, email, phone } = req.body;
    if (req.body.tableIds !== undefined && !Array.isArray(req.body.tableIds)) {
      return res.status(400).json({ message: "tableIds must be an array" });
    }
    const tableIdList =
      req.body.tableIds === undefined
        ? []
        : (req.body.tableIds as unknown[])
            .map((x) => String(x).trim())
            .filter((id: string) => id.length > 0);
    if (tableIdList.length > 0) {
      if (!(await enforceFeatureForRequest(req, res, "tableQr"))) {
        return;
      }
    }
    const jobTitle = role ?? req.body.jobTitle;
    const explicitLocale =
      typeof req.body.locale === "string" && req.body.locale.trim()
        ? String(req.body.locale).trim()
        : undefined;
    const acceptLanguage = req.get("accept-language") ?? undefined;
    const employee = await employeeService.createEmployeeWithActivation({
      name: name ?? "",
      jobTitle: jobTitle ?? "Staff",
      email: email ?? "",
      phone: phone ? String(phone).trim() : undefined,
      businessId: business.id,
      locationId: parseLocationIdFromBody(req.body),
      tableIds:
        req.body.tableIds === undefined
          ? undefined
          : tableIdList,
      explicitLocale,
      acceptLanguage,
    });
    const { activationToken: _token, ...safe } = employee;
    return res.status(201).json(safe);
  } catch (err) {
    logServerError("employee.createEmployee", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}
