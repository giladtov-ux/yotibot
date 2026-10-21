import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { RunMiniAppActionBody, UpdateMiniAppProfileBody } from "@workspace/api-zod";
import { validateTelegramInitData, signMiniAppRequest } from "../lib/mini-app-auth";
import { authorizedMiniAppUser, miniAppData, miniAppProfile, miniAppTasks, type MiniAppIdentity } from "../lib/mini-app-data";
import { BOT_INTERNAL_PORT } from "../lib/telegram.functions";
import calendarRouter, { handleCalendarReturn, handleCalendarConfiguration } from "./mini-app-calendar";
import { emailMiniAppIdentity, sameOriginMutation } from "../lib/email-identity";
import sharingRouter from "./mini-app-sharing";
import { sharedLists } from "../lib/mini-app-sharing";
import { createHash } from "node:crypto";

const router: IRouter = Router();
// Google returns in the external browser, not with Telegram's Authorization header.
// The callback authenticates via a random, expiring, atomically consumed OAuth state.
router.get("/mini-app/calendar/callback", handleCalendarReturn);
router.get("/mini-app/calendar/config", handleCalendarConfiguration);
router.use(["/mini-app", "/tasks"], async (req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "no-store");
  try {
    const authorization = req.get("authorization") ?? "";
    const actor = validateTelegramInitData(authorization.startsWith("tma ") ? authorization.slice(4) : "",
      process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "");
    if (authorization.startsWith("tma ") && !actor) {
      res.status(401).json({ error: "invalid_telegram_auth", message: "פתח מחדש את האפליקציה מתוך הבוט." }); return;
    }
    if (!sameOriginMutation(req)) { res.status(403).json({ error: "invalid_origin" }); return; }
    const identity = actor ? await authorizedMiniAppUser(actor) : await emailMiniAppIdentity(req);
    if (!actor && !identity) { res.status(401).json({ error: "account_link_required", message: "התחבר בדוא״ל וקשר את חשבון הטלגרם שלך." }); return; }
    if (!identity) { res.status(403).json({ error: "access_required", message: "צריך גישה פעילה כדי לפתוח את הנתונים שלך." }); return; }
    res.locals.miniAppIdentity = identity;
    next();
  } catch {
    req.log.warn({ code: "mini_app_auth_unavailable" }, "Mini App authentication unavailable");
    res.status(503).json({ error: "service_unavailable", message: "החיבור לא זמין כרגע. נסה שוב עוד רגע." });
  }
});
router.get("/mini-app/changes", async (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let revision = "", busy = false, closed = false;
  const identity = res.locals.miniAppIdentity as MiniAppIdentity;
  const refresh = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      if (!await authorizedMiniAppUser({ id: identity.id, name: identity.name })) { res.end(); return; }
      const data = await miniAppData(identity);
      const shares = await sharedLists(identity.id);
      const nextRevision = createHash("sha256").update(JSON.stringify([data, shares])).digest("hex");
      if (revision !== nextRevision) {
        revision = nextRevision;
        res.write(`event: change\ndata: ${JSON.stringify({ revision })}\n\n`);
      } else res.write(": heartbeat\n\n");
    } catch { res.write("event: unavailable\ndata: {}\n\n"); }
    finally { busy = false; }
  };
  const interval = setInterval(refresh, 2000);
  interval.unref();
  // Re-authenticate the stream regularly, including expired/revoked cookies.
  const expiry = setTimeout(() => res.end(), 60_000);
  expiry.unref();
  res.on("close", () => { closed = true; clearInterval(interval); clearTimeout(expiry); });
  await refresh();
});
router.get("/tasks", async (_req, res) => {
  try { res.json(await miniAppTasks(res.locals.miniAppIdentity)); }
  catch { res.status(503).json({ error: "data_unavailable", message: "לא הצלחתי לטעון את המשימות כרגע. נסה שוב." }); }
});
router.get("/mini-app/data", async (_req, res) => {
  try { res.json(await miniAppData(res.locals.miniAppIdentity)); }
  catch { res.status(503).json({ error: "data_unavailable", message: "הנתונים שלך שמורים, אבל כרגע אי אפשר לטעון אותם. נסה שוב." }); }
});
router.patch("/mini-app/profile", async (req, res) => {
  const parsed = UpdateMiniAppProfileBody.strict().safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "invalid_profile", message: "בדוק את פרטי הפרופיל." }); return;
  }
  try { new Intl.DateTimeFormat("he", { timeZone: parsed.data.timezone }); }
  catch { res.status(400).json({ error: "invalid_timezone", message: "בחר אזור זמן תקין." }); return; }
  try {
    const identity = res.locals.miniAppIdentity as MiniAppIdentity;
    await miniAppProfile(identity);
    const { name, gender, language, timezone } = parsed.data;
    await pool.query(`INSERT INTO ah_sheli_mini_app_profiles(telegram_user_id,name,gender,language,timezone)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(telegram_user_id) DO UPDATE SET
      name=EXCLUDED.name,gender=EXCLUDED.gender,language=EXCLUDED.language,timezone=EXCLUDED.timezone,updated_at=NOW()`,
      [identity.id, name.trim(), gender, language, timezone]);
    res.json(await miniAppProfile(identity));
  } catch { res.status(503).json({ error: "save_failed", message: "לא הצלחתי לשמור כרגע. נסה שוב." }); }
});
router.post("/mini-app/action", async (req, res) => {
  const parsed = RunMiniAppActionBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid_action", message: "בדוק את הפרטים ונסה שוב." }); return; }
  try {
    const health = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
    const worker = await health.json() as { service?: string; ready?: boolean };
    if (!health.ok || worker.service !== "ah-sheli-bot" || worker.ready !== true) throw new Error("worker_unavailable");
    const body = { userId: res.locals.miniAppIdentity.id, timestamp: Date.now(), action: parsed.data };
    const upstream = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}/api/internal/mini-app`, {
      method: "POST", headers: { "content-type": "application/json",
        "x-ah-sheli-auth": signMiniAppRequest(body, process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "") },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000),
    });
    if (!upstream.ok) {
      const failure = await upstream.json() as { error?: string; message?: string };
      res.status(upstream.status).json({ error: failure.error, message: failure.message ?? "לא הצלחתי לשמור כרגע. נסה שוב." });
      return;
    }
    res.json(await miniAppData(res.locals.miniAppIdentity));
  } catch { res.status(503).json({
    error: "bot_unavailable", message: "לא התקבל אישור שמירה. רענן את הנתונים לפני ניסיון נוסף.",
  }); }
});
router.use("/mini-app/calendar", calendarRouter);
router.use("/mini-app/shares", sharingRouter);
export default router;
