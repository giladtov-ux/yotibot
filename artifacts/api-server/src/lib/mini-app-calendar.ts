import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { initializeMiniAppStorage } from "./mini-app-data";

type GoogleTokens = { access_token?: string; refresh_token?: string; expires_at?: number };
export function googleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    && process.env.SESSION_SECRET);
}
function key() {
  if (!process.env.SESSION_SECRET) throw new Error("calendar_encryption_unavailable");
  return createHash("sha256").update("ah-sheli-calendar\n").update(process.env.SESSION_SECRET).digest();
}
function encrypt(tokens: GoogleTokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
function decrypt(value: string): GoogleTokens {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const publishedCalendarCallback = "https://ah-sheli-telegram-bot.replit.app/api/mini-app/calendar/callback";
export function googleCalendarCallbackUrl() {
  // Fixed in every runtime; neither request headers nor environment overrides
  // can change the canonical public callback.
  return publishedCalendarCallback;
}
async function exchange(values: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...values, client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET! }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof result.access_token !== "string") throw new Error("google_authorization_failed");
  return { access_token: result.access_token,
    refresh_token: typeof result.refresh_token === "string" ? result.refresh_token : undefined,
    expires_at: Date.now() + Math.max(0, Number(result.expires_in) || 3600) * 1000 } as GoogleTokens;
}
async function saveTokens(id: string, tokens: GoogleTokens) {
  await pool.query(`INSERT INTO ah_sheli_google_calendar(telegram_user_id,credentials) VALUES($1,$2)
    ON CONFLICT(telegram_user_id) DO UPDATE SET credentials=EXCLUDED.credentials,updated_at=NOW()`, [id, encrypt(tokens)]);
}
export async function calendarStatus(id: string) {
  await initializeMiniAppStorage();
  const { rows } = await pool.query("SELECT 1 FROM ah_sheli_google_calendar WHERE telegram_user_id=$1", [id]);
  return { configured: googleCalendarConfigured(), connected: rows.length > 0 };
}
export async function calendarConnectUrl(id: string) {
  if (process.env.NODE_ENV === "development") {
    throw Object.assign(new Error("calendar_production_required"), { status: 409 });
  }
  if (!googleCalendarConfigured()) throw Object.assign(new Error("calendar_not_configured"), { status: 503 });
  const redirectUri = googleCalendarCallbackUrl();
  await initializeMiniAppStorage();
  const state = randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM ah_sheli_google_oauth_states WHERE expires_at<NOW()");
  await pool.query(`INSERT INTO ah_sheli_google_oauth_states(digest,telegram_user_id,expires_at)
    VALUES($1,$2,NOW()+INTERVAL '10 minutes')`, [digest(state), id]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, redirect_uri: redirectUri,
    response_type: "code", scope: "https://www.googleapis.com/auth/calendar.events.readonly",
    access_type: "offline", prompt: "consent", state,
  }).toString();
  return url.href;
}
export async function calendarOAuthCallback(state: string, code: string) {
  if (!googleCalendarConfigured() || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) {
    throw new Error("invalid_oauth_return");
  }
  await initializeMiniAppStorage();
  const { rows } = await pool.query(`DELETE FROM ah_sheli_google_oauth_states
    WHERE digest=$1 AND expires_at>NOW() RETURNING telegram_user_id`, [digest(state)]);
  if (rows.length !== 1) throw new Error("invalid_oauth_state");
  const tokens = await exchange({ code, grant_type: "authorization_code", redirect_uri: googleCalendarCallbackUrl() });
  await saveTokens(rows[0].telegram_user_id, tokens);
}
async function tokenFor(id: string) {
  const { rows } = await pool.query("SELECT credentials FROM ah_sheli_google_calendar WHERE telegram_user_id=$1", [id]);
  if (!rows.length) throw Object.assign(new Error("calendar_not_connected"), { status: 409 });
  const tokens = decrypt(rows[0].credentials);
  if ((tokens.expires_at ?? 0) < Date.now() + 60_000) {
    if (!tokens.refresh_token) throw Object.assign(new Error("calendar_reconnect_required"), { status: 409 });
    const refreshed = await exchange({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
    refreshed.refresh_token ??= tokens.refresh_token;
    await saveTokens(id, refreshed);
    return refreshed.access_token!;
  }
  return tokens.access_token!;
}
export async function calendarEvents(id: string, start: string, end: string) {
  const from = new Date(start).getTime(), to = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 93 * 86_400_000) {
    throw Object.assign(new Error("invalid_calendar_range"), { status: 400 });
  }
  const token = await tokenFor(id);
  const events: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }> = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.search = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "2500", ...(pageToken ? { pageToken } : {}) }).toString();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw Object.assign(new Error("calendar_fetch_failed"), { status: response.status === 401 ? 409 : 503 });
    const result = await response.json() as {
      items?: Array<{ id: string; summary?: string; status?: string;
        start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }>;
      nextPageToken?: string;
    };
    for (const event of result.items ?? []) {
      if (event.status === "cancelled" || !event.start || !event.end) continue;
      events.push({ id: event.id, title: event.summary || "אירוע ללא כותרת",
        start: event.start.dateTime || event.start.date || "", end: event.end.dateTime || event.end.date || "",
        allDay: Boolean(event.start.date) });
    }
    pageToken = result.nextPageToken ?? "";
    if (events.length > 20_000) throw new Error("calendar_range_too_large");
  } while (pageToken);
  return events;
}
export async function disconnectCalendar(id: string) {
  const { rows } = await pool.query("DELETE FROM ah_sheli_google_calendar WHERE telegram_user_id=$1 RETURNING credentials", [id]);
  await pool.query("DELETE FROM ah_sheli_google_oauth_states WHERE telegram_user_id=$1", [id]);
  if (!rows.length) return;
  try {
    const tokens = decrypt(rows[0].credentials);
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token ?? "" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* Local credentials are already removed; no further Google access is possible. */ }
}
