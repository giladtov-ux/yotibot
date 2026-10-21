import { Router } from "express";
import { relayTelegramRequest } from "../../../lib/telegram.functions";

const router = Router();
router.post("/public/hooks/send-reminders", async (request, response) => {
  await relayTelegramRequest(request, response, "/api/public/hooks/send-reminders");
});
export default router;
