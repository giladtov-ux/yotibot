import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { buildInfo } from "../lib/build-info";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  // Service liveness must not depend on the optional Telegram worker.
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({ ...data, build: buildInfo });
});

export default router;
