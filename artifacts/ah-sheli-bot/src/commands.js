async function handleNaturalIntent(store, chatId, intent, rawText = "") {
  const chatLists = getChatLists(store, chatId);

  // מנגנון הגנה קשיחה: אם ההודעה מכילה זמנים/שורות לו״ז, נאכוף מיידית schedule-reminders נקי
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const hasSchedulePattern = lines.some(l => /^\d{1,2}:\d{2}/u.test(l)) || /תעדכן.*לוח הזמנים|השכמה|שעון נוכחות/u.test(rawText);

  let targetIntent = intent;
  if (hasSchedulePattern) {
    const parsedReminders = [];
    for (const line of lines) {
      const match = line.match(/^(\d{1,2}):(\d{2})\s*(.*)$/u);
      if (match) {
        parsedReminders.push({
          text: match[3] ? match[3].trim() : "תזכורת",
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
