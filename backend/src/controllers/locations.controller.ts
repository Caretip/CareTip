import type { Request, Response } from "express";
import * as locationsService from "../services/locations.service.js";
import type { LocationReviewLinkPatch } from "../services/locations.service.js";
import { isEntitlementDeniedError } from "../services/subscriptionEntitlement.service.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import {
  INVALID_GOOGLE_PLACE_ID,
  INVALID_TRIPADVISOR_REVIEW_URL,
} from "../lib/externalReviewLinks.js";

function optionalBodyString(
  body: Record<string, unknown>,
  key: string,
  invalidMessage: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw new Error(invalidMessage);
  }
  return raw;
}

function reviewLinksFromBody(body: unknown): LocationReviewLinkPatch | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  const patch: LocationReviewLinkPatch = {};
  if ("googlePlaceId" in rec) {
    patch.googlePlaceId = optionalBodyString(rec, "googlePlaceId", INVALID_GOOGLE_PLACE_ID) ?? null;
  }
  if ("tripadvisorReviewUrl" in rec) {
    patch.tripadvisorReviewUrl =
      optionalBodyString(rec, "tripadvisorReviewUrl", INVALID_TRIPADVISOR_REVIEW_URL) ?? null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export async function listLocations(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const locations = await locationsService.listLocationsForBusinessUser(userId);
    return res.json(locations);
  } catch (err) {
    logServerError("locations.list", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function createLocation(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const name = req.body?.name;
    if (typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }
    const description =
      typeof req.body?.description === "string" ? req.body.description : undefined;
    const location = await locationsService.createLocationForBusinessUser(
      userId,
      name,
      description,
      reviewLinksFromBody(req.body),
    );
    return res.status(201).json(location);
  } catch (err) {
    if (isEntitlementDeniedError(err)) {
      return res.status(err.status).json(err.payload);
    }
    logServerError("locations.create", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const locationId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!locationId) {
      return res.status(400).json({ message: "Location id is required" });
    }
    const name = req.body?.name;
    if (typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }
    const description =
      typeof req.body?.description === "string"
        ? req.body.description
        : req.body?.description === null
          ? ""
          : undefined;
    const location = await locationsService.updateLocationForBusinessUser(
      userId,
      locationId,
      name,
      description,
      reviewLinksFromBody(req.body),
    );
    return res.json(location);
  } catch (err) {
    logServerError("locations.update", err);
    const message = clientSafeMessage(err, CLIENT_FALLBACK.business);
    const status = message === "Location not found" ? 404 : 400;
    return res.status(status).json({ message });
  }
}

export async function deleteLocation(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const locationId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!locationId) {
      return res.status(400).json({ message: "Location id is required" });
    }
    await locationsService.deleteLocationForBusinessUser(userId, locationId);
    return res.status(204).send();
  } catch (err) {
    logServerError("locations.delete", err);
    const message = clientSafeMessage(err, CLIENT_FALLBACK.business);
    const status = message === "Location not found" ? 404 : 400;
    return res.status(status).json({ message });
  }
}
