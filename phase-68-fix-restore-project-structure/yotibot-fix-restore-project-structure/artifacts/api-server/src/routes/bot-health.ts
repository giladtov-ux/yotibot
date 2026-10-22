import { Router } from "express";
import { telegramWorkerReady } from "../lib/telegram.functions";

const router = Router();
router.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "ah-sheli-api" });
});

// Separate diagnostic endpoint. It only probes the internal worker and never starts it.
router.get("/worker-healthz", async (_req, res) => {
  const ready = await telegramWorkerReady();
  res.status(ready ? 200 : 503).json({ ok: ready, service: "ah-sheli-bot", ready });
});
export default router;
