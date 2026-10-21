// Only code-owned saved context may supply the destination. Neither history
// nor the model's suggested action may supply items for a continuation.
export function parseListContinuation(rawText, lastListAction = null, listNames = []) {
  const match = /^(?:בבקשה\s+)?(?:(?:תוסיף|הוסף|תוסיפי|הוסיפי)\s+(?:לי\s+)?)?(?:וגם|גם)\s+([\s\S]+)$/u.exec(rawText.trim());
  if (!match) return null;
  const clarify = response => ({ type: "clarify", response });
  const body = match[1].trim().replace(/[.!]+$/u, "").trim();
  const namesListTarget = listNames.some(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|\\s)ל(?:ה)?${escaped}(?:\\s|$)`, "u").test(body);
  });
  // Do not interpret analysis, cancellation, questions, reminders or a new
  // destination as literal list items, or guess which part of a compound turn
  // belongs to which action.
  if (namesListTarget || /[?]|רשימ(?:ת|ה|ות)|(?:^|[\s,;:])ו?(?:אל|לא|בלי|לדוגמה|דוגמה|ציטוט|האם|תזכיר(?:י|ו)?|תזכר(?:י|ו)?|הזכר(?:י|ו)?|להזכיר|להתריע|להודיע|תזכורת|תזכורות|התראה|התראות|תמחק(?:י|ו)?|מחק(?:י|ו)?|תסיר(?:י|ו)?|הסר(?:י|ו)?|סמן(?:י|ו)?|תסמן(?:י|ו)?|תוסיף(?:י|ו)?|הוסף(?:י|ו)?|תוסיפי|הוסיפי|שלח(?:י|ו)?|תשלח(?:י|ו)?|תודיע(?:י|ו)?|הודע(?:י|ו)?|תתריע(?:י|ו)?|שים|שימי|תשים|תשימי|קבע(?:י|ו)?|תקבע(?:י|ו)?|במקום)(?:\s|$)/u.test(body)
    || /(?:^|\s)(?:ל|ב)(?:קניות|משימות|עבודה|בית|מכולת)(?:\s|$)/u.test(body)) {
    return clarify("מה בדיוק להוסיף, ולאיזו רשימה? עדיין לא שמרתי דבר.");
  }
  const items = body.replace(/\s+וגם\s+/gu, ",")
    .split(/[\n,;]+|\s+ו(?=[א-ת])/u).map(item => item.trim()).filter(Boolean);
  // An unnamed/new destination must not become part of an item merely because
  // it is absent from the saved list catalog (e.g. "ביצים למסיבה").
  // Infinitive task phrases may contain their own object ("להתקשר לבנק").
  const taskPhrase = /^ל(?:ה[א-ת]+|קנות|שלוח|כתוב|עשות|בדוק|סדר|תאם|תכנן|קפוץ|לכת|קרוא|בקר|זכור|פגוש|דבר|שלם|נקות|שטוף|ארגן|אסוף|תקן)(?:\s|$)/u;
  if (items.some(item => !taskPhrase.test(item) && /\S\s+ל[א-ת]/u.test(item))) {
    return clarify("מה בדיוק להוסיף, ולאיזו רשימה? עדיין לא שמרתי דבר.");
  }
  if (!items.length || items.length > 20 || items.some(item => item.length > 200)) {
    return clarify("אילו פריטים להוסיף? אפשר עד 20 פריטים יחד, עד 200 תווים לפריט. עדיין לא שמרתי דבר.");
  }
  if (!lastListAction?.listName) {
    return { ...clarify("לאיזו רשימה להוסיף את הפריטים? עדיין לא שמרתי דבר."),
      pendingListItems: items };
  }
  return { type: "add-items", listName: lastListAction.listName, items };
}

export function isListCancellation(text) {
  return /^(?:עזוב|עזבי|לא משנה|בטל|תבטל|בטל את זה|ביטול|\/cancel)[.! ]*$/u.test(text.trim());
}

// Match the entire reply against this chat's catalog. Never extract a target
// from a compound instruction, model prose, or another chat's records.
export function parsePendingListTarget(text, listNames) {
  const normalized = text.trim().replace(/[.!]+$/u, "").trim()
    .replace(/^(?:לרשימת|ברשימת|רשימת|הרשימה|רשימה)\s+/u, "")
    .toLocaleLowerCase("he-IL");
  const exact = listNames.find(name => name.toLocaleLowerCase("he-IL") === normalized);
  if (exact) return exact;
  const target = normalized.replace(/^[לב](?=[א-ת])/u, "").replace(/^ה/u, "");
  const variants = listNames.filter(name =>
    name.toLocaleLowerCase("he-IL").replace(/^ה/u, "") === normalized.replace(/^ה/u, "")
      || name.toLocaleLowerCase("he-IL").replace(/^ה/u, "") === target);
  return variants.length === 1 ? variants[0] : null;
}
