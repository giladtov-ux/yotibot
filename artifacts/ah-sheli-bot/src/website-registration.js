import { createHash, createHmac, randomInt } from "node:crypto";
import { getPool } from "./database.js";

// A new /start payload only. Normal text, voice, reminders and menus are untouched.
export async function handleWebsiteRegistration(update, telegram, pool = getPool(), { onRegistered } = {}) {
  const message = update.message;
  const match = /^\/start(?:@[a-z0-9_]+)?\s+web_([a-f0-9]{32})$/iu.exec(message?.text?.trim() ?? "");
  if (!match) return false;
  if (message.chat?.type !== "private" || message.from?.is_bot
    || String(message.chat.id) !== String(message.from?.id)) return true;
  const id = String(message.from.id);
  const digest = createHash("sha256").update(match[1].toLowerCase()).digest("hex");
  const client = await pool.connect();
  let valid = false, alreadyVerified = false, code, isNew = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id,verified_at FROM public.ah_sheli_website_registrations
       WHERE link_hash=$1 AND telegram_id=$2 AND link_expires_at>now() FOR UPDATE`,
      [digest, id]);
    if (rows.length) {
      const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || "חבר";
      const inserted = await client.query(
        `INSERT INTO public.ah_sheli_telegram_users (telegram_user_id,display_name,username)
         VALUES ($1,$2,$3) ON CONFLICT (telegram_user_id) DO NOTHING RETURNING telegram_user_id`,
        [id, name, message.from.username ?? null]);
      isNew = inserted.rows.length === 1;
      valid = true;
      alreadyVerified = !!rows[0].verified_at;
      if (!alreadyVerified) {
        if (!process.env.SESSION_SECRET) throw new Error("website_session_secret_missing");
        code = String(randomInt(10_000_000, 100_000_000));
        const codeHash = createHmac("sha256", process.env.SESSION_SECRET)
          .update(`website-code:${rows[0].id}:${code}`).digest("hex");
        await client.query(
          `UPDATE public.ah_sheli_website_registrations SET code_hash=$2,
             code_expires_at=now()+interval '10 minutes',code_attempts=0 WHERE id=$1`,
          [rows[0].id, codeHash]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (isNew && onRegistered) {
    try { await onRegistered(id); }
    catch { console.warn("[Ah Sheli] Website registration saved; notification not confirmed."); }
  }
  await telegram.sendMessage(id, !valid
    ? "הקישור לא מתאים לחשבון הזה או שפג תוקפו. שלח /id ובדוק שהזנת באתר את המזהה שלך."
    : alreadyVerified ? "אחי, החשבון כבר מחובר לאתר. אפשר לחזור אליו ולהמשיך."
    : `אחי, זה קוד החיבור שלך לאתר:\n${code}\nהזן אותו באתר כדי להמשיך. הוא תקף ל־10 דקות.\nאם לא התחלת הרשמה בעצמך, אל תעביר את הקוד לאף אחד.`);
  return true;
}
