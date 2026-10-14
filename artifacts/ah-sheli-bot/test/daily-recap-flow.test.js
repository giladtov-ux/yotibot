import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "ah-recap-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ createEmptyStore, mutateList }, { handleDailyRecapMessage, handleDailyRecapCallback },
  { bindItemIntent, parseNaturalTaskAction }, { handleRecordViewAction },
  { menuRecords }, { getPool, closeDatabase }, { loadDailySummaryStore }] = await Promise.all([
  import("../src/store.js"), import("../src/daily-recap-flow.js"),
  import("../src/task-understanding.js"), import("../src/record-view-actions.js"),
  import("../src/record-menu.js"), import("../src/database.js"),
  import("../src/daily-summary-repository.js"),
]);
after(async () => { await closeDatabase(); await rm(directory, { recursive: true, force: true }); });
const time = Date.parse("2026-10-12T18:00:00Z");
const tomorrow = Date.parse("2026-10-13T03:10:00Z");
const itemKey = (actor, name, item, store) => menuRecords(store, actor, "s")
  .find(record => record.kind === "item" && record.name === name && record.id === item.id).key;
function fixture() {
  const store = createEmptyStore();
  store.lists.owner = { משימות: [
    { id: "a", text: "לראות את הקאנטרי", checked: false },
    { id: "b", text: "לאסוף ועד", checked: false },
    { id: "c", text: "לדבר עם עורך הדין", checked: false },
  ], קניות: [{ id: "milk", text: "חלב", checked: false }] };
  store.lists.other = { משימות: [{ id: "foreign", text: "לראות את הקאנטרי", checked: false }] };
  store.reminders = [{ id: "wake", chatId: "owner", text: "השכמה", dueAt: tomorrow }];
  return store;
}
function harness(store) {
  let saved = structuredClone(store);
  let writes = 0;
  const options = { now: () => time,
    persist: async candidate => { saved = structuredClone(candidate); writes++; },
    readSnapshot: async actor => ({
      completedTasks: Object.entries(saved.lists[actor] ?? {}).filter(([name]) => name === "משימות")
        .flatMap(([, items]) => items).filter(item => item.checked && item.completedAt === time),
      openTasks: Object.entries(saved.lists[actor] ?? {}).filter(([name]) => name === "משימות")
        .flatMap(([listName, items]) => items.filter(item => !item.checked && !item.scheduledDate)
          .map(item => ({ listName, item }))),
      deferredTomorrowTasks: (saved.lists[actor]?.משימות ?? []).filter(item => !item.checked && item.scheduledDate === "2026-10-13"),
      reminders: saved.reminders.filter(item => item.chatId === actor), savedSchedules: [],
    }),
  };
  const messages = [];
  const telegram = { call: async () => {}, sendMessage: async (actor, text, options) => messages.push({ actor, text, options }) };
  const callback = async (data, from = "owner") => handleDailyRecapCallback(store, telegram, {
    id: "query", data, from: { id: from }, message: { chat: { id: "owner", type: "private" } },
  }, { ...options, ownerChatId: "owner" });
  return { options, callback, messages, saved: () => saved, writes: () => writes };
}
test("natural completion handles past-tense suffix, country morphology, typo, and owner boundaries", () => {
  for (const text of ["הלכתי לראות את הקאנטרי בוצע", "הלכתי לקאנטרי בוצע", "לראות את הקנטרי בוצע", "ביקרתי בקאנטרי"]) {
    const store = fixture();
    const intent = parseNaturalTaskAction(text);
    assert.equal(intent.type, "mark-item");
    const bound = bindItemIntent(store, "owner", intent, text);
    assert.equal(bound.itemId, "a");
    assert.equal(bound.listName, "משימות");
  }
  assert.equal(parseNaturalTaskAction("לא הלכתי לקאנטרי בוצע"), null);
  assert.equal(parseNaturalTaskAction("הלכתי לקאנטרי אבל לא בוצע"), null);
  const store = fixture();
  store.lists.owner.משימות.push({ id: "ambiguous", text: "אימון בקאנטרי", checked: false });
  assert.equal(bindItemIntent(store, "owner", parseNaturalTaskAction("הלכתי לקאנטרי בוצע")).type, undefined);
});
test("free-text completion acknowledges only saved work, without menus or an AI clarification", async () => {
  const store = fixture(); const h = harness(store);
  const result = await handleDailyRecapMessage(store, "owner", "הלכתי לראות את הקאנטרי בוצע", h.options);
  assert.equal(result.length, 1);
  assert.match(result[0].text, /סימנתי שביצעת: לראות את הקאנטרי/u);
  assert.equal(result[0].options, undefined);
  assert.equal(h.saved().lists.owner.משימות[0].completedAt, time);
  assert.equal(h.saved().lists.other.משימות[0].checked, false);
  const writes = h.writes();
  assert.match((await handleDailyRecapMessage(store, "owner", "הלכתי לקאנטרי בוצע", h.options))[0].text, /כבר סומן כבוצע/u);
  assert.equal(h.writes(), writes);
  const fresh = fixture();
  await assert.rejects(handleDailyRecapMessage(fresh, "owner", "הלכתי לקאנטרי בוצע",
    { ...harness(fresh).options, persist: async () => { throw new Error("SQL failed"); } }), /SQL failed/);
  assert.equal(fresh.lists.owner.משימות[0].checked, false);
});
test("shopping completion archives, completes its existing task, retains history and is idempotent", async () => {
  const store = fixture(); store.lists.owner.משימות.push({ id: "buy", text: "קניות", checked: false });
  const h = harness(store);
  const result = await handleDailyRecapMessage(store, "owner", "קניות בוצע", h.options);
  assert.equal(result.length, 1);
  assert.equal(result[0].options, undefined);
  assert.equal(h.saved().listStatuses.owner.קניות.status, "completed");
  assert.equal(h.saved().lists.owner.קניות[0].checked, true);
  assert.equal(h.saved().lists.owner.משימות.at(-1).completedAt, time);
  const writes = h.writes();
  await handleDailyRecapMessage(store, "owner", "קניות בוצע", h.options);
  assert.equal(h.writes(), writes);
});
test("shopping task can be completed even when there is no shopping-list collection", async () => {
  const store = fixture();
  delete store.lists.owner.קניות;
  store.lists.owner.משימות.push({ id: "buy", text: "לעשות קניות", checked: false });
  const h = harness(store);
  const result = await handleDailyRecapMessage(store, "owner", "קניות בוצע", h.options);
  assert.match(result[0].text, /סימנתי שביצעת: לעשות קניות/u);
  assert.equal(h.saved().lists.owner.משימות.at(-1).checked, true);
});
test("last shopping-item button suppresses the empty list gallery; adding a product reopens it", async () => {
  const store = fixture();
  store.recordViews.owner = { key: itemKey("owner", "קניות", store.lists.owner.קניות[0], store),
    scope: "s", mode: "c", offset: 0, awaitingDelete: false };
  const result = await handleRecordViewAction(store, "owner", "בוצע", { persist: async () => {}, now: () => time });
  assert.equal(result.menu, undefined);
  assert.equal(store.listStatuses.owner.קניות.status, "completed");
  await mutateList(store, "owner", "קניות", () => store.lists.owner.קניות.push({
    id: "eggs", text: "ביצים", checked: false,
  }));
  assert.equal(store.listStatuses.owner.קניות.status, "open");
});
test("recap advances done/defer/cancel, rejects replays and foreign actors, then offers tomorrow and first wakeup", async () => {
  const store = fixture(); const h = harness(store);
  const initial = await handleDailyRecapMessage(store, "owner", "סיכום יום והכנה למחר", h.options);
  assert.doesNotMatch(initial[0].text, /מחר|חלב/u);
  const first = initial[0].options.reply_markup.inline_keyboard[0];
  assert.equal(first.length, 3);
  await h.callback(first[0].callback_data, "other");
  assert.equal(h.saved().lists.owner.משימות[0].checked, false);
  await h.callback(first[0].callback_data);
  const writes = h.writes();
  assert.equal((await h.callback(first[0].callback_data)).stale, true);
  assert.equal(h.writes(), writes);
  await h.callback(h.messages.at(-1).options.reply_markup.inline_keyboard[0][1].callback_data);
  assert.equal(h.saved().lists.owner.משימות[1].scheduledDate, "2026-10-13");
  await h.callback(h.messages.at(-1).options.reply_markup.inline_keyboard[0][2].callback_data);
  assert.equal(h.saved().lists.owner.משימות.length, 2);
  const finale = h.messages.at(-1);
  assert.match(finale.text, /מחר .*13.10/u);
  assert.match(finale.text, /06:10 השכמה/u);
  assert.match(finale.text, /ללא שעה — לאסוף ועד/u);
  assert.doesNotMatch(finale.text, /חלב|עורך הדין/u);
  const finish = finale.options.reply_markup.inline_keyboard[0][0].callback_data;
  await h.callback(finish);
  assert.match(h.messages.at(-1).text, /אלוף! ממשיכים בקצב שלך\nהראשונה למחר: 06:10 השכמה/u);
  assert.equal((await h.callback(finish)).stale, true);
  assert.equal(h.saved().reminders[0].dueAt, tomorrow);
});
test("topic switch invalidates recap; bare completion advances current recap instead of stale detail view", async () => {
  const store = fixture(); const h = harness(store);
  store.recordViews.owner = { key: itemKey("owner", "משימות", store.lists.owner.משימות[2], store), scope: "s", mode: "c", offset: 0, awaitingDelete: false };
  await handleDailyRecapMessage(store, "owner", "סיכום יום", h.options);
  await handleDailyRecapMessage(store, "owner", "בוצע", h.options);
  assert.equal(store.lists.owner.משימות[0].checked, true);
  assert.equal(store.lists.owner.משימות[2].checked, false);
  const old = store.dailyRecaps.owner.nonce;
  await handleDailyRecapMessage(store, "owner", "רשימת קניות", h.options);
  assert.equal((await h.callback(`rc:${old}:d`)).stale, true);
});
test("real SQL recap persists completion, deferred date, cancellation and durable callback session", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE ah_sheli_state (key text PRIMARY KEY, value jsonb) ON COMMIT DROP");
    const store = fixture();
    store.lists.owner.משימות.push({ id: "future", text: "משימה עתידית", checked: false, dueAt: tomorrow });
    store.lists.owner.משימות.push({ id: "linked-future", text: "פגישה מחר", checked: false });
    store.reminders.push({ id: "meeting", chatId: "owner", text: "פגישה מחר",
      dueAt: tomorrow + 3600000, trackingTaskId: "linked-future" });
    await client.query("INSERT INTO ah_sheli_state VALUES ('owner',$1)", [JSON.stringify(store)]);
    const options = { now: () => time, readSnapshot: (actor, _, now) => loadDailySummaryStore(actor, client, now),
      persist: async candidate => { await client.query("UPDATE ah_sheli_state SET value=$1 WHERE key='owner'", [JSON.stringify(candidate)]); } };
    const start = await handleDailyRecapMessage(store, "owner", "סיכום יום", options);
    const telegram = { call: async () => {}, sendMessage: async () => {} };
    await handleDailyRecapCallback(store, telegram, { id: "q", data: start[0].options.reply_markup.inline_keyboard[0][0].callback_data,
      from: { id: "owner" }, message: { chat: { id: "owner", type: "private" } } }, { ...options, ownerChatId: "owner" });
    const snapshot = await loadDailySummaryStore("owner", client, time);
    assert.deepEqual(snapshot.completedTasks.map(item => item.text), ["לראות את הקאנטרי"]);
    assert.deepEqual(snapshot.openTasks.map(row => row.item.id), ["b", "c"]);
    const { rows } = await client.query("SELECT value->'dailyRecaps'->'owner' AS session FROM ah_sheli_state");
    assert.equal(rows[0].session.itemId, "b");
    assert.equal(rows[0].session.phase, "review");
    const act = async action => handleDailyRecapCallback(store, telegram, { id: "q",
      data: `rc:${store.dailyRecaps.owner.nonce}:${action}`, from: { id: "owner" },
      message: { chat: { id: "owner", type: "private" } } }, { ...options, ownerChatId: "owner" });
    await act("p");
    await act("x");
    const final = await loadDailySummaryStore("owner", client, time);
    assert.equal(final.openTasks.length, 0);
    assert.equal(final.deferredTomorrowTasks[0].text, "לאסוף ועד");
    const state = (await client.query("SELECT value FROM ah_sheli_state")).rows[0].value;
    assert.equal(state.lists.owner.משימות.find(item => item.id === "b").scheduledDate, "2026-10-13");
    assert.equal(state.lists.owner.משימות.some(item => item.id === "c"), false);
    assert.equal(state.reminders[0].dueAt, tomorrow);
    await handleDailyRecapMessage(store, "owner", "קניות בוצע", options);
    const shopping = (await client.query("SELECT value->'lists'->'owner'->'קניות' AS items, value->'listStatuses'->'owner'->'קניות' AS status FROM ah_sheli_state")).rows[0];
    assert.equal(shopping.items[0].checked, true);
    assert.equal(shopping.status.status, "completed");
  } finally { await client.query("ROLLBACK"); client.release(); }
});
