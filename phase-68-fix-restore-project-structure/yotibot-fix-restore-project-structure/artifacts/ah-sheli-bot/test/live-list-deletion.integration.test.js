import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Opt-in only. All SQL is redirected to a session-local temporary table:
// no real owner state, user lists, reminders or application tables are changed.
test("real PostgreSQL verifies completion, deletion, cleanup and reload using only an isolated temporary table", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1"
    || process.env.AH_SHELI_RUN_ISOLATED_DATABASE_TESTS !== "1",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-isolated-postgres-"));
  process.env.AH_SHELI_DATA_DIR = directory;
  const { getPool } = await import("../src/database.js");
  const { createEmptyStore, initializeStatePersistence, saveStore, loadStore } = await import("../src/store.js");
  const { handleText, handleAssistantIntent } = await import("../src/commands.js");
  const { handleAssistantMessage } = await import("../src/assistant.js");
  const { menuRecords, renderRecordMenu } = await import("../src/record-menu.js");
  const { handleRecordViewAction } = await import("../src/record-view-actions.js");
  const pool = getPool();
  const client = await pool.connect();
  const rewrite = sql => sql.replaceAll("ah_sheli_state", "ah_sheli_isolated_list_test");
  let failVerification = false;
  const query = (...args) => {
    if (failVerification && /^SELECT value/u.test(args[0])) {
      return Promise.reject(new Error("synthetic verification failure"));
    }
    return client.query(rewrite(args[0]), ...args.slice(1));
  };
  const isolated = {
    query,
    connect: async () => ({ query, release() {} }),
  };
  try {
    await client.query(`CREATE TEMP TABLE ah_sheli_isolated_list_test (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT NOW()
    )`);
    const store = createEmptyStore();
    store.lists["synthetic-owner"] = {
      synthetic: [{ id: "first", text: "first", checked: false }, { id: "second", text: "second", checked: true }],
    };
    store.lists["synthetic-other"] = { synthetic: [{ id: "private", text: "private", checked: false }] };
    await initializeStatePersistence(store, isolated);
    await saveStore(store);
    failVerification = true;
    await assert.rejects(handleAssistantIntent(store, "synthetic-owner", {
      type: "add-task", text: "לאסוף וועד",
    }, "תוסיף לאסוף וועד"), /synthetic verification failure/u);
    assert.equal((store.lists["synthetic-owner"].משימות ?? []).length, 0);
    failVerification = false;
    assert.equal((await loadStore(isolated)).lists["synthetic-owner"].משימות, undefined);
    let calls = 0;
    const added = await handleAssistantMessage(store, "synthetic-owner", "לאסוף וועד",
      async () => ++calls === 1 ? { type: "answer", response: "אני מוסיף עכשיו... רגע" }
        : { type: "add-task", text: "לאסוף וועד" });
    assert.match(added, /לאסוף וועד/u);
    assert.doesNotMatch(added, /רגע|אני מוסיף/u);
    let tasks = (await loadStore(isolated)).lists["synthetic-owner"].משימות;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].text, "לאסוף וועד");
    assert.equal(tasks[0].checked, false);
    await handleAssistantIntent(store, "synthetic-owner", {
      type: "mark-item", listName: "משימות", itemText: "לאסוף וועד",
    }, "סמן לאסוף וועד כבוצע");
    tasks = (await loadStore(isolated)).lists["synthetic-owner"].משימות;
    assert.equal(tasks[0].checked, true);
    assert.ok(!renderRecordMenu(await loadStore(isolated), "synthetic-owner", "s")
      .options.reply_markup.inline_keyboard.flat().some(button => button.text.includes("לאסוף וועד")));
    store.recordViews["synthetic-owner"] = {
      key: menuRecords(store, "synthetic-owner", "s").find(item => item.id === "first").key,
      scope: "s", mode: "c", offset: 0, awaitingDelete: false,
    };
    await saveStore(store);
    failVerification = true;
    await assert.rejects(handleRecordViewAction(store, "synthetic-owner", "בוצע"),
      /synthetic verification failure/u);
    assert.equal(store.lists["synthetic-owner"].synthetic[0].checked, false);
    failVerification = false;
    assert.equal((await loadStore(isolated)).lists["synthetic-owner"].synthetic[0].checked, false);
    assert.match((await handleRecordViewAction(store, "synthetic-owner", "בוצע")).text, /סומן כבוצע/u);
    assert.equal((await loadStore(isolated)).lists["synthetic-owner"].synthetic[0].checked, true);
    const openMenu = renderRecordMenu(await loadStore(isolated), "synthetic-owner", "s");
    assert.match(openMenu.text, /עוד אין כאן פריטים/u);
    assert.deepEqual(openMenu.options.reply_markup.inline_keyboard, []);
    assert.equal((await loadStore(isolated)).lists["synthetic-other"].synthetic[0].checked, false);
    const completedCommittee = structuredClone(store.lists["synthetic-owner"].משימות
      .find(item => /לאסוף ו?ועד/u.test(item.text) && item.checked));
    assert.ok(completedCommittee);
    await handleAssistantMessage(store, "synthetic-owner", "לאסוף וועד",
      async () => assert.fail("Clear task addition needs no AI"));
    const { replyToOwnerMessage } = await import("../src/message-handler.js");
    const sent = [];
    await replyToOwnerMessage(store, {
      sendMessage: async (_chat, text, options) => sent.push({ text, options }),
    }, "synthetic-owner", "תוריד לאסוף ועד", {
      readHistory: async () => [], saveConversation: async () => {},
      assistant: (state, owner, text) => handleAssistantMessage(state, owner, text,
        async () => assert.fail("The spelling variant must resolve directly")),
    });
    const fresh = await loadStore(isolated);
    assert.ok(!fresh.lists["synthetic-owner"].משימות.some(item => /לאסוף ו?ועד/u.test(item.text) && !item.checked));
    assert.deepEqual(fresh.lists["synthetic-owner"].משימות.find(item => item.id === completedCommittee.id), completedCommittee);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].options.reply_markup.inline_keyboard.length);
    assert.match(sent[0].text, /הסרתי: לאסוף וועד/u);
    assert.doesNotMatch(sent[0].text, /לא מצאתי|לא בוצע שינוי|□\s+\d/u);
    await handleText(store, "synthetic-owner", "/remove synthetic | 1");
    assert.deepEqual((await loadStore(isolated)).lists["synthetic-owner"].synthetic,
      [{ id: "second", text: "second", checked: true }]);
    await handleText(store, "synthetic-owner", "נקה את רשימת synthetic");
    const reloaded = await loadStore(isolated);
    assert.deepEqual(reloaded.lists["synthetic-owner"].synthetic, []);
    assert.equal(reloaded.lists["synthetic-other"].synthetic.length, 1);
    await handleText(store, "synthetic-owner", "מחק את רשימת synthetic");
    assert.equal((await loadStore(isolated)).lists["synthetic-owner"].synthetic, undefined);
    const actions = ["ללכת לספר", "לקנות חלב", "ללכת למשכנתא", "לדבר עם עורך הדין"];
    for (const text of actions) {
      const response = await handleAssistantMessage(store, "synthetic-owner", text,
        async () => assert.fail("Clear bare tasks are saved without AI"));
      assert.match(response, new RegExp(text, "u"));
      assert.ok((await loadStore(isolated)).lists["synthetic-owner"].משימות
        .some(item => item.text === text && !item.checked));
    }
    const completion = await handleAssistantMessage(store, "synthetic-owner", "סיימתי עם עורך הדין",
      async () => ({ type: "mark-item", itemText: "עורך הדין" }));
    assert.equal((await loadStore(isolated)).lists["synthetic-owner"].משימות
      .find(item => item.text === "לדבר עם עורך הדין").checked, true);
    assert.doesNotMatch(completion, /לדבר עם עורך הדין/u);
    const deletion = await handleAssistantMessage(store, "synthetic-owner", "הספר כבר לא נחוץ, תוריד אותו",
      async () => ({ type: "remove-item", itemText: "הספר" }));
    assert.ok(!(await loadStore(isolated)).lists["synthetic-owner"].משימות
      .some(item => item.text === "ללכת לספר"));
    assert.doesNotMatch(deletion, /ללכת לספר/u);
    failVerification = true;
    await assert.rejects(handleAssistantMessage(store, "synthetic-owner", "במקום חלב שיהיה לקנות לחם",
      async () => ({ type: "update-item", itemText: "חלב", text: "לקנות לחם" })),
    /synthetic verification failure/u);
    failVerification = false;
    assert.ok((await loadStore(isolated)).lists["synthetic-owner"].משימות
      .some(item => item.text === "לקנות חלב"));
    const update = await handleAssistantMessage(store, "synthetic-owner", "במקום חלב שיהיה לקנות לחם",
      async () => ({ type: "update-item", itemText: "חלב", text: "לקנות לחם" }));
    assert.match(update, /לקנות לחם/u);
    assert.ok((await loadStore(isolated)).lists["synthetic-owner"].משימות
      .some(item => item.text === "לקנות לחם" && !item.checked));
    assert.equal((await loadStore(isolated)).lists["synthetic-other"].synthetic[0].checked, false);
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.ah_sheli_isolated_list_test");
    client.release();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
