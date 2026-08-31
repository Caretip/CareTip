import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { requireFeature } from "../services/subscriptionEntitlement.service.js";
import * as physicalQrController from "../controllers/physicalQr.controller.js";

const router = Router();
const requirePhysicalOrdering = requireFeature("physicalQrPrinting");

router.use(authMiddleware, requireVerifiedEmail, requireRole(Role.MANAGER));

router.get("/catalog", physicalQrController.listPhysicalQrCatalog);
router.get("/contexts", physicalQrController.listPhysicalQrContexts);
router.post("/contexts/resolve", physicalQrController.resolvePhysicalQrContextEndpoint);
router.get("/orders", physicalQrController.listMyPhysicalQrOrders);
router.get("/orders/:orderId", physicalQrController.getMyPhysicalQrOrder);
router.patch("/orders/:orderId", physicalQrController.patchMyPhysicalQrOrder);
router.post("/orders", requirePhysicalOrdering, physicalQrController.createMyPhysicalQrOrder);
router.post("/orders/batch", requirePhysicalOrdering, physicalQrController.createMyPhysicalQrBatch);
router.post("/orders/batch/checkout", requirePhysicalOrdering, physicalQrController.checkoutMyPhysicalQrBatch);
router.post("/orders/:orderId/checkout", requirePhysicalOrdering, physicalQrController.checkoutMyPhysicalQrOrder);
router.get("/orders/:orderId/print", requirePhysicalOrdering, physicalQrController.printMyPhysicalQrOrder);

export default router;
