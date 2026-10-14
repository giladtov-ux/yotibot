import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseNaturalIntent } from "../src/natural-language.js";
import { getNextReminderAttemptAt } from "../src/reminder-timing.js";
import { extractHebrewTime, formatJerusalemTime } from "../src/time.js";

const temporaryDataDirectory = await mkdtemp(
  path.join(tmpdir(), "ah-sheli-tests-"),
);
process.env.AH_SHELI_DATA_DIR = temporaryDataDirectory;
const { handleText } = await import("../src/commands.js");
const { createEmptyStore } = await import("../src/store.js");

after(async () => {
  await rm(temporaryDataDirectory, { recursive: true, force: true });
});

const fixedNow = new Date("2026-10-02T06:00:00.000Z");

test("parses adding multiple items to a named Hebrew list", () => {
  assert.deepEqual(
    parseNaturalIntent("תוסיף חלב וביצים לרשימת הקניות", fixedNow),
    {
      type: "add-items",
      items: ["חלב", "ביצים"],
      listName: "הקניות",
    },
  );
});

test("parses list creation and list display requests", () => {
  assert.deepEqual(parseNaturalIntent("צור רשימת קניות חדשה", fixedNow), {
    type: "create-list",
    name: "קניות",
  });
  assert.deepEqual(
    parseNaturalIntent("תראה לי את רשימת הקניות", fixedNow),
    { type: "show-list", name: "הקניות" },
  );
});

test("understands shorthand list requests and everyday task statements", () => {
  assert.deepEqual(parseNaturalIntent("תוסיף חלב לקניות", fixedNow), {
    type: "add-items",
    items: ["חלב"],
    listName: "קניות",
  });
  assert.deepEqual(parseNaturalIntent("צריך לקפוץ לדואר", fixedNow), {
    type: "add-task",
    text: "לקפוץ לדואר",
  });
  assert.equal(parseNaturalIntent("תודה רבה", fixedNow).type, "thanks");
});

test("parses a full reminder with a Hebrew date and morning time", () => {
  assert.deepEqual(
    parseNaturalIntent("תזכיר לי מחר ב-10 בבוקר ללכת לדואר", fixedNow),
    {
      type: "reminder",
      text: "ללכת לדואר",
      date: "2026-10-03",
      hour: 10,
      minute: 0,
    },
  );
});

test("asks for a time when the reminder specifies only a weekday", () => {
  assert.deepEqual(
    parseNaturalIntent("תזכיר לי ביום ראשון ללכת לבנק", fixedNow),
    {
      type: "reminder",
      text: "ללכת לבנק",
      date: "2026-10-04",
      hour: null,
      minute: null,
    },
  );
});

test("parses a follow-up time such as 10 in the morning", () => {
  assert.deepEqual(extractHebrewTime("10 בבוקר"), {
    hour: 10,
    minute: 0,
    start: 0,
    end: 8,
  });
});

test("schedules the next reminder at its due time and respects retry delay", () => {
  assert.equal(
    getNextReminderAttemptAt([
      { dueAt: 12_000 },
      { dueAt: 4_000, lastAttemptAt: 2_000 },
      { dueAt: 1_000, sentAt: 5_000 },
    ]),
    12_000,
  );
  assert.equal(
    getNextReminderAttemptAt([{ dueAt: 4_000, lastAttemptAt: 2_000 }]),
    62_000,
  );
  assert.equal(getNextReminderAttemptAt([{ dueAt: 1_000, sentAt: 5_000 }]), Infinity);
});

test("adds requested items to a newly created list", async () => {
  const store = createEmptyStore();
  const response = await handleText(
    store,
    "chat-1",
    "תוסיף חלב וביצים לרשימת הקניות",
  );

  assert.match(response, /קניות:/);
  assert.deepEqual(
    store.lists["chat-1"]["קניות"].map((item) => item.text),
    ["חלב", "ביצים"],
  );
});

test("handles the simple free-text list request", async () => {
  const store = createEmptyStore();
  const response = await handleText(store, "chat-bread", "תוסיף לחם לרשימת קניות");

  assert.match(response, /קניות:/);
  assert.deepEqual(
    store.lists["chat-bread"]["קניות"].map((item) => item.text),
    ["לחם"],
  );
});

test("saves an everyday task in the default tasks list", async () => {
  const store = createEmptyStore();
  const response = await handleText(store, "chat-task", "צריך לקפוץ לדואר");

  assert.match(response, /משימות:/u);
  assert.equal(store.lists["chat-task"]["משימות"][0].text, "לקפוץ לדואר");
});

test("answers warmly without inventing answers to unsupported questions", async () => {
  const store = createEmptyStore();
  const response = await handleText(store, "chat-unknown", "מה מזג האוויר מחר?");

  assert.match(response, /אח שלי/u);
  assert.match(response, /לא רוצה להמציא תשובה/u);
  assert.equal(store.lists["chat-unknown"], undefined);
});

test("manages list items through ordinary Hebrew messages", async () => {
  const store = createEmptyStore();
  await handleText(store, "chat-list", "תיצור רשימת קניות חדשה");
  await handleText(store, "chat-list", "תוסיף לחם לרשימת קניות");

  const markedResponse = await handleText(
    store,
    "chat-list",
    "סמן לחם ברשימת הקניות",
  );
  assert.match(markedResponse, /קניות:/);
  assert.match(markedResponse, /✓ 1\. 🍞 לחם/);
  assert.equal(store.lists["chat-list"]["קניות"][0].checked, true);

  const shown = await handleText(store, "chat-list", "תראה לי את רשימת הקניות");
  assert.match(shown, /לחם/u);
  assert.match(shown, /✓/u);

  const removedResponse = await handleText(
    store,
    "chat-list",
    "תמחק לחם מרשימת הקניות",
  );
  assert.match(removedResponse, /ריקה/);
  assert.equal(store.lists["chat-list"]["קניות"].length, 0);
});

test("schedules the simple free-text reminder request", async () => {
  const store = createEmptyStore();
  const response = await handleText(
    store,
    "chat-mail",
    "תזכיר לי מחר ב-10 בבוקר ללכת לדואר",
  );

  assert.match(response, /אזכיר לך/);
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].text, "ללכת לדואר");
  assert.match(formatJerusalemTime(store.reminders[0].dueAt), /10:00/u);
});

test("lists and cancels a reminder with natural language", async () => {
  const store = createEmptyStore();
  await handleText(
    store,
    "chat-cancel",
    "תזכיר לי מחר ב-10 בבוקר ללכת לדואר",
  );

  const listed = await handleText(store, "chat-cancel", "תזכורות");
  assert.match(listed, /ללכת לדואר/u);

  const cancelled = await handleText(
    store,
    "chat-cancel",
    "תבטל את התזכורת ללכת לדואר",
  );
  assert.match(cancelled, /ביטלתי/u);
  assert.equal(store.reminders.length, 0);
});

test("completes a reminder after asking for its missing time", async () => {
  const store = createEmptyStore();
  const firstResponse = await handleText(
    store,
    "chat-2",
    "תזכיר לי ביום ראשון ללכת לבנק",
  );
  assert.match(firstResponse, /באיזו שעה/);
  assert.equal(store.reminders.length, 0);

  const finalResponse = await handleText(store, "chat-2", "10 בבוקר");
  assert.match(finalResponse, /אזכיר לך/);
  assert.match(finalResponse, /ללכת לבנק/);
  assert.equal(store.reminders.length, 1);
  assert.equal(
    formatJerusalemTime(store.reminders[0].dueAt).includes("10:00"),
    true,
  );
  assert.equal(store.pendingActions["chat-2"], undefined);
});