import { getJerusalemDateString } from "./time.js";

const numbers = { אחת: 1, אחד: 1, שתי: 2, שתיים: 2, שני: 2, שניים: 2,
  שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שמונה: 8, תשע: 9, עשר: 10, עשרה: 10 };
const amount = `\\d+|${Object.keys(numbers).join("|")}`;
const duration = new RegExp(`(?:^|\\s)ב?עוד\\s+(?:(חצי|רבע)\\s+שעה|(שעתיים)|(${amount})\\s*(דקות|דקה|שעות|שעה)?)(?![א-ת\\d])`, "u");

export function relativeReminder(body, now, explicitRequest = false) {
  const match = duration.exec(body);
  if (!match || (!explicitRequest && match.index !== 0)) return null;
  const rest = body.slice(match.index + match[0].length);
  if (!match[4] && /^\s*(?:ימים?|שבועות?|חודשים?)(?:\s|$)/u.test(rest)) return null;
  const value = Number(match[3]) || numbers[match[3]];
  const minutes = match[1] ? (match[1] === "חצי" ? 30 : 15) : match[2] ? 120
    : value * (/שעה|שעות/u.test(match[4] ?? "") ? 60 : 1);
  const relativeDueAt = now.getTime() + minutes * 60_000;
  if (!Number.isFinite(relativeDueAt) || !(minutes > 0) || !Number.isFinite(new Date(relativeDueAt).getTime())) {
    return { type: "clarify", response: "בעוד כמה זמן להזכיר לך?" };
  }
  const at = new Date(relativeDueAt);
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(at).split(":").map(Number);
  const text = `${body.slice(0, match.index)} ${rest}`.trim()
    .replace(/^[\s.,;:!?…־-]+|[\s.,;:!?…־-]+$/gu, "").trim();
  return { type: "reminder", text, date: getJerusalemDateString(at), hour, minute, relativeDueAt };
}
