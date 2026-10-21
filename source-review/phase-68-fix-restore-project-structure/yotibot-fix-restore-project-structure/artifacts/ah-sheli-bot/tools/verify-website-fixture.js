// Test-only equivalent of a signed private Telegram /start update.
// Never enables a test endpoint or touches a real user's Telegram account.
import { readFileSync } from "node:fs";
import { handleWebsiteRegistration } from "../src/website-registration.js";
import { getPool } from "../src/database.js";
const input = JSON.parse(readFileSync(0, "utf8"));
if (process.env.NODE_ENV === "production" || !/^90000000000000[0-9]{2}$/.test(input.telegram_id)
  || !/^[a-f0-9]{32}$/.test(input.token)) throw new Error("synthetic_development_fixture_required");
let reply = "";
await handleWebsiteRegistration({ message: {
  text: `/start web_${input.token}`, chat: { type: "private", id: Number(input.telegram_id) },
  from: { id: Number(input.telegram_id), first_name: "בדיקת אתר בלבד" },
} }, { sendMessage: async (_id, text) => { reply = text; } });
const { rows } = await getPool().query(
  "SELECT subscription_status FROM public.ah_sheli_telegram_users WHERE telegram_user_id=$1", [input.telegram_id]);
console.log(JSON.stringify({ linked: rows.length === 1, status: rows[0]?.subscription_status,
  verification_code: reply.match(/\b([0-9]{8})\b/)?.[1] }));
await getPool().end();
