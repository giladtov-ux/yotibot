import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { telegramWorkerReady } from "../lib/telegram.functions";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  if (process.env.NODE_ENV === "production" && !await telegramWorkerReady()) {
    res.status(503).json({ status: "starting" });
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
