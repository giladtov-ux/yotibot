import { createHash } from "node:crypto";
import { getPool } from "./database.js";

// Additive account metadata only: never mutate reminders, lists, access or subscriptions.
export async function handleEmailAccountLink(update, telegram, pool = getPool(), { onRegistered } = {}) {
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const actor = callback?.from ?? message?.from;
  const start = /^\/start(?:@[a-z0-9_]+)?\s+email_([a-f0-9]{48})$/iu.exec(message?.text?.trim() ?? "");
  const choice = /^email:([yn]):([a-f0-9]{48})$/u.exec(callback?.data ?? "");
  if ((!callback && !start) || (callback && !choice)) return false;
  const id = String(actor?.id ?? "");
  if (message?.chat?.type !== "private" || actor?.is_bot || String(message.chat.id) !== id) {
    if (callback) await telegram.call("answerCallbackQuery", { callback_query_id: callback.id, text: "החיבור זמין רק בצ׳אט הפרטי שלך." });
    return true;
  }
  const token = choice?.[2] ?? start[1].toLowerCase();
  const digest = createHash("sha256").update(token).digest("hex");
  const client = await pool.connect();
  let email, linked = false, valid = false, failure, isNew = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT l.clerk_id,l.candidate_id,l.consumed_at,u.email,u.telegram_id
      FROM ah_sheli_email_links l JOIN ah_sheli_email_users u ON u.clerk_id=l.clerk_id
      WHERE l.digest=$1 AND ((l.expires_at>NOW() AND l.consumed_at IS NULL)
        OR (l.consumed_at IS NOT NULL AND l.candidate_id=$2 AND u.telegram_id=$2))
      FOR UPDATE OF l,u`, [digest, id]);
    const row = rows[0];
    if (row && (!row.telegram_id || row.telegram_id === id) && (!choice || row.candidate_id === id)) {
      valid = true; email = row.email;
      if (row.consumed_at) linked = true;
      else if (!choice) {
        // A forwarded link cannot switch an existing candidate to a different actor.
        if (row.candidate_id && row.candidate_id !== id) valid = false;
        else await client.query("UPDATE ah_sheli_email_links SET candidate_id=$2 WHERE digest=$1", [digest, id]);
      } else {
        if (choice[1] === "y") {
          await client.query("UPDATE ah_sheli_email_users SET telegram_id=$2 WHERE clerk_id=$1", [row.clerk_id, id]);
          const name = [actor.first_name, actor.last_name].filter(Boolean).join(" ") || "חבר";
          const inserted = await client.query(`INSERT INTO ah_sheli_telegram_users(telegram_user_id,display_name,username)
            VALUES($1,$2,$3) ON CONFLICT(telegram_user_id) DO NOTHING RETURNING telegram_user_id`, [id, name, actor.username ?? null]);
          isNew = inserted.rows.length === 1;
          linked = true;
        }
        await client.query("UPDATE ah_sheli_email_links SET consumed_at=NOW() WHERE digest=$1", [digest]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* The connection may already be lost. */ }
    linked = false;
    failure = error.code === "23505"
      ? "חשבון הטלגרם כבר מקושר לחשבון דוא״ל אחר. לא החלפתי את החיבור הקיים."
      : "לא הצלחתי לאמת את שמירת החיבור. בדוק את מצב החשבון באתר לפני ניסיון נוסף.";
  }
  finally { client.release(); }
  if (!failure && isNew && onRegistered) {
    try { await onRegistered(id); }
    catch { console.warn("[Ah Sheli] Email account registration saved; notification not confirmed."); }
  }
  if (failure) {
    if (callback) await telegram.call("answerCallbackQuery", { callback_query_id: callback.id, text: failure });
    await telegram.sendMessage(id, failure);
    return true;
  }
  if (callback) {
    await telegram.call("answerCallbackQuery", { callback_query_id: callback.id, text: linked ? "החשבונות קושרו" : valid ? "החיבור בוטל" : "הקישור אינו תקף" });
    await telegram.sendMessage(id, linked
      ? "החשבון קושר לדוא״ל. אפשר לחזור לאתר — הנתונים וההרשאות נשארו כמו שהם."
      : valid ? "החיבור בוטל. לא שיניתי את החשבון." : "הקישור פג או לא מתאים לחשבון הזה. צור קישור חדש באתר.");
  } else if (linked) {
    await telegram.sendMessage(id, "חשבון הדוא״ל כבר מקושר. אפשר לחזור לאתר.");
  } else {
    await telegram.sendMessage(id, valid
      ? `לחבר את חשבון הטלגרם שלך לדוא״ל ${email}?\nהאישור מאפשר לחשבון הדוא״ל גישה למידע האישי שלך באתר.\nאשר רק אם זו כתובת שלך והתחלת את החיבור בעצמך.`
      : "הקישור פג או לא מתאים לחשבון הזה. צור קישור חדש באתר.",
    valid ? { reply_markup: { inline_keyboard: [[
      { text: "אישור חיבור החשבונות", callback_data: `email:y:${token}` },
      { text: "ביטול", callback_data: `email:n:${token}` },
    ]] } } : {});
  }
  return true;
}
