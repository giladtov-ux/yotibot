// These are owner-authored instructions, not actions inferred from AI prose.
export function parseListDeletion(rawText) {
  const text = rawText.trim().replace(/\s+/gu, " ").replace(/[.!]+$/u, "");
  const prefix = /^(?:(?:אחי|אח\s+שלי)[, ]+)?(?:(?:בבקשה|אנא)\s+)?(תסיר|הסר|תמחק|מחק|תנקה|נקה|רוקן|תרוקן)\s+(?:לי\s+)?(?:את\s+)?(.+)$/u.exec(text);
  if (!prefix) return null;
  const [, verb, body] = prefix;
  const cleanName = name => name.trim();
  const range = /^(?:(?:ה?סעיפים|ה?פריטים|ה?שורות|מספרים)\s+)?(?:מ[־-]?)?(\d+)\s*(?:[-־–—]|עד)\s*(\d+)\s+(?:מ|ב)(?:(?:רשימת|רשימה|הרשימה)\s+)?(.+)$/u.exec(body);
  const targetFirst = /^(?:מ|ב)(?:רשימת|רשימה|הרשימה)\s+(.+?)\s+(?:את\s+)?(?:ה?סעיפים|ה?פריטים|ה?שורות)\s+(?:מ[־-]?)?(\d+)\s*(?:[-־–—]|עד)\s*(\d+)$/u.exec(body);
  if (range || targetFirst) {
    return { type: "remove-range", listName: cleanName(range ? range[3] : targetFirst[1]),
      position: Number(range ? range[1] : targetFirst[2]),
      endPosition: Number(range ? range[2] : targetFirst[3]) };
  }
  const allItems = /^(?:כל\s+)?(?:ה?פריטים|ה?סעיפים|ה?שורות)\s+(?:מ|ב)(?:(?:רשימת|רשימה|הרשימה)\s+)?(.+)$/u.exec(body);
  if (allItems) return { type: "clear-list", listName: cleanName(allItems[1]) };
  const wholeList = /^(?:כל\s+)?(?:רשימת|רשימה|הרשימה)\s+(.+)$/u.exec(body);
  if (wholeList) return {
    type: /נקה|רוקן/u.test(verb) ? "clear-list" : "delete-list",
    listName: cleanName(wholeList[1]),
  };
  // An item-only deletion remains the existing remove-item operation.
  return null;
}
