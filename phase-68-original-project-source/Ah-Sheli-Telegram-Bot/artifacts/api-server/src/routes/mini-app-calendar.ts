import { Router, type IRouter, type Request, type Response } from "express";
import { calendarStatus, calendarConnectUrl, calendarOAuthCallback, calendarEvents,
  disconnectCalendar, googleCalendarCallbackUrl } from "../lib/mini-app-calendar";

const router: IRouter = Router();
function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof Error && error.message === "calendar_production_required") {
    res.status(409).json({ error: "calendar_production_required",
      message: "לחיבור היומן פתח את האפליקציה הפעילה: https://ah-sheli-telegram-bot.replit.app/app.html" });
    return;
  }
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
  req.log.warn({ code: "mini_app_calendar_failed" }, "Mini App calendar request unavailable");
  res.status([400, 409, 503].includes(status) ? status : 503).json({
    error: status === 409 ? "calendar_reconnect_required" : "calendar_unavailable",
    message: status === 409 ? "צריך לחבר את היומן מחדש." : "החיבור ליומן לא זמין כרגע. נסה שוב עוד רגע.",
  });
}
router.get("/status", async (req, res) => {
  try { res.json(await calendarStatus(res.locals.miniAppIdentity.id)); }
  catch (error) { failure(req, res, error); }
});
router.post("/connect", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const url = await calendarConnectUrl(res.locals.miniAppIdentity.id);
    // Do not log the full authorization link: it contains private OAuth state.
    req.log.info({ code: "calendar_oauth_link_created",
      redirectUri: new URL(url).searchParams.get("redirect_uri") }, "Calendar OAuth callback selected");
    res.json({ url });
  }
  catch (error) { failure(req, res, error); }
});
router.get("/events", async (req, res) => {
  try {
    if (typeof req.query.start !== "string" || typeof req.query.end !== "string") {
      res.status(400).json({ error: "invalid_calendar_range" }); return;
    }
    res.json(await calendarEvents(res.locals.miniAppIdentity.id, req.query.start, req.query.end));
  } catch (error) { failure(req, res, error); }
});
router.post("/disconnect", async (req, res) => {
  try { await disconnectCalendar(res.locals.miniAppIdentity.id); res.sendStatus(204); }
  catch (error) { failure(req, res, error); }
});
export async function handleCalendarReturn(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");
  try {
    await calendarOAuthCallback(typeof req.query.state === "string" ? req.query.state : "",
      typeof req.query.code === "string" ? req.query.code : "");
    res.redirect(303, "/calendar-connected.html");
  } catch {
    req.log.warn({ code: "calendar_oauth_return_rejected" }, "Calendar OAuth return rejected");
    res.redirect(303, "/calendar-connected.html?error=1");
  }
}
// Public, read-only diagnostics: no identity, credentials or OAuth state exposed.
export function handleCalendarConfiguration(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");
  try { res.json({ redirectUri: googleCalendarCallbackUrl() }); }
  catch (error) { failure(req, res, error); }
}
export default router;
