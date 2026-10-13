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
  // Task receipts are rendered from the writer's database readback, not model
  // prose or an uncommitted array. Keep history stored but out of open tasks.
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
    "אם לא קיבלת אישור לבקשה, כתוב “בקשות שנקטעו” או /interrupted כדי לבדוק — בלי להפעיל אותה שוב.",
    "אחרי בדיקת הרשימות או התזכורות: /reviewed ומזהה הבקשה מסמנים שנבדקה, בלי להוכיח שמירה. /interrupted all מציג גם בקשות שנבדקו.",
    "סימנת בטעות? /unreviewed ומזהה הבקשה מחזירים אותה לדוח הרגיל, בלי להפעיל אותה מחדש.",
    "אם חסר פרט לתזכורת, אשאל אותך ואשמור אותה אחרי שנשלים את הפרטים.",
  ].join("\n");
}

async function runCommand(store, chatId, command, args) {
  const chatLists = getChatLists(store, chatId);

  switch (command) {
    case "start":
      return [
        "אהלן אח שלי, שמח שבאת. אני כאן לעזור לך עם רשימות, משימות ותזכורות.",
        "תכתוב לי חופשי מה צריך — בלי פקודות ובלי ניסוחים מיוחדים.",
        "",
        "למשל: “תוסיף חלב לקניות” או “תזכיר לי ללכת לדואר מחר”.",
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

    case "newlist": {
      const name = ensureText(args, "שם הרשימה", 60);
      if (findListName(chatLists, name)) {
        throw new UserInputError(`כבר יש לך רשימה בשם ${name}.`);
      }
      await mutateList(store, chatId, name, () => { chatLists[name] = []; });
      return friendlyConfirmation(`פתחתי לך את הרשימה “${name}”.`);
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

    case "add": {
      const [requestedName, itemText] = splitListAndValue(args, "הפריט");
      const name = findListName(chatLists, requestedName);
      if (!name) throw new UserInputError(`לא מצאתי רשימה בשם “${requestedName}”.`);
      await mutateList(store, chatId, name, () => {
        chatLists[name].push({ id: createId(), text: itemText, checked: false });
      });
      return runCommand(store, chatId, "show", name);
    }

    case "done": {
      const [requestedName, positionText] = splitListAndValue(args, "מספר הפריט");
      const name = findListName(chatLists, requestedName);
      if (!name) throw new UserInputError(`לא מצאתי רשימה בשם “${requestedName}”.`);
      const index = parsePosition(positionText, chatLists[name].length);
      const item = chatLists[name][index];
      await mutateList(store, chatId, name, () => { item.checked = !item.checked; });
      return item.checked
        ? `${completionEncouragement()}\nסימנתי את “${item.text}” כבוצע.`
        : `החזרתי את “${item.text}” לרשימה.`;
    }

    case "remove": {
      const [requestedName, positionText] = splitListAndValue(args, "מספר הפריט");
      const name = findListName(chatLists, requestedName);
      if (!name) throw new UserInputError(`לא מצאתי רשימה בשם “${requestedName}”.`);
      const index = parsePosition(positionText, chatLists[name].length);
      let removed;
      await mutateList(store, chatId, name, () => {
        [removed] = chatLists[name].splice(index, 1);
      }, false, false, { verifyDeletion: true });
      return runCommand(store, chatId, "show", name);
    }

    case "remind": {
      const separator = args.indexOf("|");
      if (separator < 0) {
        throw new UserInputError(
          "הפורמט הוא: /remind YYYY-MM-DD HH:mm | מה להזכיר לך",
        );
      }
      const dateAndTime = args.slice(0, separator).trim().split(/\s+/);
      if (dateAndTime.length !== 2) {
        throw new UserInputError(
          "הפורמט הוא: /remind YYYY-MM-DD HH:mm | מה להזכיר לך",
        );
      }
      const reminderText = ensureText(args.slice(separator + 1), "תוכן התזכורת", 300);
      const dueAt = parseJerusalemDateTime(dateAndTime[0], dateAndTime[1]);
      const reminder = {
        id: createId(),
        chatId,
        text: reminderText,
        dueAt,
        createdAt: Date.now(),
      };
      await mutateReminderState(store, candidate => {
        candidate.reminders.push(reminder);
      });
      return friendlyConfirmation(`אזכיר לך ב־${formatJerusalemTime(dueAt)}: ${reminderText}`);
    }

    case "reminders": {
      const reminders = getChatReminders(store, chatId).sort(
        (a, b) => a.dueAt - b.dueAt,
      );
      if (reminders.length === 0) return "כרגע אין תזכורות שמחכות לך, אחי.";
      return [
        ...reminders.slice(0, 20).map(
          (reminder, index) =>
            `${index + 1}. ${formatJerusalemTime(reminder.dueAt)} — ${reminder.text}${reminder.repeatEveryMs ? ` (כל ${reminder.repeatEveryMs / 60_000} דקות${reminder.remainingOccurrences != null ? `; ${reminder.remainingOccurrences} פעמים נותרו` : "; עד לביטול"})` : ""}`,
        ),
        reminders.length > 20 ? `ועוד ${reminders.length - 20} תזכורות.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "cancelreminder": {
      const positionText = ensureText(args, "מספר התזכורת");
      const reminders = getChatReminders(store, chatId).sort(
        (a, b) => a.dueAt - b.dueAt,
      );
      const index = parsePosition(positionText, reminders.length);
      const reminder = reminders[index];
      await mutateReminderState(store, candidate => {
        candidate.reminders = candidate.reminders.filter((item) => item.id !== reminder.id);
      });
      return friendlyConfirmation("ביטלתי את התזכורת.");
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

async function scheduleReminder(store, chatId, reminderText, date, hour, minute, tracking = {}) {
  const dueAt = parseJerusalemDateTime(date, timeText(hour, minute));
  const reminder = {
    id: createId(),
    chatId,
    text: ensureText(reminderText, "תוכן התזכורת", 300),
    dueAt,
    createdAt: Date.now(),
  };
  if (tracking.trackTask) {
    const saved = await persistTrackedReminder(store, chatId, reminder, tracking.taskListName);
    return `נקבע ל־${formatJerusalemTime(dueAt)}: ${reminder.text}${saved.createdTask ? `\nנוסף ל${saved.listName}.` : ""}`;
  }
  await mutateReminderState(store, candidate => {
    candidate.reminders.push(reminder);
    delete candidate.pendingActions[chatId];
  });
  return friendlyConfirmation(`אזכיר לך ב־${formatJerusalemTime(dueAt)}: ${reminder.text}`);
}

function missingReminderDetail(date, hour, text, trackTask = false) {
  if (trackTask && text) {
    if (!date && hour == null) return "באיזה יום ובאיזו שעה?";
    if (!date) return "באיזה יום?";
    if (hour == null) return "באיזו שעה?";
  }
  if (!text) return "מה להזכיר לך? כתוב לי את הדבר שתרצה לזכור.";
  if (!date && hour === null) return "מתי להזכיר לך? כתוב יום ושעה, למשל “מחר ב-10 בבוקר”.";
  if (!date) return "סבבה אח שלי, באיזה יום להזכיר לך? אפשר לכתוב “מחר” או “ביום ראשון”.";
  if (hour === null) return "סגור, רק באיזו שעה באותו יום? למשל “10 בבוקר” או “18:30”.";
  return "";
}

async function beginReminder(store, chatId, intent) {
  if (!intent.text) {
    await setPendingAction(store, chatId, {
      type: "reminder",
      text: "",
      date: intent.date,
      hour: intent.hour,
      minute: intent.minute,
    });
    return missingReminderDetail(intent.date, intent.hour, "");
  }
  if (intent.date && intent.hour !== null) {
    try {
      return await scheduleReminder(
        store,
        chatId,
        intent.text,
        intent.date,
        intent.hour,
        intent.minute ?? 0,
        intent,
      );
    } catch (error) {
      if (error instanceof UserInputError || error.message.includes("מועד שעדיין")) {
        return error.message;
      }
      throw error;
    }
  }

  await setPendingAction(store, chatId, {
    type: "reminder",
    text: intent.text,
    date: intent.date,
    hour: intent.hour,
    minute: intent.minute,
    ...(intent.trackTask ? { trackTask: true, taskListName: intent.taskListName } : {}),
  });
  return missingReminderDetail(intent.date, intent.hour, intent.text, intent.trackTask);
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
      return "הכול טוב אחי, כיף שבאת. איך עובר עליך היום?";
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
    case "delete-list":
    case "clear-list":
    case "remove-range": {
      const requested = ensureText(intent.listName, "שם הרשימה", 60);
      const name = findListName(chatLists, requested)
        ?? findListName(chatLists, requested.replace(/(?:\s+(?:שלי|כולה|במלואה))+$/u, "").trim());
      if (!name) throw new UserInputError(`לא מצאתי רשימה בשם “${requested}”. לא מחקתי דבר.`);
      const items = chatLists[name];
      let count = items.length;
      if (intent.type === "remove-range") {
        const start = intent.position, end = intent.endPosition;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start < 1 || end < start || end > items.length) {
          throw new UserInputError(`הטווח לא מתאים לרשימה “${name}”, שבה ${items.length} סעיפים. לא מחקתי דבר.`);
        }
        count = end - start + 1;
      }
      await mutateList(store, chatId, name, () => {
        if (intent.type === "delete-list") delete chatLists[name];
        else if (intent.type === "clear-list") chatLists[name] = [];
        else items.splice(intent.position - 1, count);
      }, true, true, { verifyDeletion: true });
      if (intent.type === "delete-list") return friendlyConfirmation(`מחקתי את הרשימה “${name}” וכל הפריטים שלה.`);
      return runCommand(store, chatId, "show", name);
    }
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
      const alreadySaved = (chatLists[listName] ?? []).some(
        (item) =>
          !item.checked &&
          normalizedItemText(item.text) === normalizedItemText(taskText),
      );
      if (alreadySaved) return runCommand(store, chatId, "show", listName);
      const savedItems = await mutateList(store, chatId, listName, () => {
        if (!existingName) chatLists[listName] = [];
        chatLists[listName].push({
          id: createId(), text: taskText, checked: false,
        });
      });
      return savedListResponse(listName, savedItems);
    }
    case "mark-item": {
      const name = findListName(chatLists, intent.listName);
      if (!name) return `לא מצאתי רשימה בשם “${intent.listName}”.`;
      const indexes = boundItemIndexes(chatLists[name], intent);
      if (indexes.length === 0) {
        return `לא מצאתי את “${intent.itemText}” ברשימה “${name}”.`;
      }
      if (indexes.length > 1) {
        return `יש כמה פריטים בשם “${intent.itemText}”. כתוב את מספר הפריט כדי שאדע איזה לסמן.`;
      }
      const item = chatLists[name][indexes[0]];
      const savedItems = await mutateList(store, chatId, name, () => { item.checked = true; });
      return `${completionEncouragement()}\n${savedListResponse(name, savedItems)}`;
    }
    case "update-item": {
      const name = findListName(chatLists, intent.listName);
      if (!name) return `לא מצאתי רשימה בשם “${intent.listName}”. לא שיניתי דבר.`;
      const indexes = boundItemIndexes(chatLists[name], intent);
      if (indexes.length !== 1) return "לא מצאתי פריט חד־משמעי לשינוי. לא שיניתי דבר.";
      const replacement = ensureText(intent.text, "הניסוח החדש", 200);
      const savedItems = await mutateList(store, chatId, name, () => {
        chatLists[name][indexes[0]].text = replacement;
      });
      return savedListResponse(name, savedItems);
    }
    case "remove-item": {
      const name = findListName(chatLists, intent.listName);
      if (!name) return `לא מצאתי רשימה בשם “${intent.listName}”.`;
      const indexes = boundItemIndexes(chatLists[name], intent);
      if (indexes.length === 0) {
        return `לא מצאתי את “${intent.itemText}” ברשימה “${name}”.`;
      }
      if (indexes.length > 1) {
        return `יש כמה פריטים בשם “${intent.itemText}”. כתוב את מספר הפריט כדי שאדע איזה להסיר.`;
      }
      let removed;
      const savedItems = await mutateList(store, chatId, name, () => {
        [removed] = chatLists[name].splice(indexes[0], 1);
      }, false, false, { verifyDeletion: true });
      return savedListResponse(name, savedItems);
    }
    case "reminder":
      return beginReminder(store, chatId, intent);
    case "schedule-reminders":
      return scheduleDailyReminders(store, chatId, intent.reminders, Date.now(), intent.intervalMinutes, intent.sourceText);
    case "cancel-reminder":
    case "cancel-reminder-number": {
      const reminders = getChatReminders(store, chatId).sort((a, b) => a.dueAt - b.dueAt);
      let reminder;
      if (intent.type === "cancel-reminder-number") {
        if (intent.position < 1 || intent.position > reminders.length) {
          return "לא מצאתי תזכורת במספר הזה.";
        }
        reminder = reminders[intent.position - 1];
      } else {
        const requested = normalizedItemText(intent.description);
        const matches = reminders.filter((item) =>
          normalizedItemText(item.text).includes(requested),
        );
        if (matches.length === 0) return "לא מצאתי תזכורת שמתאימה לתיאור הזה.";
        if (matches.length > 1) return "מצאתי כמה תזכורות מתאימות. כתוב איזו מהן לבטל או את המספר שלה.";
        [reminder] = matches;
      }
      await mutateReminderState(store, candidate => {
        candidate.reminders = candidate.reminders.filter((item) => item.id !== reminder.id);
      });
      return friendlyConfirmation("ביטלתי את התזכורת.");
    }
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
  const deletion = parseListDeletion(rawText);
  if (deletion) {
    try { return await handleNaturalIntent(store, chatId, deletion); }
    catch (error) {
      if (error instanceof UserInputError) return `רק רגע אחי — ${error.message}`;
      throw error;
    }
  }
  // Literal command callers cannot invent destructive scope. Successfully
  // interpreted AI requests use semantic routing and the same validated writer.
  if (!semantic && ["delete-list", "clear-list", "remove-range"].includes(intent?.type)) {
    return "לא זיהיתי בקשת מחיקה ברורה. לא מחקתי דבר.";
  }
  if (/^(?:כן|לא|אוקיי|סגור|מעולה|תודה|תודה רבה|בסדר)[.! ]*$/u.test(rawText.trim())
    && ["add-items", "add-task", "create-list", "mark-item", "remove-item", "update-item", "reminder",
      "schedule-reminders", "repeat-reminder", "cancel-reminder", "cancel-reminder-number",
      "delete-list", "clear-list", "remove-range"].includes(intent?.type)) {
    const pending = getPendingAction(store, chatId);
    if (pending) return missingReminderDetail(pending.date, pending.hour, pending.text);
    if (getPendingListAction(store, chatId)) return "רק לאיזו רשימה להוסיף? הפריטים כבר שמורים אצלי להשלמה.";
    return "סגור אחי, אני כאן.";
  }
  const pendingListResponse = await resolvePendingList(store, chatId, rawText, { allowNaturalTarget: semantic });
  if (pendingListResponse !== null) return pendingListResponse;
  if (["add-items", "add-task", "create-list", "mark-item", "remove-item", "update-item", "reminder",
    "schedule-reminders", "repeat-reminder", "cancel-reminder", "cancel-reminder-number",
    "delete-list", "clear-list", "remove-range"].includes(intent?.type)) {
    if (/(?:אל|לא)\s+(?:תמחק|תסיר|תוריד|תורידי|תסמן|תשנה|תעדכן|תרוקן|תנקה|תעיף|תזרוק|תבטל|תוסיף|תשמור|תזכיר)|(?:בלי|ללא)\s+(?:מחיקה|שמירה|תזכורות)|(?:רק|לשם)\s+(?:דוגמה|ציטוט|ניתוח)|רק\s+שואל|איך\s+(?:מוחקים|למחוק|מסירים)/u.test(rawText)) {
      return "סגור אחי, לא שיניתי או מחקתי דבר.";
    }
    let current;
    try { current = parseNaturalIntent(rawText); } catch { /* no repair from old AI fields */ }
    if (["greeting", "thanks", "farewell", "small-talk", "help", "tell-time", "tell-date",
      "show-list", "list-lists", "list-reminders"].includes(current?.type)) {
      return handleNaturalIntent(store, chatId, current);
    }
  }
  // Even a wrong AI classification cannot answer a list query with a schedule.
  const continuation = parseListContinuation(rawText, getLastListAction(store, chatId),
    Object.keys(store.lists[chatId] ?? {}));
  intent = parseRecordQuery(rawText) ?? parseExplicitListWrite(rawText)
    ?? (semantic && continuation?.type === "clarify" ? null : continuation) ?? intent;
  // Only the deterministic parser may retain original items, never AI fields.
  if (continuation?.pendingListItems && (!semantic || intent?.type === "clarify")) {
    await setPendingListAction(store, chatId, { items: continuation.pendingListItems });
    return responseText(intent, "לאיזו רשימה להוסיף?");
  }
  if (intent?.type === "add-items" && getPendingListAction(store, chatId)) {
    intent = { ...intent, consumePendingList: true };
  }
  if (semantic && ["mark-item", "remove-item", "update-item"].includes(intent?.type)) {
    const bound = bindItemIntent(store, chatId, intent, rawText);
    if (!bound.type) return bound.response;
    intent = bound;
  }
  if (semantic && intent?.type === "add-task" && !intent.text?.trim()) {
    intent = { ...intent, text: rawText.trim().replace(/^(?:בבקשה\s+)?(?:תוסיף|תוסיפי|הוסף|הוסיפי)\s+(?:לי\s+)?/u, "") };
  }
  if (["reminder", "repeat-reminder", "schedule-reminders"].includes(intent?.type)
    && /(?:שמור|תשמור|הוסף|תוסיף|צור|תיצור)/u.test(rawText)
    && /רשימ(?:ת|ה)/u.test(rawText)
    && !/תזכיר|תזכורות|לו[״"׳']?ז|לוח\s*זמנים/u.test(rawText)) {
    return "זו בקשה לרשימה, ולא שמרתי ממנה תזכורות. כתוב את שם הרשימה והפריטים, למשל: ״שמור רשימת משימות: להתקשר, לקנות חלב״.";
  }
  const interval = extractRequestedInterval(rawText) ?? confirmedInterval;
  if (interval?.ambiguous && ["repeat-reminder", "schedule-reminders", "reminder"].includes(intent?.type)) {
    return "ציינת כמה הפרשי זמן. איזה הפרש שייך לכל תזכורת? אפשר להשלים את כולם יחד; עדיין לא נשמר דבר.";
  }
  if (intent?.type === "schedule-reminders") {
    intent = { ...intent, intervalMinutes: interval?.minutes ?? null, sourceText: rawText };
  }
  if (intent?.type === "repeat-reminder" && !interval) return "באיזה הפרש לחזור על התזכורת? לא יצרתי חזרה שלא ביקשת במפורש.";
  if (intent?.type === "repeat-reminder" && interval) {
    intent = { ...intent, intervalMinutes: interval.minutes };
  }
  if (!intent || typeof intent.type !== "string") {
    return "לא תפסתי עד הסוף, אח שלי. תכתוב לי שוב מה תרצה שאעשה.";
  }

  try {
    const pending = getPendingAction(store, chatId);
    if (pending && /^(?:עזוב|עזבי|לא משנה|בטל את זה|ביטול)[.! ]*$/u.test(rawText.trim())) {
      await setPendingAction(store, chatId, null);
      return "בסדר אח שלי, ביטלתי את התזכורת שעדיין לא הושלמה.";
    }

    if (intent.type === "answer" || intent.type === "clarify") {
      return responseText(
        intent,
        "רק רגע אח שלי — תוכל להסביר לי קצת יותר למה התכוונת?",
      );
    }

    if (pending && intent.type === "reminder") {
      if (!intent.text || normalizedItemText(intent.text) === normalizedItemText(pending.text)) intent = {
        ...intent,
        text: intent.text || pending.text,
        date: intent.date ?? pending.date,
        hour: intent.hour ?? pending.hour,
        minute: intent.minute ?? (intent.hour != null ? 0 : pending.minute ?? 0),
        ...(pending.trackTask ? { trackTask: true, taskListName: pending.taskListName,
          date: extractHebrewDate(rawText)?.date ?? pending.date ?? intent.date } : {}),
      };
    } else if (pending && !["show-list", "list-lists", "list-reminders", "help",
      "greeting", "thanks", "farewell", "small-talk", "tell-time", "tell-date"].includes(intent.type)) {
      await setPendingAction(store, chatId, null);
    }

    if (intent.type === "tell-time" || intent.type === "tell-date") {
      intent = { ...intent, now: intent.now ?? new Date().toISOString() };
    }

    const response = await handleNaturalIntent(store, chatId, intent);
    return (
      response ??
      "אני איתך אח שלי. תכתוב לי מה תרצה לעשות, ואנסה לעזור."
    );
  } catch (error) {
    if (error instanceof UserInputError) {
      return `רק רגע אח שלי — ${error.message}`;
    }
    throw error;
  }
}

export async function resolvePendingList(store, chatId, rawText, { allowNaturalTarget = false } = {}) {
  const pending = getPendingListAction(store, chatId);
  if (!pending) return null;
  const text = rawText.trim();
  if (isListCancellation(text)) {
    await setPendingListAction(store, chatId, null);
    return "בסדר אח שלי, ביטלתי את ההוספה שעדיין לא הושלמה. לא הוספתי את הפריטים.";
  }
  // A new continuation replaces, rather than combines with, the old request.
  const continuation = parseListContinuation(text, null, Object.keys(store.lists[chatId] ?? {}));
  if (continuation?.type === "clarify" && allowNaturalTarget) return null;
  if (continuation?.pendingListItems) {
    await setPendingListAction(store, chatId, { items: continuation.pendingListItems });
    return continuation.response;
  }
  if (continuation) {
    await setPendingListAction(store, chatId, null);
    return continuation.response;
  }
  // Commands and explicit new requests are not destination replies.
  const localIntent = parseNaturalIntent(text);
  const readOnly = new Set(["show-list", "list-lists", "list-reminders", "greeting", "thanks",
    "farewell", "small-talk", "help", "tell-time", "tell-date"]);
  const newRequest = localIntent && !readOnly.has(localIntent.type);
  const informationalCommand = /^\/(?:start|help|show|lists|reminders|interrupted|reviewed|unreviewed)(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text);
  if (informationalCommand) return null;
  if (/^\//u.test(text) || parseExplicitListWrite(text)
    || (newRequest
      && !parsePendingListTarget(text, Object.keys(store.lists[chatId] ?? {})))) {
    await setPendingListAction(store, chatId, null);
    return null;
  }
  const listNames = Object.keys(store.lists[chatId] ?? {});
  const listName = parsePendingListTarget(text, listNames);
  if (!listName) {
    const query = /^(?:מה|איך|למה|מתי|איפה|מי|איזה|הצג|תציג|תראה)\s/u.test(text);
    const mentionsTarget = listNames.some(name => text.includes(name));
    const conversational = /^(?:היום|מחר|אני|אתה|אגב|יש|אין|רגע|אפשר|ספר|תספר|נדבר|בוא)(?:\s|$)/u.test(text);
    const shortTarget = /^[א-ת][א-ת ,?!־-]{0,60}$/u.test(text) && text.split(/\s+/u).length <= 3
      && !/^(?:היום|מחר|אני|אתה|אגב|יש|אין|רגע|אפשר)(?:\s|$)/u.test(text);
    if (!query && !conversational && (mentionsTarget || (shortTarget && (!localIntent || localIntent.type === "show-list")))) {
      if (allowNaturalTarget) return null;
      return "לא זיהיתי יעד יחיד וברור. הפריטים כבר שמורים להשלמה; לא הוספתי אותם עדיין. כתוב רק את שם הרשימה, או “ביטול”.";
    }
    // An unrelated conversational turn is not an answer to an old list prompt.
    // Keep the saved items, but let the conversational router handle this turn.
    return null;
  }
  // Items and removal of the pending request are persisted together. A failed
  // write retains the original request and rolls back the attempted addition.
  return handleNaturalIntent(store, chatId, {
    type: "add-items", listName, items: [...pending.items], consumePendingList: true,
  });
}

export async function resolvePendingReminder(store, chatId, text) {
  const savedPending = getPendingAction(store, chatId);
  if (!savedPending) return null;
  const pending = { ...savedPending };

  if (/^(?:עזוב|עזבי|לא משנה|בטל את זה|ביטול)[.! ]*$/u.test(text)) {
    await setPendingAction(store, chatId, null);
    return "בסדר, ביטלתי את התזכורת שעדיין לא הושלמה.";
  }

  const intent = parseNaturalIntent(text);
  if (intent?.type === "reminder") {
    // Replacing/completing the request must not discard the old durable
    // context in a separate write before the replacement can be saved.
    const same = !intent.text || normalizedItemText(intent.text) === normalizedItemText(pending.text);
    return beginReminder(store, chatId, same ? {
      ...intent, text: intent.text || pending.text,
      date: intent.date ?? pending.date, hour: intent.hour ?? pending.hour,
      minute: intent.minute ?? (intent.hour != null ? 0 : pending.minute ?? 0),
      ...(pending.trackTask ? { trackTask: true, taskListName: pending.taskListName,
        date: extractHebrewDate(text)?.date ?? pending.date ?? intent.date } : {}),
    } : intent);
  }
  if (intent && intent.type !== "reminder") {
    if (["greeting", "thanks", "farewell", "small-talk", "help", "tell-time", "tell-date",
      "show-list", "list-lists", "list-reminders"].includes(intent.type)) return null;
    await setPendingAction(store, chatId, null);
    return handleNaturalIntent(store, chatId, intent);
  }

  const dateMatch = extractHebrewDate(text);
  let timeMatch = extractHebrewTime(text);
  if (!timeMatch && !dateMatch
    && /^(?:\d{1,2}|אחת|אחד|שתיים|שניים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר|אחת עשרה|שתים עשרה)(?:\s+(?:בבוקר|בצהריים|בערב|בלילה))?$/u.test(text.trim())) {
    const clock = extractHebrewTime(`בשעה ${text.trim()}`);
    if (clock) timeMatch = { ...clock, start: 0, end: text.length };
  }
  if (!dateMatch && !timeMatch && (pending.text || /[?]|^(?:מה|איך|למה|האם)\s/u.test(text))) return null;
  if (dateMatch || timeMatch) {
    let remainder = text;
    const spans = [dateMatch, timeMatch].filter(Boolean).sort((a, b) => b.start - a.start);
    for (const span of spans) remainder = `${remainder.slice(0, span.start)} ${remainder.slice(span.end)}`;
    if (!/^(?:\s|[,!.־-]|כבר\s+אמרתי|כמו\s+שאמרתי|כן|סגור|סבבה|בבקשה|זה|ב)*$/u.test(remainder)) return null;
  }
  if (dateMatch) pending.date = dateMatch.date;
  if (timeMatch) {
    pending.hour = timeMatch.hour;
    pending.minute = timeMatch.minute;
  } else if (!dateMatch && !pending.text) {
    pending.text = ensureText(text, "תוכן התזכורת", 300);
  }

  if (pending.date && pending.hour !== null && pending.text) {
    try {
      return await scheduleReminder(
        store,
        chatId,
        pending.text,
        pending.date,
        pending.hour,
        pending.minute ?? 0,
        pending,
      );
    } catch (error) {
      if (error instanceof UserInputError || error.message.includes("מועד שעדיין")) {
        return error.message;
      }
      throw error;
    }
  }

  await setPendingAction(store, chatId, pending);
  return missingReminderDetail(pending.date, pending.hour, pending.text, pending.trackTask);
}

export async function handleText(store, chatId, rawText) {
  const text = rawText.trim();
  if (!text) return "אני פה אח שלי, כשתרצה פשוט תכתוב לי מה צריך.";

  const commandMatch = /^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
  try {
    const deletion = parseListDeletion(text);
    if (deletion) return handleAssistantIntent(store, chatId, deletion, text);
    const pendingListResponse = await resolvePendingList(store, chatId, text);
    if (pendingListResponse !== null) return pendingListResponse;
    if (commandMatch) {
      return await runCommand(
        store,
        chatId,
        commandMatch[1].toLowerCase(),
        commandMatch[2] ?? "",
      );
    }

    const continuation = parseListContinuation(text, getLastListAction(store, chatId),
      Object.keys(store.lists[chatId] ?? {}));
    if (continuation) return handleAssistantIntent(store, chatId, continuation, text);

    const pendingResponse = await resolvePendingReminder(store, chatId, text);
    if (pendingResponse !== null) return pendingResponse;

    const intent = parseNaturalIntent(text);
    const response = intent
      ? await handleNaturalIntent(store, chatId, intent)
      : null;
    return (
      response ??
      "אני איתך אח שלי. כרגע אני יודע לעזור עם רשימות, משימות ותזכורות, ולא רוצה להמציא תשובה על משהו שאני לא יודע. אם יש משהו לשמור או להזכיר לך, כתוב לי חופשי."
    );
  } catch (error) {
    if (error instanceof UserInputError) {
      return `רק רגע אח שלי — ${error.message}`;
    }
    throw error;
  }
}
