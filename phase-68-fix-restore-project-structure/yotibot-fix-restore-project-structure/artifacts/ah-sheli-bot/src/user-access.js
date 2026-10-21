import { effectiveSubscription, telegramUserId } from "./telegram-users.js";
import { sendAccessNotification } from "./access-notifications.js";

export function landingPageUrl() {
  // Canonical production URL verified through deployment metadata.
  const url = new URL("https://yotibot-azbu.onrender.com");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("secure_website_origin_required");
  return url.origin;
}
export function botCommandUpdates(ownerId) {
  const commands = [
    { command: "help", description: "איך אפשר לעזור" },
    { command: "status", description: "מצב הגישה ותוקף המנוי שלי" },
  ];
  return [
    { scope: { type: "default" }, commands },
    ...(ownerId ? [{ scope: { type: "chat", chat_id: ownerId }, commands: [
      ...commands,
      { command: "users", description: "ניהול משתמשים" },
      { command: "user", description: "פרטי משתמש" },
      { command: "grant", description: "הפעלה או הארכת גישה" },
      { command: "revoke", description: "הפסקת גישה" },
    ] }] : []),
  ];
}
function registrationKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: "הרשמה ובחירת מסלול באתר", url: landingPageUrl() }],
    [{ text: "🔑 מצב הגישה שלי", callback_data: "u:status" }],
  ] } };
}
const statusNames = { owner: "מנהל · גישה מלאה", active: "פעיל", pending: "ממתין להפעלת גישה",
  revoked: "הגישה הופסקה", expired: "תוקף המנוי הסתיים" };
export class UserAccessError extends Error {
  constructor() { super("User subscription is not active"); this.code = "USER_ACCESS_DENIED"; }
}
function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 160);
}
function privateActor(update) {
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const from = callback?.from ?? message?.from;
  if (!message || message.chat?.type !== "private" || !from || from.is_bot
    || callback && message.from?.is_bot !== true) return null;
  try {
    const id = telegramUserId(from.id);
    if (telegramUserId(message.chat.id) !== id) return null;
    return { id, name: cleanName([from.first_name, from.last_name].filter(Boolean).join(" ")) || "חבר",
      username: cleanName(from.username) || null };
  } catch { return null; }
}
function subscriptionCard(user, ownerId, now) {
  const state = effectiveSubscription(user, ownerId, now);
  const expiry = state !== "owner" && user.expiresAt ? new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(user.expiresAt)) : null;
  return `👤 ${user.name}\nמזהה טלגרם: ${user.id}\n🔑 ${statusNames[state]}${expiry ? `\nבתוקף עד: ${expiry} (שעון ישראל)` : ""}`;
}

export function createUserAccess({ repository, ownerId, assertActive = () => {}, now = Date.now }) {
  const identities = new Map();
  const owner = () => typeof ownerId === "function" ? ownerId() : ownerId;
  const sendNotification = (telegram, user, eventKey, recipientId, text) =>
    sendAccessNotification({ repository, telegram, eventKey, userId: user.id,
      recipientId, text, assertActive });
  async function notifyRegistration(user, telegram) {
    const recipientId = owner();
    if (!recipientId || !user || user.id === recipientId) return;
    await sendNotification(telegram, user, `registration:${user.id}`, recipientId,
      `משתמש חדש נרשם לבוט.\n\n${subscriptionCard(user, recipientId, now())}${user.username ? `\nכינוי: @${user.username}` : ""}\n\nלפרטים: /user ${user.id}\nלאישור ידני: /grant ${user.id} 30`);
  }
  async function canUse(id) {
    assertActive();
    if (!owner()) return false;
    if (id === owner()) return true;
    const state = effectiveSubscription(await repository.get(id), owner(), now());
    assertActive();
    return state === "active";
  }
  async function assertPermission(id) {
    if (!await canUse(id)) throw new UserAccessError();
  }
  async function notify(telegram, user) {
    const state = effectiveSubscription(user, owner(), now());
    const body = state === "expired" ? "אחי, תוקף המנוי הסתיים. אפשר לחדש אותו באתר."
      : state === "revoked" ? "אחי, הגישה שלך כרגע לא פעילה. פרטי ההרשמה והמסלולים מחכים באתר."
      : "אהלן אחי! כדי להתחיל, נרשמים ובוחרים מסלול באתר. אחרי תשלום מאומת הגישה נפתחת אוטומטית ל־30 יום.";
    await telegram.sendMessage(user.id, `${body}\n\n${subscriptionCard(user, owner(), now())}`, registrationKeyboard());
  }
  async function admin(telegram, actor, text) {
    const command = /^\/(users|user|grant|revoke)(?:@[a-z0-9_]+)?(?:\s+(.*))?$/iu.exec(text);
    if (!command) return false;
    if (actor.id !== owner()) {
      await telegram.sendMessage(actor.id, "אחי, ניהול הרשאות פתוח רק למנהל.");
      return true;
    }
    const args = (command[2] ?? "").trim().split(/\s+/u).filter(Boolean);
    let accessSaved = false;
    try {
      if (command[1].toLowerCase() === "users") {
        const page = args.length ? Number(args[0]) : 1;
        if (args.length > 1 || !Number.isSafeInteger(page) || page < 1 || page > 100_000) {
          await telegram.sendMessage(actor.id, "לרשימת המשתמשים שלח /users או /users 2 לעמוד הבא.");
          return true;
        }
        const result = await repository.list(page);
        const body = result.users.map(user => subscriptionCard(user, owner(), now())).join("\n\n");
        assertActive();
        await telegram.sendMessage(actor.id, `👥 המשתמשים שלך · עמוד ${page}\n\n${body || "עוד אין משתמשים בעמוד הזה."}${result.hasNext ? `\n\nלהמשך: /users ${page + 1}` : ""}`);
        return true;
      }
      const grant = command[1].toLowerCase() === "grant";
      let id, days;
      try {
        id = telegramUserId(args[0]);
        days = Number(args[1]);
        if (args.length !== (grant ? 2 : 1)
          || grant && (!Number.isSafeInteger(days) || days < 1 || days > 3650)) throw new Error();
      } catch {
        await telegram.sendMessage(actor.id, "לפרטים: /user מזהה\nלהפעלה או הארכה: /grant מזהה מספר־ימים\nלהפסקת גישה: /revoke מזהה");
        return true;
      }
      if (command[1].toLowerCase() !== "user" && id === owner()) {
        await telegram.sendMessage(actor.id, "הגישה שלך כמנהל נשארת מלאה, אחי.");
        return true;
      }
      assertActive();
      const user = grant ? await repository.grant(id, days)
        : command[1].toLowerCase() === "revoke" ? await repository.revoke(id) : await repository.get(id);
      assertActive();
      if (!user) {
        await telegram.sendMessage(actor.id, `המשתמש הזה עוד לא נרשם. אפשר להפנות אותו להרשמה באתר:\n${landingPageUrl()}`);
        return true;
      }
      accessSaved = grant || command[1].toLowerCase() === "revoke";
      let delivery = "";
      if (grant) {
        const status = await sendNotification(telegram, user, `grant:${user.id}:${user.expiresAt}`,
          user.id, `אחי, הגישה שלך אושרה או חודשה ואפשר להשתמש בעוזר.\n\n${subscriptionCard(user, owner(), now())}`);
        delivery = {
          sent: "\nהודעת האישור נשלחה למשתמש.",
          failed: "\nהגישה נשמרה, אבל טלגרם דחה את ההודעה למשתמש. לא נשלח שוב אוטומטית.",
          unknown: "\nהגישה נשמרה, אבל מסירת ההודעה למשתמש אינה מאומתת. בדוק איתו לפני כל שליחה נוספת; אין שליחה חוזרת אוטומטית.",
          skipped: "\nכבר תועד ניסיון להודיע למשתמש על האישור הזה; לא נשלח שוב.",
        }[status];
      }
      assertActive();
      await telegram.sendMessage(actor.id, `${grant ? "סגור, הגישה אושרה." : command[1].toLowerCase() === "revoke" ? "סגור, הגישה הופסקה. הרשימות והתזכורות נשארו שמורות." : "אלה הפרטים:"}\n\n${subscriptionCard(user, owner(), now())}${delivery}`);
    } catch {
      assertActive();
      await telegram.sendMessage(actor.id, accessSaved
        ? "עדכון הגישה נשמר, אבל לא הצלחתי למסור את כל האישורים. בדוק עם /user ומזהה המשתמש; אל תפעיל /grant שוב רק כדי לשלוח הודעה."
        : "לא הצלחתי לאשר את העדכון כרגע. בדוק עם /user ומזהה המשתמש לפני ניסיון נוסף.");
    }
    return true;
  }
  return {
    canUse, assertPermission,
    async notifyNewRegistration(id, telegram) {
      // Used only after a verified website/email-link INSERT has committed.
      try { await notifyRegistration(await repository.get(telegramUserId(id)), telegram); }
      catch { console.warn("[Ah Sheli] New registration notification could not be prepared."); }
    },
    async authorizedId(update) {
      const actor = privateActor(update);
      return actor && await canUse(actor.id) ? actor.id : null;
    },
    context(id) {
      return { isOwner: id === owner(), user: { preferredName: id === owner() ? "יוטי" : identities.get(id)?.name ?? "חבר" } };
    },
    async handle(update, telegram) {
      const actor = privateActor(update);
      if (!actor) return null;
      assertActive();
      if (!owner()) {
        await telegram.sendMessage(actor.id, "הבוט עדיין מחכה לחיבור המנהל, אחי.");
        return null;
      }
      const user = await repository.register(actor, actor.id === owner());
      assertActive();
      if (user.isNew && actor.id !== owner()) {
        await notifyRegistration(user, telegram);
        assertActive();
      }
      identities.set(actor.id, { name: actor.name });
      if (identities.size > 1000) identities.delete(identities.keys().next().value);
      const text = (update.message?.text ?? "").trim();
      if (await admin(telegram, actor, text)) return null;
      const callback = update.callback_query;
      const statusCommand = /^\/(?:subscription|status|register|start)(?:@[a-z0-9_]+)?(?:\s.*)?$/iu.test(text);
      const accessCallback = callback && ["u:register", "u:status"].includes(callback.data);
      if (accessCallback) await telegram.call("answerCallbackQuery", { callback_query_id: callback.id });
      const state = effectiveSubscription(user, owner(), now());
      if (!["active", "owner"].includes(state)) {
        if (callback && !accessCallback) await telegram.call("answerCallbackQuery", {
          callback_query_id: callback.id, text: "הגישה כרגע לא פעילה, אחי.", show_alert: true,
        });
        await notify(telegram, user);
        return null;
      }
      if (statusCommand || accessCallback) {
        await telegram.sendMessage(actor.id, `סגור אחי, הגישה שלך פתוחה.\n\n${subscriptionCard(user, owner(), now())}${actor.id === owner() ? "\n\nניהול: /users\nפרטים: /user מזהה\nהפעלה או הארכה: /grant מזהה מספר־ימים\nהפסקה: /revoke מזהה" : ""}`);
        return null;
      }
      return actor.id;
    },
  };
}
