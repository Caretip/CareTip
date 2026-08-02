import { Router } from "express";
import * as qrScanController from "../controllers/qrScan.controller.js";

const router = Router();

/** Phase 3 — sole entry point for guest QR scan analytics. */
router.post("/scan", qrScanController.recordGuestScan);

export default router;
