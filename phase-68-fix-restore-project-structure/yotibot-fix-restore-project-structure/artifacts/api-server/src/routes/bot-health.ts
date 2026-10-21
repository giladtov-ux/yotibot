import { Router } from "express";
import { telegramWorkerReady } from "../lib/telegram.functions";

const router = Router();
router.get("/healthz", async (_req, res) => {
  const ready = await telegramWorkerReady();
  res.status(ready ? 200 : 503).json({ ok: ready, service: "ah-sheli-bot", ready });
});
export default router;
