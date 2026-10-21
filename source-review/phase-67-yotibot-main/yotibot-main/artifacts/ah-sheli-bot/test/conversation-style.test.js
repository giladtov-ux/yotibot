import assert from "node:assert/strict";
import test from "node:test";
import { friendlyConfirmation } from "../src/conversation-style.js";
import { systemPrompt } from "../src/assistant-intent.js";

test("local confirmations vary naturally and preserve their factual contents", () => {
  const details = "אזכיר לך מחר ב־10:00: להתקשר לבנק";
  const confirmations = Array.from({ length: 3 }, () => friendlyConfirmation(details));
  assert.equal(new Set(confirmations).size, 3);
  for (const confirmation of confirmations) {
    assert.match(confirmation, /^(סגור|בשמחה אחי|בכיף), /u);
    assert.ok(confirmation.endsWith(details));
  }
  const listReply = friendlyConfirmation("הוספתי חלב לרשימה “קניות”.");
  assert.match(listReply, /הוספתי חלב לרשימה “קניות”/u);
  assert.doesNotMatch(listReply, /אזכיר|תזכורת|לו״ז/u);
});

test("reference chat style is concise and contextual without inventing actions or omitting data", () => {
  assert.match(systemPrompt, /בשיחת חולין, לרוב מספיק משפט אחד קצר/u);
  assert.match(systemPrompt, /לשאלה "מה זה סע לשלום\?" — "ברכה לדרך"/u);
  assert.match(systemPrompt, /ל"תודה" — "בכיף"/u);
  assert.match(systemPrompt, /לא לתשובות אוטומטיות/u);
  assert.match(systemPrompt, /אל תשבח את עצמך ואל תהיה מתגונן/u);
  assert.match(systemPrompt, /אלא כשאותה פעולה באמת אושרה בקוד/u);
  assert.match(systemPrompt, /הקיצור הוא בניסוח ובטקסט שמסביב, לא במידע/u);
});

test("Botivatzia reference affects phrasing only, not schedules or unsolicited messages", () => {
  assert.match(systemPrompt, /על תיקון אמיתי אפשר לענות "צודק, טעות שלי."/u);
  assert.match(systemPrompt, /בלי "אם יש משהו נוסף שתרצה להוסיף או לשנות, תן לי לדעת" בסוף/u);
  assert.match(systemPrompt, /אל תעתיק מהדוגמה אירועים, שעות או טעויות/u);
  assert.match(systemPrompt, /שליחה יזומה נקבעת אך ורק במנגנון התזכורות הקיים/u);
});

test("ordinary replies are brief and contextual fragments do not justify guessed writes", () => {
  assert.match(systemPrompt, /בשיחה רגילה ענה במשפט אחד או שניים קצרים/u);
  assert.match(systemPrompt, /רשימות ולוחות זמנים נשארים מלאים/u);
  assert.match(systemPrompt, /"תוס שמנת" בהמשך קניות/u);
  assert.match(systemPrompt, /שאל בקצרה במקום לנחש/u);
});
