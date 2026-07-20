import { Router } from "express";
import * as tippingContextController from "../controllers/tippingContext.controller.js";
import { tippingContextQrSlugLimiter } from "../middleware/tippingContextQrSlugRateLimit.middleware.js";

const router = Router();

/** Public — must be registered before `/:qrSlug` so "location" is not captured as a slug. */
router.get("/location/:locationId", tippingContextController.getLocationById);
router.get("/table/:tableId", tippingContextController.getTableById);

router.get("/:qrSlug", tippingContextQrSlugLimiter, tippingContextController.getByQrSlug);

export default router;
