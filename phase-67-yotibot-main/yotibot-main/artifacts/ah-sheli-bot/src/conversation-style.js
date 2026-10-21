// Local variation keeps saved-action confirmations friendly without another AI call.
const openings = ["סגור", "בשמחה אחי", "בכיף"];
export const completionEncouragements = Object.freeze([
  "ענק! אלוף, ממשיכים הלאה 💪",
  "יפה מאוד, מה הלאה?",
  "כל הכבוד! קדימה לתזכורת הבאה 💪",
  "סגרת את זה, אחי! כל הכבוד.",
  "איזה יופי! עוד משהו מאחוריך.",
  "אלוף! ממשיכים בקצב שלך.",
]);
let lastEncouragement = -1;

export function completionEncouragement() {
  // Pick freely, but never repeat the immediately preceding response.
  const choices = completionEncouragements.length - (lastEncouragement >= 0 ? 1 : 0);
  let index = Math.floor(Math.random() * choices);
  if (lastEncouragement >= 0 && index >= lastEncouragement) index++;
  lastEncouragement = index;
  return completionEncouragements[index];
}
let nextOpening = 0;

export function friendlyConfirmation(detail) {
  const opening = openings[nextOpening];
  nextOpening = (nextOpening + 1) % openings.length;
  return `${opening}, ${detail}`;
}

// Remove only the reported generic closing at the end, never quoted body text.
export function stripRepetitiveClosing(reply) {
  const cleaned = reply.replace(
    /(?:^|\n+|(?<=[.!?])\s+)אם\s+יש\s+משהו\s+ספציפי\s+שתרצה\s+להוסיף[^.!?\n]*(?:[.!?…]+)?\s*$/u,
    "",
  );
  if (cleaned === reply) return reply;
  return cleaned.trim() ? cleaned.trimEnd() : "אני איתך, אחי.";
}
