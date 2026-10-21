import test from "node:test";
import assert from "node:assert/strict";
import { nextReminderDetails } from "../src/next-reminder.js";
import { formatJerusalemTime } from "../src/time.js";

const now = Date.parse("2026-10-09T04:00:00Z");
const nextTime = Date.parse("2026-10-09T04:30:00Z");

test("next reminder is chronological, owner-only, unsent, and read-only", () => {
  const store = {
    reminders: [
      { chatId: "owner", text: "מאוחרת", dueAt: nextTime + 60_000 },
      { chatId: "foreign", text: "פרטית", dueAt: now + 1 },
      { chatId: "owner", text: "כבר נשלחה", dueAt: now + 2, sentAt: now },
      { chatId: "owner", text: "תוצאה לא ודאית", dueAt: now + 3, lastAttemptAt: now },
      { chatId: "owner", text: "איסוף", dueAt: nextTime },
    ],
    lists: { owner: { משימות: [{ text: "לא תזכורת" }] } },
  };
  const before = structuredClone(store);
  const reply = nextReminderDetails(store, "owner", now);
  assert.equal(reply, `הבאה בתור: איסוף\nב־${formatJerusalemTime(nextTime)}.`);
  assert.match(reply, /7:30/u, "UTC 04:30 is 07:30 in Israel on this date");
  assert.deepEqual(store, before);
});

test("empty queue is explicit and invalid times are not displayed", () => {
  assert.equal(nextReminderDetails({ reminders: [] }, "owner", now),
    "כרגע אין עוד תזכורת בתור.");
  assert.equal(nextReminderDetails({ reminders: [
    { chatId: "owner", text: "לא תקינה", dueAt: NaN },
  ] }, "owner", now), "כרגע אין עוד תזכורת בתור.");
});

test("next-day dates and overdue queue entries are disclosed without rescheduling", () => {
  const tomorrow = Date.parse("2026-10-10T04:30:00Z");
  const future = { reminders: [{ chatId: "owner", text: "מחר", dueAt: tomorrow }] };
  assert.equal(nextReminderDetails(future, "owner", now),
    `הבאה בתור: מחר\nב־${formatJerusalemTime(tomorrow)}.`);
  const overdue = { reminders: [{ chatId: "owner", text: "ממתינה", dueAt: now - 60_000 }] };
  assert.match(nextReminderDetails(overdue, "owner", now), /המועד שלה כבר הגיע/u);
  assert.equal(overdue.reminders[0].dueAt, now - 60_000);
});
