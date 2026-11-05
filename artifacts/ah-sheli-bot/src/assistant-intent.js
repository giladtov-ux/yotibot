export const allowedTypes = new Set([
  "answer", "clarify", "help", "greeting", "thanks", "farewell", "small-talk",
  "tell-time", "tell-date", "list-lists", "list-reminders", "create-list",
  "show-list", "add-items", "add-task", "mark-item", "remove-item", "update-item", "reminder",
  "cancel-reminder", "cancel-reminder-number", "schedule-reminders",
  "repeat-reminder", "update-reminder",
  "delete-list", "clear-list", "remove-range",
]);

export function promptForContext(context = {}) {
  if (context.isOwner === true) return systemPrompt;
  return systemPrompt
    .replace(/יוטי בן 56[\s\S]*?(?=אתה מטפל בלו"ז שלם)/u, "")
    .replaceAll("יוטי", "המשתמש");
}

export const systemPrompt = `
אתה העוזר האישי "אח שלי" של יוטי. ענה תמיד בעברית בלבד, בלשון זכר, בחום ובגובה העיניים, כמו חבר טוב ועוזר אישי אמיתי שמקשיב ומבין. דבר בעברית יומיומית, טבעית וזורמת.

הנחיית ניסוח מחייבת: בשיחה רגילה ענה במשפט אחד או שניים קצרים, ישירות לעניין. אל תוסיף פתיח, סיכום חוזר או עצה שלא התבקשה.

הנחיית על קריטית לזיהוי לו״ז: הודעה המכילה שורות עם שעות או פריטי לו״ז (כמו "תעדכן זה לוח הזמנים") היא **תמיד וללא יוצא מן הכלל** פקודת schedule-reminders לכל הפריטים המופיעים בה. אסור לחלוטין לפרש הודעה כזו כעדכון תזכורת בודדת או כ-update-reminder.

אתה מטפל בלו"ז שלם בבת אחת. זהה את כל השעות והפעילויות והחזר type "schedule-reminders" ומערך reminders הכולל את כל הפריטים שהמשתמש שלח, בלי לדלג על אירועים.
לכל פריט: text, date, hour, minute. שעות הן בפורמט 24 שעות.

החלט על פעולה מתוך הרשימה:
answer, clarify, help, greeting, thanks, farewell, small-talk,
tell-time, tell-date, list-lists, list-reminders, create-list,
show-list, add-items, add-task, mark-item, remove-item, update-item, reminder,
cancel-reminder, cancel-reminder-number, schedule-reminders,
repeat-reminder, update-reminder,
delete-list, clear-list, remove-range.
`.trim();

function optionalString(value, label, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`AI returned an invalid ${label} field.`);
  }
  return value.trim() || null;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`AI returned an invalid ${label} field.`);
  }
  return value;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("AI returned an invalid reminder date.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) {
    throw new Error("AI returned an invalid reminder date.");
  }
  return value;
}

export function normalizeScheduledReminders(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return [];
  }
  const todayStr = new Date().toISOString().split("T")[0];
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const parsedHour = item.hour !== null && item.hour !== undefined && item.hour !== "" 
      ? optionalInteger(item.hour, "schedule hour", 0, 23) 
      : null;
      
    const parsedMinute = item.minute !== null && item.minute !== undefined && item.minute !== ""
      ? optionalInteger(item.minute, "schedule minute", 0, 59)
      : 0;

    return {
      text: optionalString(item.text, "schedule text", 300) || "תזכורת",
      date: item.date ? validDate(item.date) : todayStr,
      hour: parsedHour,
      minute: parsedMinute,
    };
  }).filter(Boolean);
}

export function normalizeIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI returned an assistant response.");
  }
  if (!allowedTypes.has(value.type)) {
    throw new Error("AI returned an unsupported assistant action.");
  }
  const response = optionalString(value.response, "response", 64000);
  let items = [];
  if (value.items !== null && value.items !== undefined) {
    if (!Array.isArray(value.items) || value.items.length > 20
      || value.items.some(item => typeof item !== "string" || item.length > 200)) {
      throw new Error("AI returned invalid list items.");
    }
    items = value.items.map(item => item.trim()).filter(Boolean);
  }
  return {
    type: value.type, response,
    reminders: value.type === "schedule-reminders"
      ? normalizeScheduledReminders(value.reminders) : [],
    name: optionalString(value.name, "name", 60),
    listName: optionalString(value.listName, "list name", 60),
    items,
    text: optionalString(value.text, "text", 300),
    date: validDate(value.date),
    hour: optionalInteger(value.hour, "hour", 0, 23),
    minute: optionalInteger(value.minute, "minute", 0, 59),
    itemText: optionalString(value.itemText, "item text", 200),
    reminderId: optionalString(value.reminderId, "reminder id", 100),
    description: optionalString(value.description, "description", 300),
    position: optionalInteger(value.position, "position", 1, 1000),
    endPosition: optionalInteger(value.endPosition, "end position", 1, 1000),
    intervalMinutes: optionalInteger(value.intervalMinutes, "interval minutes", 1, 10080),
    repeatCount: optionalInteger(value.repeatCount, "repeat count", 1, 1000),
  };
}
