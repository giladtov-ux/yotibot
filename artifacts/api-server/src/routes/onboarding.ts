import { Router, type IRouter } from "express";
import { telegramChannelOptions } from "../lib/channel-onboarding.mjs";

const router: IRouter = Router();
router.get("/onboarding/channels", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(telegramChannelOptions());
});
export default router;
