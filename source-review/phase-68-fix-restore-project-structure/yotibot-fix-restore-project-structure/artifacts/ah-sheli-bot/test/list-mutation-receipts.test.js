import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-list-receipts-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { replyToOwnerMessage } = await import("../src/message-handler.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { collectListReceipts, recordListReceipt, listReceiptText } = await import("../src/list-mutation-receipts.js");
after(() => rm(directory, { recursive: true, force: true }));

test("natural task CRUD delivers one clean interactive menu backed by the actual saved list", async () => {
  const store = createEmptyStore();
  store.lists.a = { משימות: [
    { id: "committee", text: "לאסוף וועד", checked: false },
    { id: "milk", text: "לקנות חלב", checked: false },
    { id: "done", text: "ללכת לספר", checked: true },
  ] };
  store.lists.b = { משימות: [{ id: "foreign", text: "לאסוף ועד", checked: false }] };
  const messages = [];
  const telegram = { sendMessage: async (_chat, text, options) => { messages.push({ text, options }); } };
  const options = { readHistory: async () => [], saveConversation: async () => {},
    assistant: (store, chat, text) => handleAssistantMessage(store, chat, text,
      async () => assert.fail("A clear owned target needs no AI round trip")) };
  const assertMenu = (included, excluded) => {
    assert.equal(messages.length, 1);
    assert.equal(messages[0].options.parse_mode, "HTML");
    const rows = messages[0].options.reply_markup.inline_keyboard;
    const labels = rows.flat().map(button => button.text).join("\n");
    for (const text of included) assert.ok(labels.includes(text), text);
    for (const text of excluded) assert.ok(!labels.includes(text), text);
    assert.doesNotMatch(messages[0].text, /□\s+\d|✓\s+\d|לא מצאתי|לא בוצע שינוי|מסד הנתונים/u);
    messages.length = 0;
  };
  await replyToOwnerMessage(store, telegram, "a", "תוריד לאסוף ועד", options);
  assertMenu(["לקנות חלב"], ["לאסוף וועד", "ללכת לספר"]);
  assert.ok(!store.lists.a.משימות.some(item => item.id === "committee"));
  assert.equal(store.lists.b.משימות[0].text, "לאסוף ועד");
  await replyToOwnerMessage(store, telegram, "a", "לדבר עם עורך הדין", options);
  assertMenu(["לקנות חלב", "לדבר עם עורך הדין"], ["ללכת לספר"]);
  await replyToOwnerMessage(store, telegram, "a", "סיימתי עם עורך הדין", options);
  assertMenu(["לקנות חלב"], ["לדבר עם עורך הדין", "ללכת לספר"]);
  assert.equal(store.lists.a.משימות.find(item => item.text === "לדבר עם עורך הדין").checked, true);
});

test("shopping additions show a cart header and real item buttons without the technical numbered list", async () => {
  const store = createEmptyStore();
  const messages = [];
  await replyToOwnerMessage(store, {
    sendMessage: async (_chat, text, options) => messages.push({ text, options }),
  }, "shopping", "תוסיף ביצים לרשימת קניות", {
    readHistory: async () => [], saveConversation: async () => {},
    assistant: (store, chat, text) => handleAssistantMessage(store, chat, text,
      async () => assert.fail("Explicit list addition is deterministic")),
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /🛒 קניות|הוספתי: ביצים/u);
  assert.doesNotMatch(messages[0].text, /מטרות מתמשכות|□\s+\d/u);
  assert.ok(messages[0].options.reply_markup.inline_keyboard.flat().some(button => button.text.includes("ביצים")));
  assert.equal(store.lists.shopping.קניות[0].text, "ביצים");
  messages.length = 0;
  await replyToOwnerMessage(store, {
    sendMessage: async (_chat, text, options) => messages.push({ text, options }),
  }, "shopping", "רשימת קניות", {
    readHistory: async () => [], saveConversation: async () => {},
  });
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0].text, /□\s+\d|✓\s+\d/u);
  assert.ok(messages[0].options.reply_markup.inline_keyboard.flat().some(button => button.text.includes("ביצים")));
});

test("concurrent receipt scopes cannot leak another user's changes and failed work cannot publish success", async () => {
  const [a, b] = await Promise.all([
    collectListReceipts(async () => {
      await Promise.resolve();
      recordListReceipt("a", "משימות", [], [{ id: "a", text: "first", checked: false }]);
      return "a";
    }),
    collectListReceipts(async () => {
      recordListReceipt("b", "משימות", [], [{ id: "b", text: "second", checked: false }]);
      return "b";
    }),
  ]);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].chatId, "a");
  assert.equal(b.events[0].chatId, "b");
  assert.match(listReceiptText(a.events[0]), /first/u);
  assert.doesNotMatch(listReceiptText(a.events[0]), /second/u);
  await assert.rejects(collectListReceipts(async () => {
    throw new Error("write failed");
  }), /write failed/u);
});

test("negative free phrasing cannot authorize removal or editing even if AI misclassifies it", async () => {
  const store = createEmptyStore();
  store.lists.safe = { משימות: [{ id: "safe", text: "לאסוף וועד", checked: false }] };
  for (const [text, type] of [["אל תוריד לאסוף ועד", "remove-item"],
    ["אל תשנה את לאסוף ועד", "update-item"], ["לא תסמן את לאסוף ועד", "mark-item"]]) {
    await handleAssistantMessage(store, "safe", text,
      async () => ({ type, itemText: "לאסוף ועד", text: "כותרת אחרת" }));
    assert.deepEqual(store.lists.safe.משימות, [{ id: "safe", text: "לאסוף וועד", checked: false }]);
  }
});
