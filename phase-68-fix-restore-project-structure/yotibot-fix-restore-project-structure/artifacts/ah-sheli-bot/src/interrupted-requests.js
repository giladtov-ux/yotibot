import { readInterruptedRequests, markInterruptedRequestReviewed, unmarkInterruptedRequestReviewed } from "./conversation-repository.js";

export function requestMetadata(update, ownerChatId) {
  if (update.callback_query?.message?.chat) {
    const query = update.callback_query;
    const chatId = String(query.message.chat.id);
    const isOwner = ownerChatId && chatId === ownerChatId
      && String(query.from?.id) === ownerChatId && !query.from?.is_bot
      && query.message.chat.type === "private";
    const action = /^r:([dx]):/u.exec(query.data ?? "")?.[1];
    return { chatId, text: isOwner && action
      ? action === "d" ? "לחיצה על ״בוצע!״ בתזכורת" : "לחיצה על ״מחק״ בתזכורת"
      : undefined };
  }
  const message = update.message;
  if (!message?.chat) return {};
  const chatId = String(message.chat.id);
  // Never retain a one-time connection proof or text from another chat.
  const isOwnerRequest = ownerChatId && chatId === ownerChatId
    && typeof message.text === "string" && !message.from?.is_bot
    && !/^(?:stop|\/(?:connect|id|start|stop)(?:@[a-z0-9_]+)?(?:\s|$))/iu
      .test(message.text.trim());
  return { chatId, text: isOwnerRequest ? message.text : undefined };
}

const pageSize = 10;
const warning = [
  "אלה בקשות שלא נרשם להן סיום תקין של הטיפול.",
  "אי אפשר להסיק מהסטטוס לבדו אם הפעולה הושלמה: ייתכן שהיא נשמרה, גם אם לא קיבלת אישור.",
  "הדוח לקריאה בלבד — לא הפעלתי מחדש אף בקשה. לפני שליחה מחדש, בדוק את הרשימות או התזכורות כדי לא ליצור כפילות.",
  "אחרי שבדקת, שלח /reviewed עם מזהה הבקשה כדי לסמן אותה כנבדקה ולהסתיר אותה מהדוח הרגיל. הסימון אינו הוכחת שמירה. להצגת גם בקשות שנבדקו: /interrupted all.",
  "סימנת בטעות? שלח /unreviewed עם מזהה הבקשה כדי להחזיר אותה לדוח הרגיל, בלי להפעיל אותה מחדש.",
].join("\n");

function formatRequest(row) {
  const date = new Date(row.created_at);
  const time = Number.isNaN(date.getTime()) ? "זמן לא ידוע" : date.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
  });
  const status = row.status === "processing"
    ? "הטיפול התחיל, בלי סיום מתועד"
    : "נרשמה שגיאה במהלך הטיפול; לא בהכרח לפני השמירה";
  // Null metadata can also be a non-message update; do not infer ownership.
  const text = row.chat_id == null
    ? "רישום ישן או ללא צ׳אט מזוהה — אי אפשר לקבוע למי שייך או מה התבקש."
    : row.request_text
      ? `תקציר: ${row.request_text.slice(0, 240).replace(/\s+/gu, " ")}`
      : "אין תקציר זמין לבקשה הזו.";
  const review = row.reviewed_at ? "\nסומנה כנבדקה ידנית; אין בכך הוכחה שהפעולה נשמרה." : "";
  return `• בקשה ${row.update_id} | ${time}\n${status}${review}\n${text}`;
}

// Keep this before AI/history/pending-action handling; inspection cannot answer
// a clarification or execute a saved action. Recheck authorization at this boundary.
export async function handleInterruptedRequests(message, telegram, {
  ownerChatId, currentUpdateId, readRequests = readInterruptedRequests,
  markReviewed = markInterruptedRequestReviewed,
  unmarkReviewed = unmarkInterruptedRequestReviewed,
  assertActive = () => {},
} = {}) {
  const text = message?.text?.trim() ?? "";
  const command = /^\/interrupted(?:@[a-z0-9_]+)?(?:\s+(all))?(?:\s+(\d+))?$/iu.exec(text);
  const isCommand = /^\/interrupted(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text);
  const isReview = /^\/reviewed(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text);
  const isUnreview = /^\/unreviewed(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text);
  if (!isCommand && !isReview && !isUnreview && !["בקשות שנקטעו", "בקשות שנקטעו כולל שנבדקו"].includes(text)) return false;
  if (!ownerChatId || String(message?.chat?.id) !== String(ownerChatId)
    || message.from?.is_bot) return false;
  assertActive();
  if (isUnreview) {
    const unreviewCommand = /^\/unreviewed(?:@[a-z0-9_]+)?\s+(\d+)$/iu.exec(text);
    const updateId = unreviewCommand ? Number(unreviewCommand[1]) : NaN;
    if (!Number.isSafeInteger(updateId) || updateId < 1) {
      await telegram.sendMessage(ownerChatId, "סימנת בקשה כנבדקה בטעות? שלח /unreviewed עם מזהה הבקשה מהדוח. זה יחזיר אותה לדוח הרגיל, בלי להפעיל אותה מחדש.");
      return true;
    }
    let unmarked;
    try {
      unmarked = await unmarkReviewed(String(ownerChatId), updateId, { currentUpdateId });
    } catch {
      assertActive();
      await telegram.sendMessage(ownerChatId, "לא הצלחתי לאשר את ביטול סימון הבדיקה. אפשר לבדוק עם /interrupted; לא הפעלתי מחדש את הבקשה.");
      return true;
    }
    assertActive();
    await telegram.sendMessage(ownerChatId, unmarked
      ? `סגור, בקשה ${updateId} אינה מסומנת כנבדקה ותופיע בדוח הרגיל: /interrupted. לא שיניתי את סטטוס הטיפול ולא הפעלתי אותה מחדש.`
      : "לא נמצאה בקשה מתאימה לביטול הסימון. לא שיניתי או הפעלתי מחדש אף בקשה.");
    return true;
  }
  if (isReview) {
    const reviewCommand = /^\/reviewed(?:@[a-z0-9_]+)?\s+(\d+)$/iu.exec(text);
    const updateId = reviewCommand ? Number(reviewCommand[1]) : NaN;
    if (!Number.isSafeInteger(updateId) || updateId < 1) {
      await telegram.sendMessage(ownerChatId, "אחרי שבדקת את הרשימות או התזכורות, שלח /reviewed עם מזהה הבקשה מהדוח. הסימון אינו מוכיח שהפעולה נשמרה ולא מפעיל אותה מחדש.");
      return true;
    }
    let marked;
    try {
      marked = await markReviewed(String(ownerChatId), updateId, { currentUpdateId });
    } catch {
      assertActive();
      await telegram.sendMessage(ownerChatId, "לא הצלחתי לאשר את סימון הבדיקה. אפשר לבדוק עם /interrupted all; לא הפעלתי מחדש את הבקשה.");
      return true;
    }
    assertActive();
    await telegram.sendMessage(ownerChatId, marked
      ? `סגור, בקשה ${updateId} מסומנת כנבדקה ולא תופיע בדוח הרגיל. זה סימון בדיקה בלבד, לא הוכחה שהפעולה נשמרה. לא שיניתי את סטטוס הטיפול ולא הפעלתי אותה מחדש. להצגה גם של בקשות שנבדקו: /interrupted all.`
      : "לא נמצאה בקשה מתאימה לסימון. לא שיניתי או הפעלתי מחדש אף בקשה.");
    return true;
  }
  const includeReviewed = Boolean(command?.[1]) || text === "בקשות שנקטעו כולל שנבדקו";
  const beforeUpdateId = command?.[2] ? Number(command[2]) : null;
  if ((isCommand && !command)
    || (beforeUpdateId !== null && (!Number.isSafeInteger(beforeUpdateId) || beforeUpdateId < 1))) {
    await telegram.sendMessage(ownerChatId, "לבדיקת בקשות שנקטעו שלח /interrupted. להצגה גם של בקשות שנבדקו: /interrupted all. לעמוד נוסף השתמש בפקודה שמופיעה בסוף הדוח.");
    return true;
  }
  let rows;
  try {
    rows = await readRequests(String(ownerChatId), { currentUpdateId, beforeUpdateId, includeReviewed });
  } catch {
    assertActive();
    await telegram.sendMessage(ownerChatId,
      "לא הצלחתי לקרוא את דוח הבקשות כרגע. זה לא אומר שהפעולות נכשלו. לא הפעלתי אותן מחדש; אפשר לבדוק שוב עם /interrupted.");
    return true;
  }
  const page = rows.slice(0, pageSize);
  const response = page.length
    ? [warning, ...page.map(formatRequest),
      ...(rows.length > pageSize
        ? [`יש עוד רישומים. לעמוד הבא: /interrupted ${includeReviewed ? "all " : ""}${page.at(-1).update_id}`] : [])].join("\n\n")
    : "אין בעמוד הזה בקשות להצגה. זה לא אישור שכל פעולה נשמרה או שכל הודעת אישור הגיעה. להצגה גם של בקשות שנבדקו: /interrupted all.";
  assertActive();
  await telegram.sendMessage(ownerChatId, response);
  return true;
}
