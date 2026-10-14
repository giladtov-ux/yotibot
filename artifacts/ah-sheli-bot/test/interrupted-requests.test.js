import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimUpdate, finishUpdate, readInterruptedRequests, markInterruptedRequestReviewed, unmarkInterruptedRequestReviewed } from "../src/conversation-repository.js";
import { handleInterruptedRequests, requestMetadata } from "../src/interrupted-requests.js";
import { TelegramClient } from "../src/telegram.js";

// Synthetic records and query/Telegram sinks only. Never start index.js.
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-interrupted-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, initializeStatePersistence, getPendingListAction } =
  await import("../src/store.js");
const { handleOwnerUpdate } = await import("../src/message-handler.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
after(() => rm(directory, { recursive: true, force: true }));
const owner = "synthetic-owner";
const message = text => ({ text, chat: { id: owner }, from: { is_bot: false } });
const row = (id, status = "processing", chat = owner) => ({
  update_id: id, status, chat_id: chat, request_text: `synthetic request ${id}`,
  created_at: new Date("2026-10-07T08:00:00Z"),
});

function fakeDatabase(initial = []) {
  const records = structuredClone(initial);
  const queries = [];
  return {
    records, queries, state: null,
    async connect() {
      let transaction;
      return {
        query: async (sql, args = []) => {
          queries.push({ sql, args });
          if (sql === "BEGIN") transaction = structuredClone(this.state);
          else if (sql.startsWith("INSERT INTO ah_sheli_state")) {
            transaction = JSON.parse(args[0]);
          } else if (sql.startsWith("SELECT value FROM ah_sheli_state")) {
            return { rows: transaction ? [{ value: structuredClone(transaction) }] : [] };
          } else if (sql === "COMMIT") this.state = transaction;
          else if (sql !== "ROLLBACK") assert.fail(`Unexpected transaction query: ${sql}`);
          return { rows: [] };
        },
        release() {},
      };
    },
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql === "SELECT value FROM ah_sheli_state WHERE key = 'owner'") {
        return { rows: this.state ? [{ value: structuredClone(this.state) }] : [] };
      }
      if (sql.startsWith("INSERT INTO ah_sheli_updates")) {
        assert.match(sql, /ON CONFLICT \(update_id\) DO NOTHING/);
        if (records.some(r => r.update_id === args[0])) return { rowCount: 0 };
        records.push({ ...row(args[0]), chat_id: args[1], request_text: args[2] });
        return { rowCount: 1 };
      }
      if (sql.startsWith("UPDATE ah_sheli_updates")) {
        if (sql.includes("SET reviewed_at")) {
          const unreview = sql.includes("SET reviewed_at = NULL");
          assert.match(sql, /SET reviewed_at = (?:NULL|COALESCE\(reviewed_at, NOW\(\)\))/);
          assert.match(sql, /SET reviewed_at = (?:NULL|COALESCE\(reviewed_at, NOW\(\)\))\s+WHERE/);
          assert.match(sql, /update_id = \$1/);
          assert.match(sql, /\(chat_id = \$2 OR chat_id IS NULL\)/);
          assert.match(sql, /status IN \('processing', 'failed'\)/);
          assert.match(sql, /update_id <> \$3/);
          assert.doesNotMatch(sql, /SET status|DELETE|INSERT/);
          const target = records.find(r => r.update_id === args[0]
            && (r.chat_id === args[1] || r.chat_id === null)
            && ["processing", "failed"].includes(r.status) && r.update_id !== args[2]);
          if (!target) return { rowCount: 0 };
          if (unreview) target.reviewed_at = null;
          else target.reviewed_at ??= new Date("2026-10-07T09:00:00Z");
          return { rowCount: 1 };
        }
        records.find(r => r.update_id === args[0]).status = args[1];
        return { rowCount: 1 };
      }
      assert.match(sql, /SELECT update_id, status, created_at, chat_id, request_text/);
      assert.match(sql, /status IN \('processing', 'failed'\)/);
      assert.match(sql, /\(chat_id = \$1 OR chat_id IS NULL\)/);
      assert.match(sql, /update_id <> \$2/);
      assert.match(sql, /update_id < \$3/);
      assert.match(sql, /ORDER BY update_id DESC LIMIT 11/);
      assert.match(sql, /\(\$4::boolean OR reviewed_at IS NULL\)/);
      const [chat, current, before, includeReviewed] = args;
      return { rows: records.filter(r =>
        ["processing", "failed"].includes(r.status)
        && (r.chat_id === chat || r.chat_id === null)
        && r.update_id !== current && (before === null || r.update_id < before)
        && (includeReviewed || r.reviewed_at == null))
        .sort((a, b) => b.update_id - a.update_id).slice(0, 11) };
    },
  };
}

function harness(db, currentUpdateId = 999) {
  const sent = [];
  return {
    sent,
    send: (input, options = {}) => handleInterruptedRequests(input, {
      sendMessage: async (chat, text) => sent.push({ chat, text }),
    }, {
      ownerChatId: owner, currentUpdateId,
      readRequests: (chat, pagination) => readInterruptedRequests(chat, pagination, db),
      markReviewed: (chat, id, options) => markInterruptedRequestReviewed(chat, id, options, db),
      unmarkReviewed: (chat, id, options) => unmarkInterruptedRequestReviewed(chat, id, options, db),
      ...options,
    }),
  };
}

test("claim preserves deduplication and records only bounded owner metadata without connection proofs", async () => {
  const db = fakeDatabase();
  const update = { message: message("synthetic ".repeat(100)) };
  assert.equal(await claimUpdate(1, requestMetadata(update, owner), db), true);
  assert.equal(db.records[0].request_text.length, 240);
  await finishUpdate(1, "failed", db);
  assert.equal(await claimUpdate(1, { chatId: owner, text: "replacement" }, db), false);
  assert.equal(db.records[0].status, "failed");
  assert.notEqual(db.records[0].request_text, "replacement");
  for (const text of ["/connect synthetic-proof", "/connect@ExampleBot synthetic-proof", "/id"]) {
    assert.equal(requestMetadata({ message: message(text) }, owner).text, undefined);
  }
  assert.equal(requestMetadata({ message: { ...message("foreign"), chat: { id: "foreign" } } }, owner).text, undefined);
  assert.equal(requestMetadata(update, null).text, undefined);
  assert.equal(requestMetadata({ message: { ...message("bot"), from: { is_bot: true } } }, owner).text, undefined);
  assert.deepEqual(requestMetadata({}, owner), {});
});

test("only owner can read: disconnected, foreign, and bot senders cannot query or receive report", async () => {
  const db = fakeDatabase([row(1)]);
  const h = harness(db);
  assert.equal(await h.send(message("/interrupted"), { ownerChatId: null }), false);
  assert.equal(await h.send({ ...message("/interrupted"), chat: { id: "foreign" } }), false);
  assert.equal(await h.send({ ...message("/interrupted"), from: { is_bot: true } }), false);
  assert.equal(await h.send(message("ordinary clarification")), false);
  assert.deepEqual(db.queries, []);
  assert.deepEqual(h.sent, []);
});

test("inspection lists uncertain processing/failed only, excludes current and foreign, never mutates or replays", async () => {
  const db = fakeDatabase([
    row(1), row(2, "failed"), row(3, "done"), row(4, "processing", "foreign"),
    { ...row(5, "processing", null), request_text: "must-not-display-unattributed-text" },
    row(6),
  ]);
  const before = structuredClone(db.records);
  const h = harness(db, 6);
  assert.equal(await h.send(message("בקשות שנקטעו")), true);
  const report = h.sent[0].text;
  assert.match(report, /בקשה 1 /);
  assert.match(report, /בקשה 2 /);
  assert.match(report, /בקשה 5 /);
  assert.doesNotMatch(report, /בקשה [346] /);
  assert.doesNotMatch(report, /must-not-display/);
  assert.match(report, /אי אפשר להסיק מהסטטוס לבדו/);
  assert.match(report, /ייתכן שהיא נשמרה/);
  assert.match(report, /לא הפעלתי מחדש אף בקשה/);
  assert.match(report, /אי אפשר לקבוע למי שייך/);
  assert.match(report, /synthetic request 1/);
  assert.deepEqual(db.records, before);
  assert.equal(db.queries.length, 1);
  assert.ok(db.queries[0].sql.trim().startsWith("SELECT"));
  assert.equal(h.sent[0].chat, owner);
});

test("keyset pagination reaches older requests without losing rows or exceeding report bounds", async () => {
  const db = fakeDatabase(Array.from({ length: 25 }, (_, i) =>
    ({ ...row(i + 1), request_text: "א".repeat(240) })));
  const h = harness(db);
  await h.send(message("/interrupted@ExampleBot"));
  assert.match(h.sent[0].text, /\/interrupted 16$/);
  await h.send(message("/interrupted 16"));
  assert.match(h.sent[1].text, /\/interrupted 6$/);
  await h.send(message("/interrupted 6"));
  assert.doesNotMatch(h.sent[2].text, /לעמוד הבא/);
  const ids = h.sent.flatMap(s => [...s.text.matchAll(/• בקשה (\d+)/gu)].map(m => Number(m[1])));
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, i) => 25 - i));
  const telegram = new TelegramClient("synthetic-unused");
  const chunks = [];
  telegram.call = async (_method, payload) => { chunks.push(payload.text); };
  await telegram.sendMessage(owner, h.sent[0].text);
  assert.ok(chunks.every(c => c.length <= 4000));
  assert.equal(chunks.join(""), h.sent[0].text);
});

test("empty reports and database failure make no unsupported success/failure claim", async () => {
  const db = fakeDatabase([row(1, "done")]);
  const h = harness(db);
  await h.send(message("/interrupted"));
  assert.match(h.sent[0].text, /זה לא אישור שכל פעולה נשמרה/);
  await h.send(message("/interrupted"), {
    readRequests: async () => { throw new Error("synthetic private DB error"); },
  });
  assert.match(h.sent[1].text, /זה לא אומר שהפעולות נכשלו/);
  assert.doesNotMatch(h.sent[1].text, /synthetic private/);
  assert.deepEqual(db.records, [row(1, "done")]);
});

test("invalid cursors cannot read or reach assistant; activity fencing prevents reads and delivery", async () => {
  const db = fakeDatabase([row(1)]);
  const h = harness(db);
  for (const text of ["/interrupted 0", "/interrupted 9007199254740992", "/interrupted retry", "/interrupted -1"]) {
    assert.equal(await h.send(message(text)), true);
  }
  assert.equal(db.queries.length, 0);
  await assert.rejects(h.send(message("/interrupted"), {
    assertActive: () => { throw new Error("synthetic stopped worker"); },
  }), /stopped worker/);
  assert.equal(h.sent.length, 4);
  assert.equal(db.queries.length, 0);
});

test("delivery failure does not alter request markers or initiate automatic resend", async () => {
  const db = fakeDatabase([row(1)]);
  let sends = 0;
  await assert.rejects(handleInterruptedRequests(message("/interrupted"), {
    sendMessage: async () => { sends++; throw new Error("synthetic uncertain delivery"); },
  }, {
    ownerChatId: owner,
    readRequests: (chat, options) => readInterruptedRequests(chat, options, db),
  }), /uncertain delivery/);
  assert.equal(sends, 1);
  assert.equal(db.records[0].status, "processing");
});

test("runtime uses the shared pipeline only after private-user authorization", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function handleUpdate");
  assert.ok(source.indexOf("await handleAuthorizedUpdate(store, telegram, update", start) > start);
  const handler = await readFile(new URL("../src/user-update-handler.js", import.meta.url), "utf8");
  assert.ok(handler.indexOf("await userAccess.handle(update, telegram)") < handler.indexOf("await handleOwnerUpdate"));
  assert.match(handler, /ownerChatId: actorId, assertActive, assertPermission/);
  assert.doesNotMatch(source.slice(start, source.indexOf("async function pollUpdates", start)),
    /replyToOwnerMessage|handleAssistantMessage/);
});

test("report commands bypass history, AI and pending continuation; a later answer still completes the original batch", async () => {
  const db = fakeDatabase([row(1, "failed")]);
  const store = createEmptyStore();
  store.lists[owner] = { "קניות": [], "עבודה": [] };
  await initializeStatePersistence(store, db);
  const sent = [];
  const telegram = new TelegramClient("synthetic-unused");
  telegram.call = async (method, payload) => {
    assert.equal(method, "sendMessage");
    sent.push(structuredClone(payload));
    return {};
  };
  const history = [];
  const calls = { readHistory: 0, saveConversation: 0, assistant: 0, ai: 0 };
  const send = (text, updateId) => handleOwnerUpdate(store, telegram, {
    update_id: updateId, message: message(text),
  }, {
    ownerChatId: owner,
    inspectionOptions: {
      readRequests: (chat, options) => readInterruptedRequests(chat, options, db),
      markReviewed: (chat, id, options) => markInterruptedRequestReviewed(chat, id, options, db),
      unmarkReviewed: (chat, id, options) => unmarkInterruptedRequestReviewed(chat, id, options, db),
    },
    replyOptions: {
      readHistory: async chat => {
        assert.equal(chat, owner);
        calls.readHistory++;
        return structuredClone(history);
      },
      saveConversation: async (chat, text, reply) => {
        assert.equal(chat, owner);
        calls.saveConversation++;
        history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      },
      assistant: async (state, chat, text, _analyzer, recent) => {
        calls.assistant++;
        return handleAssistantMessage(state, chat, text, async current => {
          calls.ai++;
          if (current.startsWith("וגם")) return { type: "clarify", response: "לאיזו רשימה להוסיף?" };
          assert.fail("These deterministic clarification messages must not call AI");
        }, recent);
      },
    },
  });

  await send("וגם ביצים, לחם וגבינה", 100);
  assert.match(sent.at(-1).text, /לאיזו רשימה/u);
  assert.deepEqual(getPendingListAction(store, owner).items, ["ביצים", "לחם", "גבינה"]);
  const before = JSON.parse(JSON.stringify(store));
  const durableBefore = structuredClone(db.state);
  const historyBefore = structuredClone(history);
  const callsBefore = { ...calls };
  const commands = [
    ["/interrupted", /• בקשה 1/u, undefined],
    ["/reviewed 1", /מסומנת כנבדקה/u, true],
    ["/unreviewed 1", /אינה מסומנת כנבדקה/u, false],
    ["/interrupted@ExampleBot all", /• בקשה 1/u, false],
    ["/reviewed", /שלח \/reviewed/u, false],
    ["/unreviewed 0", /שלח \/unreviewed/u, false],
  ];
  for (const [index, [command, expectedReply, reviewed]] of commands.entries()) {
    const sendsBefore = sent.length;
    const queriesBefore = db.queries.length;
    await send(command, 101 + index);
    assert.equal(sent.length, sendsBefore + 1, command);
    assert.equal(sent.at(-1).chat_id, owner);
    assert.match(sent.at(-1).text, expectedReply);
    assert.deepEqual(JSON.parse(JSON.stringify(store)), before,
      `${command} leaves pending action and saved records untouched`);
    assert.deepEqual(db.state, durableBefore, `${command} does not persist conversation state`);
    assert.deepEqual(history, historyBefore, `${command} never enters conversation history`);
    assert.deepEqual(calls, callsBefore, `${command} never reaches history, assistant or AI`);
    assert.ok(db.queries.slice(queriesBefore).every(({ sql }) => sql.includes("ah_sheli_updates")));
    assert.equal(db.records[0].status, "failed", "reporting never replays the interrupted request");
    if (reviewed !== undefined) assert.equal(Boolean(db.records[0].reviewed_at), reviewed);
  }

  const sendsBeforeAnswer = sent.length;
  await send("קניות", 200);
  assert.equal(sent.length, sendsBeforeAnswer + 1);
  assert.match(sent.at(-1).text, /🛒 קניות/u);
  assert.match(sent.at(-1).reply_markup.inline_keyboard[0][0].text, /ביצים/u);
  assert.deepEqual(store.lists[owner]["קניות"].map(item => item.text), ["ביצים", "לחם", "גבינה"]);
  assert.deepEqual(store.lists[owner]["עבודה"], []);
  assert.equal(getPendingListAction(store, owner), null);
  assert.deepEqual(db.state, JSON.parse(JSON.stringify(store)), "completion is persisted in the fake database");
  assert.equal(calls.readHistory, callsBefore.readHistory + 1);
  assert.equal(calls.saveConversation, callsBefore.saveConversation + 1);
  assert.equal(calls.assistant, callsBefore.assistant + 1);
  assert.equal(calls.ai, callsBefore.ai);
  assert.deepEqual(history.slice(0, -2), historyBefore);
  assert.deepEqual(history.slice(-2), [
    { role: "user", content: "קניות" },
    { role: "assistant", content: "✅ הוספתי: 🥚 ביצים, 🍞 לחם, 🥛 גבינה." },
  ]);
  assert.notEqual(history.at(-1).content, sent.at(-1).text,
    "native menu formatting must not replace the original conversation context");
  // A repeated destination is a read, not permission to replay the batch.
  await send("קניות", 201);
  assert.equal(store.lists[owner]["קניות"].length, 3);
  assert.equal(getPendingListAction(store, owner), null);
});

test("manual review changes only its marker, persists across readers, and never allows replay", async () => {
  const db = fakeDatabase([row(1), row(2, "failed"), row(3, "processing", null)]);
  const original = structuredClone(db.records);
  const h = harness(db);
  for (const id of [1, 2, 3]) {
    assert.equal(await h.send(message(`/reviewed@ExampleBot ${id}`)), true);
    assert.match(h.sent.at(-1).text, /לא הוכחה שהפעולה נשמרה/);
    assert.match(h.sent.at(-1).text, /לא הפעלתי אותה מחדש/);
    assert.equal(await claimUpdate(id, { chatId: owner, text: "replacement" }, db), false);
  }
  assert.deepEqual(db.records.map(({ reviewed_at, ...r }) => r), original);
  const savedReview = structuredClone(db.records);
  await h.send(message("/reviewed 1"));
  assert.deepEqual(db.records, savedReview, "repeat marking keeps the first timestamp");
  const restarted = harness(db);
  await restarted.send(message("/interrupted"));
  assert.doesNotMatch(restarted.sent[0].text, /• בקשה/);
  await restarted.send(message("בקשות שנקטעו כולל שנבדקו"));
  assert.match(restarted.sent[1].text, /בקשה 1 /);
  assert.match(restarted.sent[1].text, /בקשה 2 /);
  assert.match(restarted.sent[1].text, /בקשה 3 /);
  assert.match(restarted.sent[1].text, /סומנה כנבדקה ידנית/);
  assert.match(restarted.sent[1].text, /אי אפשר לקבוע למי שייך/);
});

test("review is owner-only and cannot mark foreign, current, completed or absent requests", async () => {
  const db = fakeDatabase([row(1), row(2, "failed", "foreign"), row(3, "done"), row(999)]);
  const original = structuredClone(db.records);
  const h = harness(db);
  for (const text of ["/reviewed 1", "/interrupted all", "בקשות שנקטעו כולל שנבדקו"]) {
    assert.equal(await h.send(message(text), { ownerChatId: null }), false);
    assert.equal(await h.send({ ...message(text), chat: { id: "foreign" } }), false);
    assert.equal(await h.send({ ...message(text), from: { is_bot: true } }), false);
  }
  assert.deepEqual(db.queries, []);
  assert.deepEqual(h.sent, []);
  for (const id of [2, 3, 999, 1000]) {
    await h.send(message(`/reviewed ${id}`));
    assert.match(h.sent.at(-1).text, /לא נמצאה בקשה/);
  }
  assert.deepEqual(db.records, original);
});

test("all-mode pagination keeps review inclusion and hides foreign/current records", async () => {
  const db = fakeDatabase([
    ...Array.from({ length: 25 }, (_, i) => ({
      ...row(i + 1), reviewed_at: new Date("2026-10-07T09:00:00Z"),
    })),
    row(26, "failed", "foreign"), row(999),
  ]);
  const h = harness(db);
  await h.send(message("/interrupted all"));
  assert.match(h.sent[0].text, /\/interrupted all 16$/);
  await h.send(message("/interrupted@ExampleBot all 16"));
  assert.match(h.sent[1].text, /\/interrupted all 6$/);
  await h.send(message("/interrupted all 6"));
  const ids = h.sent.flatMap(s => [...s.text.matchAll(/• בקשה (\d+)/gu)].map(m => Number(m[1])));
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, i) => 25 - i));
  assert.ok(db.queries.every(q => q.sql.startsWith("SELECT")));
});

test("malformed review/all commands and inactive worker cannot write", async () => {
  const db = fakeDatabase([row(1)]);
  const h = harness(db);
  for (const text of ["/reviewed", "/reviewed 0", "/reviewed -1", "/reviewed 9007199254740992",
    "/reviewed 1 extra", "/interrupted all 0", "/interrupted all retry"]) {
    assert.equal(await h.send(message(text)), true);
  }
  assert.deepEqual(db.queries, []);
  await assert.rejects(h.send(message("/reviewed 1"), {
    assertActive: () => { throw new Error("synthetic stopped worker"); },
  }), /stopped worker/);
  assert.deepEqual(db.queries, []);
  assert.equal(await markInterruptedRequestReviewed(owner, NaN, {}, db), false);
  assert.equal(await markInterruptedRequestReviewed(null, 1, {}, db), false);
  assert.deepEqual(db.queries, []);
});

test("uncertain review write and failed delivery never change action status or replay", async () => {
  const db = fakeDatabase([row(1)]);
  const h = harness(db);
  await h.send(message("/reviewed 1"), {
    markReviewed: async (...args) => {
      await markInterruptedRequestReviewed(...args, db);
      throw new Error("synthetic missing response");
    },
  });
  assert.match(h.sent[0].text, /לא הצלחתי לאשר/);
  assert.doesNotMatch(h.sent[0].text, /synthetic missing/);
  assert.equal(db.records[0].status, "processing");
  assert.equal(await claimUpdate(1, {}, db), false);
  let sends = 0;
  await assert.rejects(handleInterruptedRequests(message("/reviewed 1"), {
    sendMessage: async () => { sends++; throw new Error("synthetic uncertain delivery"); },
  }, {
    ownerChatId: owner,
    markReviewed: (chat, id, options) => markInterruptedRequestReviewed(chat, id, options, db),
  }), /uncertain delivery/);
  assert.equal(sends, 1);
  assert.equal(db.records[0].status, "processing");
  assert.equal(await claimUpdate(1, {}, db), false);
});

test("unreview restores the normal report, persists, is idempotent and preserves deduplication", async () => {
  const db = fakeDatabase([row(1), row(2, "failed"), row(3, "processing", null)]);
  const h = harness(db);
  for (const id of [1, 2, 3]) await h.send(message(`/reviewed ${id}`));
  const original = structuredClone(db.records).map(({ reviewed_at, ...r }) => r);
  await h.send(message("/interrupted"));
  assert.doesNotMatch(h.sent.at(-1).text, /• בקשה/);
  await h.send(message("/interrupted all"));
  assert.match(h.sent.at(-1).text, /\/unreviewed/);
  for (const id of [1, 2, 3]) {
    assert.equal(await h.send(message(`/unreviewed@ExampleBot ${id}`)), true);
    assert.match(h.sent.at(-1).text, /תופיע בדוח הרגיל/);
    assert.match(h.sent.at(-1).text, /לא הפעלתי אותה מחדש/);
    assert.equal(await claimUpdate(id, { chatId: owner, text: "replacement" }, db), false);
  }
  assert.deepEqual(db.records.map(({ reviewed_at, ...r }) => r), original);
  assert.ok(db.records.every(r => r.reviewed_at === null));
  const unmarked = structuredClone(db.records);
  await h.send(message("/unreviewed 1"));
  assert.deepEqual(db.records, unmarked);
  const restarted = harness(db);
  await restarted.send(message("/interrupted"));
  for (const id of [1, 2, 3]) assert.match(restarted.sent[0].text, new RegExp(`• בקשה ${id} \\|`));
  assert.doesNotMatch(restarted.sent[0].text, /סומנה כנבדקה ידנית/);
  assert.match(restarted.sent[0].text, /אי אפשר לקבוע למי שייך/);
  await restarted.send(message("/reviewed 2"));
  await restarted.send(message("/interrupted"));
  assert.doesNotMatch(restarted.sent.at(-1).text, /• בקשה 2 /);
});

test("unreview denies unauthorized senders and excludes foreign, current, completed and absent requests", async () => {
  const db = fakeDatabase([row(1), row(2, "failed", "foreign"), row(3, "done"), row(999)]
    .map(r => ({ ...r, reviewed_at: new Date("2026-10-07T09:00:00Z") })));
  const original = structuredClone(db.records);
  const h = harness(db);
  assert.equal(await h.send(message("/unreviewed 1"), { ownerChatId: null }), false);
  assert.equal(await h.send({ ...message("/unreviewed 1"), chat: { id: "foreign" } }), false);
  assert.equal(await h.send({ ...message("/unreviewed 1"), from: { is_bot: true } }), false);
  assert.deepEqual(db.queries, []);
  assert.deepEqual(h.sent, []);
  for (const id of [2, 3, 999, 1000]) {
    assert.equal(await h.send(message(`/unreviewed ${id}`)), true);
    assert.match(h.sent.at(-1).text, /לא נמצאה בקשה/);
  }
  assert.deepEqual(db.records, original);
});

test("malformed unreview and inactive worker cannot write; repository validates identifiers", async () => {
  const db = fakeDatabase([row(1)]);
  const h = harness(db);
  for (const text of ["/unreviewed", "/unreviewed 0", "/unreviewed -1",
    "/unreviewed 9007199254740992", "/unreviewed 1 extra", "/unreviewed retry", "/unreviewed 1.5"]) {
    assert.equal(await h.send(message(text)), true);
    assert.match(h.sent.at(-1).text, /שלח \/unreviewed/);
  }
  await assert.rejects(h.send(message("/unreviewed 1"), {
    assertActive: () => { throw new Error("synthetic stopped worker"); },
  }), /stopped worker/);
  for (const id of [NaN, 0, -1, 1.5, "1", 9007199254740992]) {
    assert.equal(await unmarkInterruptedRequestReviewed(owner, id, {}, db), false);
  }
  assert.equal(await unmarkInterruptedRequestReviewed(null, 1, {}, db), false);
  assert.deepEqual(db.queries, []);
});

test("uncertain unreview write or delivery never retries or releases the original request", async () => {
  const db = fakeDatabase([{ ...row(1), reviewed_at: new Date("2026-10-07T09:00:00Z") }]);
  const original = structuredClone(db.records).map(({ reviewed_at, ...r }) => r);
  const h = harness(db);
  await h.send(message("/unreviewed 1"), {
    unmarkReviewed: async (...args) => {
      await unmarkInterruptedRequestReviewed(...args, db);
      throw new Error("synthetic private missing response");
    },
  });
  assert.match(h.sent[0].text, /לא הצלחתי לאשר/);
  assert.doesNotMatch(h.sent[0].text, /synthetic private/);
  assert.equal(db.queries.length, 1, "uncertain writes are not automatically retried");
  assert.equal(await claimUpdate(1, {}, db), false);
  let sends = 0;
  await assert.rejects(handleInterruptedRequests(message("/unreviewed 1"), {
    sendMessage: async () => { sends++; throw new Error("synthetic uncertain delivery"); },
  }, {
    ownerChatId: owner,
    unmarkReviewed: (chat, id, options) => unmarkInterruptedRequestReviewed(chat, id, options, db),
  }), /uncertain delivery/);
  assert.equal(sends, 1);
  assert.deepEqual(db.records.map(({ reviewed_at, ...r }) => r), original);
  assert.equal(await claimUpdate(1, {}, db), false);
});

test("unreview database failure leaves marker intact and activity loss prevents delivery", async () => {
  const db = fakeDatabase([{ ...row(1), reviewed_at: new Date("2026-10-07T09:00:00Z") }]);
  const original = structuredClone(db.records);
  const h = harness(db);
  await h.send(message("/unreviewed 1"), {
    unmarkReviewed: async () => { throw new Error("synthetic private DB error"); },
  });
  assert.match(h.sent[0].text, /לא הצלחתי לאשר/);
  assert.doesNotMatch(h.sent[0].text, /synthetic private/);
  assert.deepEqual(db.records, original);
  for (const failWrite of [false, true]) {
    let active = true;
    await assert.rejects(h.send(message("/unreviewed 1"), {
      assertActive: () => { if (!active) throw new Error("synthetic stopped worker"); },
      unmarkReviewed: async () => {
        active = false;
        if (failWrite) throw new Error("synthetic write failure");
        return true;
      },
    }), /stopped worker/);
  }
  assert.equal(h.sent.length, 1);
  assert.deepEqual(db.queries, []);
});
