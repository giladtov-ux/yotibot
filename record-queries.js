// Exact retrieval requests bypass AI and always read the correct record type.
export function parseRecordQuery(rawText) {
  const text = rawText.trim().replace(/\s+/gu, " ").replace(/[?!.]+$/u, "").trim();
  if (/^(?:(?:מה|אילו)\s+|(?:הצג|תציג|תראה|תראי)\s+(?:לי\s+)?(?:את\s+)?)?(?:ה?רשימת\s+)?ה?תזכורות(?:\s+שלי)?$/u.test(text)) {
    return { type: "list-reminders" };
  }
  const list = /^(?:מה\s+(?:היא\s+)?|מה\s+יש\s+ב|(?:הצג|תציג|תראה|תראי)\s+(?:לי\s+)?(?:את\s+)?)(?:ה?רשימ(?:ת|ה)\s+)(.+?)(?:\s+שלי)?$/u.exec(text);
  if (list) return { type: "show-list", name: list[1] };
  const common = /^(?:(?:מה|אילו)\s+|(?:הצג|תציג|תראה|תראי)\s+(?:לי\s+)?(?:את\s+)?)?(?:ה?רשימת\s+)?(?:ה)?(משימות|קניות)(?:\s+שלי)?$/u.exec(text);
  if (common) return { type: "show-list", name: common[1] };
  if (/^(?:(?:מה|אילו)\s+|(?:הצג|תציג|תראה|תראי)\s+(?:לי\s+)?(?:את\s+)?)?(?:ה)?(?:תזכורות|לו[״"׳']?ז|לוח\s+ה?זמנים)(?:\s+שלי)?$/u.test(text)) {
    return { type: "list-reminders" };
  }
  return null;
}

export function parseExplicitListWrite(rawText) {
  const match = /^(?:בבקשה\s+)?(?:שמור|תשמור|צור|תיצור|הוסף|תוסיף)\s+(?:לי\s+)?(?:את\s+)?רשימ(?:ת|ה)\s+([^:\n|]+)[:|]\s*([\s\S]+)$/u.exec(rawText.trim());
  if (!match) return null;
  const items = match[2].split(/[\n,;]+/u).map(item => item.trim()).filter(Boolean);
  if (!items.length || items.length > 20 || items.some(item => item.length > 200)) {
    return { type: "clarify", response: "לא נשמרה הרשימה: אפשר לשמור עד 20 פריטים יחד, עד 200 תווים לפריט. לא יצרתי מהם תזכורות." };
  }
  return { type: "add-items", listName: match[1].trim().replace(/^ה(?=משימות|קניות)/u, ""), items };
}
