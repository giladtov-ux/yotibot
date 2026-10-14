import { Router } from "express";
import { relayTelegramRequest } from "../../../lib/telegram.functions";

const router = Router();
router.post(["/telegram/webhook", "/public/telegram/webhook"], async (request, response) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    response.status(400).json({ ok: false });
    return;
  }
  let webhookPath = "/telegram/webhook";
  try {
    if (process.env.TELEGRAM_WEBHOOK_URL) {
      webhookPath = new URL(process.env.TELEGRAM_WEBHOOK_URL).pathname;
    }
  } catch {
    response.status(503).json({ ok: false, error: "invalid_webhook_configuration" });
    return;
  }
  await relayTelegramRequest(request, response, webhookPath);
});
export default router;
