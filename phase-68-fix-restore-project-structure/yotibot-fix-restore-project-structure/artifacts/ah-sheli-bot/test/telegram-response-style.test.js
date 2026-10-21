import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-telegram-style-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { handleAuthorizedUpdate } = await import("../src/user-update-handler.js");
const { handleOwnerUpdate } = await import("../src/message-handler.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { parseJerusalemDateTime, getJerusalemDateString } = await import("../src/time.js");
after(() => rm(directory, { recursive: true, force: true }));
const date = Date.parse("2026-10-11T18:30:00Z");
function fixture() {
  const store = createEmptyStore(), sent = [], history = [];
  const transport = { sendMessage: async (_chat, text, options) => sent.push({ text, options }) };
  const options = {
    userAccess: { handle: async () => "12345", assertPermission: async () => {} },
    replyOptions: {
      readHistory: async () => [],
      readSummaryHistory: async () => ({ rows: history }),
      readDailySummaryStore: async (chat, _pool, now) => ({
        ...structuredClone(store),
        completedTasks: Object.entries(store.lists[chat] ?? {})
          .filter(([name]) => !/קניות|מצרכים/u.test(name))
          .flatMap(([, items]) => items.filter(item => item.checked
            && Number.isFinite(item.completedAt) && item.completedAt <= now
            && getJerusalemDateString(new Date(item.completedAt)) === getJerusalemDateString(new Date(now)))),
      }),
      summaryNow: () => date,
      saveConversation: async (_chat, text, reply) => history.push(
        { role: "user", content: text, createdAt: new Date(date) },
        { role: "assistant", content: reply, createdAt: new Date(date) }),
      assistant: (state, chat, text, _unused, rows, settings) => handleAssistantMessage(state, chat, text,
        () => assert.fail("Clear list and summary requests need no AI"), rows, settings),
    },
  };
  const update = text => ({ message: { chat: { id: 12345, type: "private" },
    from: { id: 12345, is_bot: false }, date: date / 1000, text } });
  return { store, sent, history, options, transport, update,
    run: text => handleAuthorizedUpdate(store, transport, update(text), options) };
}
test("real Telegram addition saves the item, sends only its short receipt, then explicit list still has buttons", async () => {
  const f = fixture();
  await f.run("תוסיף ביצים לרשימת קניות");
  assert.equal(f.store.lists["12345"].קניות[0].text, "ביצים");
  assert.deepEqual(f.sent, [{ text: "נוסף לרשימה", options: undefined }]);
  assert.equal(f.history.at(-1).content, "נוסף לרשימה");
  f.sent.length = 0;
  await f.run("סיכום יום והכנה למחר");
  assert.match(f.sent[0].text, /לא סומנו משימות שהושלמו היום/u);
  assert.doesNotMatch(f.sent[0].text, /ביצים/u);
  assert.equal(f.sent[0].options.reply_markup.inline_keyboard[0].length, 1);
  assert.equal(f.sent[0].options.reply_markup.inline_keyboard[0][0].text, "בוצע! ✅");
  f.sent.length = 0;
  await f.run("רשימת קניות");
  assert.equal(f.sent.length, 1);
  assert.ok(f.sent[0].options.reply_markup.inline_keyboard.flat()
    .some(button => button.text.includes("ביצים")));
});
test("Telegram daily summary names only dated completions, with one final action and no inventory gallery", async () => {
  const f = fixture();
  f.store.lists["12345"] = { קניות: [{ id: "milk", text: "חלב", checked: false }],
    משימות: [{ id: "private", text: "משימת רקע ארוכה", checked: true }] };
  f.history.push({ role: "assistant", content: "מעולה! סומן כבוצע: משימת רקע ארוכה.",
    createdAt: new Date(date - 1000) });
  f.store.reminders = [{ id: "wakeup", chatId: "12345", text: "השכמה",
    dueAt: parseJerusalemDateTime("2026-10-12", "06:10", { allowPast: true }) }];
  await f.run("סיכום יום והכנה למחר");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options.reply_markup.inline_keyboard[0].length, 1);
  assert.equal(f.sent[0].options.reply_markup.inline_keyboard[0][0].text, "בוצע! ✅");
  assert.match(f.sent[0].text, /^היום:\n[^\n]+\n\nמחר \(שני, 12\.10\):\n06:10 השכמה$/u);
  assert.doesNotMatch(f.sent[0].text, /חלב|משימת רקע/u);
  assert.match(f.sent[0].text, /לא סומנו משימות שהושלמו היום/u);
});
test("default internal presentation retains detailed addition and its item menu", async () => {
  const f = fixture();
  await handleOwnerUpdate(f.store, f.transport, f.update("תוסיף ביצים לרשימת קניות"), {
    ownerChatId: "12345", replyOptions: f.options.replyOptions,
  });
  assert.ok(f.sent[0].options.reply_markup.inline_keyboard.flat()
    .some(button => button.text.includes("ביצים")));
  assert.match(f.sent[0].text, /הוספתי/u);
  assert.notEqual(f.history.at(-1).content, "נוסף לרשימה");
});
test("a failed writer must not produce the short successful addition receipt", async () => {
  const f = fixture();
  f.options.replyOptions.assistant = async () => { throw new Error("synthetic DB write failed"); };
  await assert.rejects(f.run("תוסיף ביצים לרשימת קניות"), /DB write failed/u);
  assert.deepEqual(f.sent, []);
  assert.equal(f.history.length, 0);
  assert.equal(f.store.lists["12345"], undefined);
});
test("repeated accepted additions each send one short receipt without changing insertion behavior", async () => {
  const f = fixture();
  await f.run("תוסיף ביצים לרשימת קניות");
  f.sent.length = 0;
  await f.run("תוסיף ביצים לרשימת קניות");
  assert.equal(f.store.lists["12345"].קניות.length, 2);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options, undefined);
  assert.equal(f.sent[0].text, "נוסף לרשימה");
});
test("Telegram summary awaits a fresh database snapshot instead of cached state or assistant claims", async () => {
  const f = fixture();
  const snapshot = structuredClone(f.store);
  snapshot.lists["12345"] = { משימות: [
    { id: "done", text: "לאסוף ועד", checked: true, completedAt: date - 1000 },
    { id: "old", text: "השלמה ישנה", checked: true, completedAt: date - 86400000 },
    { id: "open", text: "משימה פתוחה", checked: false, completedAt: date - 1000 },
  ], קניות: [{ id: "milk", text: "חלב", checked: true, completedAt: date - 1000 }] };
  snapshot.reminders = [{ id: "wake", chatId: "12345", text: "השכמה מעודכנת",
    dueAt: parseJerusalemDateTime("2026-10-12", "07:30", { allowPast: true }) }];
  snapshot.completedTasks = [snapshot.lists["12345"].משימות[0]];
  let release;
  f.options.replyOptions.readDailySummaryStore = async chat => {
    assert.equal(chat, "12345");
    await new Promise(resolve => { release = resolve; });
    return snapshot;
  };
  f.options.replyOptions.assistant = () => assert.fail("Summary must not invoke an assistant");
  f.options.replyOptions.readSummaryHistory = () => assert.fail("Chat prose is not completion evidence");
  const pending = f.run("סיכום יום");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent.length, 0);
  release();
  await pending;
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, "היום:\nלאסוף ועד\n\nמחר (שני, 12.10):\n07:30 השכמה מעודכנת");
  assert.equal(f.sent[0].options.reply_markup.inline_keyboard[0][0].text, "בוצע! ✅");
});
test("database read failure never claims that nothing was completed", async () => {
  const f = fixture();
  f.options.replyOptions.readDailySummaryStore = async () => { throw new Error("synthetic read failure"); };
  await f.run("סיכום יום");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options, undefined);
  assert.match(f.sent[0].text, /לא הצלחתי לקרוא/u);
  assert.doesNotMatch(f.sent[0].text, /לא סומנו|הושלמו/u);
});
test("queued summary uses the current database-read clock, not the incoming message's truncated timestamp", async () => {
  const f = fixture();
  f.store.lists["12345"] = { משימות: [
    { id: "queued", text: "איסופים", checked: true, completedAt: date + 1000 },
  ] };
  f.options.replyOptions.summaryNow = () => date + 3000;
  await f.run("סיכום יום");
  assert.match(f.sent[0].text, /^היום:\nאיסופים\n\nמחר/u);
});

test("native Telegram schedules a tomorrow follow-up without a task gallery or task mutation", async () => {
  const f = fixture();
  f.store.lists["12345"] = { משימות: [{ id: "task", text: "חזרה למשימות", checked: false }] };
  f.options.replyOptions.readHistory = async () => [{
    role: "assistant", createdAt: new Date(date),
    content: "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר:\n06:10 השכמה",
  }];
  await f.run("9:00 חזרה למשימות");
  assert.equal(f.store.reminders.length, 1);
  assert.equal(f.store.lists["12345"].משימות.length, 1);
  assert.equal(f.store.lists["12345"].משימות[0].checked, false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options, undefined);
  assert.match(f.sent[0].text, /0?9:00.*חזרה למשימות/u);
});
