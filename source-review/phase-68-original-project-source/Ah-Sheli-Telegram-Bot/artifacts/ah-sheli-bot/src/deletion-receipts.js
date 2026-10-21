// This is a guard on model-generated receipts, not an intent keyword router.
// Real actions keep their existing semantic interpretation and validated writer.
export function isDeletionSuccessClaim(response) {
  if (typeof response !== "string") return false;
  const verbs = "(?:מחקתי|מחקנו|ניקיתי|ניקינו|רוקנתי|רוקנו|הסרתי|הסרנו|איפסתי|איפסנו)";
  const withoutNegatives = response.replace(new RegExp(`(?:לא|טרם|עדיין לא)\\s+${verbs}`, "gu"), "");
  const prefix = "^[\\s\\p{P}\\p{S}]*(?:(?:אחי|אח שלי|סגור|בטח|בסדר|כן|מעולה|בוצע|כבר)[\\s\\p{P}\\p{S}]+)*";
  return new RegExp(`${prefix}${verbs}(?:\\s|[,.!]|$)`, "u").test(withoutNegatives)
    || new RegExp(`${prefix}(?:כל\\s+)?(?:הרשימה|הפריט|המשימה|הפריטים)(?:\\s+שלך)?\\s+`
      + "(?:נמחק(?:ה|ו)?|נוקתה|אופס(?:ה|ו)?)(?:\\s|[,.!]|$)", "u").test(withoutNegatives);
}
