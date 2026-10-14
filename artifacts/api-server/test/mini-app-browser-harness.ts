// Local-only browser fixture. It uses synthetic Telegram credentials, an
// in-memory SQL adapter and the REAL API/router/worker mutation code.
// It never starts the Telegram worker or touches a real database/Telegram API.
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";

process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic";
process.env.TELEGRAM_BOT_TOKEN = "synthetic-mini-app-browser-token";
process.env.AH_SHELI_DATA_DIR = await mkdtemp(join(tmpdir(), "ah-sheli-browser-"));
const { pool } = await import("@workspace/db");
const { createEmptyStore, initializeStatePersistence } = await import("../../ah-sheli-bot/src/store.js");
const { applyMiniAppAction, verifyMiniAppRequest } = await import("../../ah-sheli-bot/src/mini-app-actions.js");
const store = createEmptyStore();
store.lists["123"] = {
  קניות: [{ id: "shopping1", text: "חלב", checked: false }],
  קישורים: [{ id: "link1", text: "https://example.com", checked: false }],
  משימות: [{ id: "task1", text: "להכין תיק", checked: false }],
  מטרות: [{ id: "goal1", text: "לקרוא ספר", checked: false }],
};
store.lists["456"] = { קניות: [{ id: "foreign1", text: "פריט פרטי של משתמש אחר", checked: false }] };
store.reminders = [{ id: "one-time", chatId: "123", text: "תזכורת בדיקה", createdAt: Date.now(),
  dueAt: Date.now() + 86_400_000 }, { id: "foreign-reminder", chatId: "456", text: "תזכורת פרטית",
  createdAt: Date.now(), dueAt: Date.now() + 86_400_000 }];
let snapshot = structuredClone(store);
const profiles = new Map<string, Record<string, unknown>>();
const query = async (sql: string, values: any[] = []) => {
  if (sql.includes("SELECT value FROM ah_sheli_config")) return { rows: [{ value: "123" }] };
  if (sql.includes("FROM ah_sheli_telegram_users")) return { rows: values[0] === "456"
    ? [{ display_name: "משתמש אחר", subscription_status: "active", subscription_expires_at: new Date(Date.now() + 86_400_000) }] : [] };
  if (sql.includes("SELECT value FROM ah_sheli_state")) return { rows: [{ value: snapshot }] };
  if (sql.includes("INSERT INTO ah_sheli_state")) {
    snapshot = typeof values[0] === "string" ? JSON.parse(values[0]) : structuredClone(values[0]);
    return { rows: [] };
  }
  if (sql.includes("SELECT name, gender")) return { rows: profiles.has(values[0]) ? [profiles.get(values[0])] : [] };
  if (sql.includes("INSERT INTO ah_sheli_mini_app_profiles")) {
    profiles.set(values[0], { name: values[1], gender: values[2], language: values[3], timezone: values[4] });
    return { rows: [] };
  }
  if (sql.includes("SELECT 1 FROM ah_sheli_google_calendar")) return { rows: [] };
  if (/^(BEGIN|COMMIT|ROLLBACK|CREATE TABLE)/.test(sql.trim())) return { rows: [] };
  throw new Error(`Unexpected fixture SQL: ${sql.slice(0, 90)}`);
};
Object.assign(pool, { query, connect: async () => ({ query, release() {} }) });
await initializeStatePersistence(store, pool);
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, options: any) => {
  const url = String(input);
  if (url === "http://127.0.0.1:18081/healthz") return Response.json({ service: "ah-sheli-bot", ready: true });
  if (url === "http://127.0.0.1:18081/api/internal/mini-app") {
    const body = JSON.parse(options.body);
    if (!verifyMiniAppRequest(body, options.headers["x-ah-sheli-auth"], process.env.TELEGRAM_BOT_TOKEN)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      await applyMiniAppAction(store, body.userId, body.action);
      return Response.json({ ok: true });
    } catch (error: any) {
      return Response.json({ error: "invalid_action", message: error.message }, { status: error.status ?? 503 });
    }
  }
  throw new Error("External requests are prohibited in the browser fixture");
};
const { default: miniAppRouter } = await import("../src/routes/mini-app");
const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.locals = {};
  (_req as any).log = { warn() {} };
  next();
});
function proof(id: number) {
  const values = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "משתמש בדיקה" }) });
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  const check = [...values].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${key}=${value}`).join("\n");
  values.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return values.toString();
}
app.get("/test/init-data", (req, res) => res.json({ initData: proof(req.query.user === "other" ? 456 : 123) }));
app.get("/test/snapshot", (_req, res) => res.json(snapshot));
app.use("/api", miniAppRouter);
app.use(express.static(resolve("public")));
app.listen(18085, "127.0.0.1", () => console.log("Synthetic Mini App browser fixture listening on 18085"));
process.once("SIGTERM", () => { globalThis.fetch = realFetch; process.exit(0); });
