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
  extractHebrewTime,
  formatJerusalemTime,
  parseJerusalemDateTime,
} from "./time.js";
import { extractHebrewDate, parseNaturalIntent } from "./natural-language.js";
import { scheduleDailyReminders } from "./schedule-reminders.js";
import { scheduleIntervalReminder, extractRequestedInterval } from "./reminder-intervals.js";
import { parseRecordQuery, parseExplicitListWrite } from "./record-queries.js";
import { friendlyConfirmation, completionEncouragement } from "./conversation-style.js";
import { parseListContinuation, parsePendingListTarget, isListCancellation } from "./list-continuation.js";
import { parseListDeletion } from "./list-deletion.js";
import { bindItemIntent } from "./task-understanding.js";
import { persistTrackedReminder } from "./appointment-flow.js";

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

function splitListAndValue(input, valueLabel) {
  const separator = input.indexOf("|");
  if (separator < 0) {
    throw new UserInputError(
      `צריך להפריד בין שם הרשימה ל${valueLabel} עם |. לדוגמה: קניות | חלב`,
    );
  }
  return [
    ensureText(input.slice(0, separator), "שם הרשימה", 60),
    ensureText(input.slice(separator + 1), valueLabel, 200),
  ];
}

function parsePosition(text, itemCount) {
  if (!/^\d+$/.test(text)) {
    throw new UserInputError("צריך לכתוב את מספר הפריט שמופיע ברשימה.");
  }
  const position = Number(text);
  if (position < 1 || position > itemCount) {
    throw new UserInputError("לא מצאתי פריט במספר הזה ברשימה.");
  }
  return position - 1;
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
    "",
    "אפשר גם לשאול מה השעה, או לכתוב “רשימות” ו“תזכורות”.",
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

function normalizedItemText(text) {
  return text.trim().toLocaleLowerCase("he-IL").replace(/[״׳"'`]/gu, "");
}

function findItemIndexes(items, requestedText) {
  const requested = normalizedItemText(requestedText);
  return items.flatMap((item, index) =>
    normalizedItemText(item.text) === requested ? [index] : [],
  );
}

function boundItemIndexes(items, intent) {
  return intent.itemId ? items.flatMap((item, index) => item.id === intent.itemId ? [index] : [])
    : findItemIndexes(items, intent.itemText);
}

function timeText(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function handleNaturalIntent(store, chatId, intent) {
  const chatLists = getChatLists(store, chatId);

  switch (intent.type) {
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
      }).format(new Date(intent.now))}.`;
    case "tell-date":
      return `היום ${new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "full",
      }).format(new Date(intent.now))}.`;
    case "list-lists":
      return runCommand(store, chatId, "lists", "");
    case "list-reminders":
      return runCommand(store, chatId, "reminders", "");
    case "repeat-reminder":
      return scheduleIntervalReminder(store, chatId, intent);
    case "create-list": {
      const name = ensureText(preferredListName(intent.name), "שם הרשימה", 60);
      if (findListName(chatLists, name)) {
        return `כבר יש לך רשימה בשם “${name}”.`;
      }
      await mutateList(store, chatId, name, () => { chatLists[name] = []; });
      return friendlyConfirmation(`פתחתי לך את הרשימה “${name}”.`);
    }
    case "show-list":
      return runCommand(store, chatId, "show", intent.name);
    case "add-items": {
      const requestedListName = ensureText(intent.listName, "שם הרשימה", 60);
      const items = intent.items.map((item) => ensureText(item, "הפריט", 200));
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
      }, intent.consumePendingList === true);
      return savedListResponse(existingName, savedItems);
    }
    case "add-task": {
      const taskText = ensureText(intent.text, "המשימה", 200);
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
      return scheduleDailyReminders(store, chatId, intent.reminders, Date.now(), intent.intervalMinutes, intent.sourceText);
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
    const response = await handleNaturalIntent(store, chatId, intent);
    if (response) return response;
    return responseText(intent, "סגור אחי, מסודר.");
  } catch (error) {
    if (error instanceof UserInputError) {
      return `רק רגע אחי — ${error.message}`;
    }
    throw error;
  }
}

export async function resolvePendingList(store, chatId, rawText) {
  return null;
}

export async function resolvePendingReminder(store, chatId, text) {
  return null;
}
