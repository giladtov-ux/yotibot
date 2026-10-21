import { Router, type IRouter } from "express";
import healthRouter from "./health";
import telegramRouter from "./public/telegram/webhook";
import reminderRouter from "./public/hooks/send-reminders";
import billingRouter from "./billing";
import miniAppRouter from "./mini-app";
import onboardingRouter from "./onboarding";
import emailAuthRouter from "./email-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(telegramRouter);
router.use(reminderRouter);
router.use(billingRouter);
router.use(emailAuthRouter);
router.use(miniAppRouter);
router.use(onboardingRouter);

export default router;
