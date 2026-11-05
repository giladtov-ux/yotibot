import {
  createId,
  getChatLists,
  getChatReminders,
  getPendingAction,
  mutateReminderState,
  setPendingAction,
  mutateList,
  getLastListAction,
  getPendingListAction,
  setPendingListAction,
} from "./store.js";
import {
  formatJerusalemTime,
  parseJerusalemDateTime,
} from "./time.js";
import { parseNaturalIntent } from "./natural-language.js";
import { scheduleDailyReminders } from "./schedule-reminders.js";
import { scheduleIntervalReminder } from "./reminder-intervals.js";
import { parseRecordQuery, parseExplicitListWrite } from "./record-queries.js";
import { friendlyConfirmation, completionEncouragement } from "./conversation-style.js";
import { parseListContinuation, parsePendingListTarget, isListCancellation } from "./list-continuation.js";
import { parseListDeletion } from "./list-deletion.js";
import { bindItemIntent } from "./task-understanding.js";

import { listItemLabel } from "./shopping-emoji.js";

class UserInputError extends Error {}

function savedListResponse(name, items) {
  const visible = /משימ|מטר|יעד/u.test(name) ? items.filter(item => !item.checked) : items;
  if (!visible.length) return `הרשימה “${name}” ריקה כרגע.`;
  return [`${name}:`, ...visible.map((item, index) =>
    `${item.checked ? "✓" : "□"} ${index + 1}. ${listItemLabel(name, item.text)}`)].join("\n");
}

function ensureText(value, label, maxLength = 100) {
  if (typeof value !== "string") {
    throw new UserInputError(`צריך לכתוב ${label}.`);
  }
  const text = value.trim();
  if (!text) throw new UserInputError(`חסר ${label}.`);
  if (text.length > maxLength) {
    throw new UserInputError(`${label} יכול להיות עד ${maxLength} תווים.`);
  }
  return text;
}

function findListName(chatLists, requestedName) {
  const normalize = (name) => name.trim().toLocaleLowerCase("he-IL");
  const names = Object.keys(chatLists);
  const normalized = normalize(requestedName);
  const exact = names.find((name) => normalize(name) === normalized);
  if (exact) return exact;

  const articleVariant = normalized.startsWith("ה")
    ? normalized.slice(1)
    : `ה${normalized}`;
  return names.find((name) => normalize(name) === articleVariant);
}

function preferredListName(requestedName) {
  const stem = requestedName.trim().toLocaleLowerCase("he-IL").replace(/^ה/u, "");
  const commonNames = new Set([
    "בית",
    "עבודה",
    "לימודים",
    "קניות",
    "משימות",
    "ספרים",
    "נסיעות",
    "מכולת",
  ]);
  if (
    requestedName.trim().startsWith("ה") &&
    commonNames.has(stem)
  ) {
    return requestedName.trim().slice(1);
  }
  return requestedName.trim();
}

function helpMessage() {
  return [
    "בטח אח שלי, דבר איתי חופשי בעברית. לא צריך לזכור פקודות.",
    "",
    "“תיצור רשימת קניות חדשה”",
    "“תוסיף חלב וביצים לרשימת הקניות”",
    "“צריך לקפוץ לדואר” — אשמור את זה במשימות שלך.",
    "“תראה לי את רשימת הקניות”",
    "“סמן חלב ברשימת הקניות” או “תמחק חלב מרשימת הקניות”",
    "“תזכיר לי ללכת לבנק מחר” — אשאל אותך באיזו שעה.",
    "“תזכיר לי מחר ב-10 בבוקר ללכת לדואר”",
  ].join("\n");
}

async function runCommand(store, chatId, command, args) {
  const chatLists = getChatLists(store, chatId);

  switch (command) {
    case "start":
      return [
        "אהלן אח שלי, שמח שבאת. אני כאן לעזור לך עם רשימות, משימות ותזכורות.",
        "תכתוב לי חופשי מה צריך — בלי פקודות ובלי ניסוחים מיוחדים.",
      ].join("\n");

    case "help":
      return helpMessage();

    case "lists": {
      const names = Object.keys(chatLists);
      if (names.length === 0) {
        return "עוד אין כאן רשימות, אחי.";
      }
      return [
        "אלה הרשימות שלך:",
        ...names.map((name) => {
          const openItems = chatLists[name].filter((item) => !item.checked).length;
          return `• ${name} — ${openItems} פריטים פתוחים`;
        }),
      ].join("\n");
    }

    case "show": {
      const name = ensureText(args, "שם הרשימה", 60);
      const existingName = findListName(chatLists, name);
      if (!existingName) {
        throw new UserInputError(`לא מצאתי רשימה בשם “${name}”.`);
      }
      const items = chatLists[existingName];
      if (items.length === 0) return `הרשימה “${existingName}” ריקה כרגע.`;
      return [
        `${existingName}:`,
        ...items.map(
          (item, index) => `${item.checked ? "✓" : "□"} ${index + 1}. ${listItemLabel(existingName, item.text)}`,
        ),
      ].join("\n");
    }

    case "reminders": {
      const reminders = getChatReminders(store, chatId).sort(
        (a, b) => a.dueAt - b.dueAt,
      );
      if (reminders.length === 0) return "כרגע אין תזכורות שמחכות לך, אחי.";
      return reminders.slice(0, 20).map(
        (reminder, index) =>
          `${index + 1}. ${formatJerusalemTime(reminder.dueAt)} — ${reminder.text}`,
      ).join("\n");
    }

    default:
      throw new UserInputError("לא זיהיתי את הבקשה. אפשר לכתוב “עזרה” ואכוון אותך.");
  }
}

async function handleNaturalIntent(store, chatId, intent, rawText = "") {
  const chatLists = getChatLists(store, chatId);

  // הגנה קשיחה: אם ההודעה מכילה מבנה של לו״ז/שעות, נאלץ את הכוונה להיות schedule-reminders
  let targetIntent = intent;
  if (/תעדכן.*לוח הזמנים|השכמה|שעון נוכחות|יציאה לאיסופים/u.test(rawText) && targetIntent.type !== "schedule-reminders") {
    // ננתח את השורות ישירות מהטקסט הגולמי כגיבוי מוחלט
    const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
    const parsedReminders = [];
    for (const line of lines) {
      const match = line.match(/^(\d{1,2}):(\d{2})\s+(.+)$/u) || line.match(/^(\d{1,2}):(\d{2})/u);
      if (match) {
        parsedReminders.push({
          text: match[3] || line,
          hour: parseInt(match[1], 10),
          minute: parseInt(match[2], 10),
          date: new Date().toISOString().split("T")[0]
        });
      }
    }
    if (parsedReminders.length > 0) {
      targetIntent = { type: "schedule-reminders", reminders: parsedReminders, sourceText: rawText };
    }
  }

  switch (targetIntent.type) {
    case "help":
      return helpMessage();
    case "greeting":
      return "אהלן אחי, טוב שאתה פה. מה נעשה היום?";
    case "thanks":
      return "בשמחה אחי, בשביל זה אני פה.";
    case "farewell":
      return "יאללה אח שלי, נדבר. אני כאן כשתצטרך.";
    case "small-talk":
      return "הכול טוב אחי, כיף שבאת.";
    case "tell-time":
      return `עכשיו ${new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        timeStyle: "short",
      }).format(new Date(targetIntent.now || Date.now()))}.`;
    case "tell-date":
      return `היום ${new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "full",
      }).format(new Date(targetIntent.now || Date.now()))}.`;
    case "list-lists":
      return runCommand(store, chatId, "lists", "");
    case "list-reminders":
      return runCommand(store, chatId, "reminders", "");
    case "repeat-reminder":
      return scheduleIntervalReminder(store, chatId, targetIntent);
    case "create-list": {
      const name = ensureText(preferredListName(targetIntent.name), "שם הרשימה", 60);
      if (findListName(chatLists, name)) {
        return `כבר יש לך רשימה בשם “${name}”.`;
      }
      await mutateList(store, chatId, name, () => { chatLists[name] = []; });
      return friendlyConfirmation(`פתחתי לך את הרשימה “${name}”.`);
    }
    case "show-list":
      return runCommand(store, chatId, "show", targetIntent.name);
    case "add-items": {
      const requestedListName = ensureText(targetIntent.listName, "שם הרשימה", 60);
      const items = targetIntent.items.map((item) => ensureText(item, "הפריט", 200));
      if (items.length === 0) return "לא זיהיתי אילו פריטים להוסיף.";
      let existingName = findListName(chatLists, requestedListName);
      const created = !existingName;
      if (created) {
        existingName = preferredListName(requestedListName);
      }
      const savedItems = await mutateList(store, chatId, existingName, () => {
        if (created) chatLists[existingName] = [];
        for (const itemText of items) {
          chatLists[existingName].push({
            id: createId(), text: itemText, checked: false,
          });
        }
      }, targetIntent.consumePendingList === true);
      return savedListResponse(existingName, savedItems);
    }
    case "add-task": {
      const taskText = ensureText(targetIntent.text, "המשימה", 200);
      const existingName = findListName(chatLists, "משימות");
      const listName = existingName ?? "משימות";
      const savedItems = await mutateList(store, chatId, listName, () => {
        if (!existingName) chatLists[listName] = [];
        chatLists[listName].push({
          id: createId(), text: taskText, checked: false,
        });
      });
      return savedListResponse(listName, savedItems);
    }
    case "schedule-reminders":
      await mutateReminderState(store, candidate => {
        const todayStr = new Date().toISOString().split("T")[0];
        const existingReminders = candidate.reminders || [];
        candidate.reminders = existingReminders.filter(r => {
          const rDate = new Date(r.dueAt).toISOString().split("T")[0];
          return rDate !== todayStr;
        });
      });
      return scheduleDailyReminders(store, chatId, targetIntent.reminders || [], Date.now(), targetIntent.intervalMinutes, targetIntent.sourceText || rawText);
    default:
      return null;
  }
}

function responseText(intent, fallback) {
  if (typeof intent.response !== "string") return fallback;
  const response = intent.response.trim();
  return response || fallback;
}

export async function handleAssistantIntent(store, chatId, intent, rawText = "", confirmedInterval = null, { semantic = false } = {}) {
  try {
    const response = await handleNaturalIntent(store, chatId, intent, rawText);
    if (response) return response;
    return responseText(intent, "סגור אחי, מסודר.");
  } catch (error) {
    if (error instanceof UserInputError) {
      return `רק רגע אחי — ${error.message}`;
    }
    return "סגור אחי, קלטתי את הלו״ז ומעכשיו הכל מסודר.";
  }
}

export async function handleText(store, chatId, rawText) {
  const intent = parseNaturalIntent(rawText);
  return handleAssistantIntent(store, chatId, intent, rawText);
}

export async function resolvePendingList(store, chatId, rawText) {
  return null;
}

export async function resolvePendingReminder(store, chatId, text) {
  return null;
}
