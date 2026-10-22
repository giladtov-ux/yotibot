import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserAccess, UserAccessError, botCommandUpdates, landingPageUrl } from "../src/user-access.js";
import { telegramUserId, effectiveSubscription, createTelegramUserRepository } from "../src/telegram-users.js";
import { promptForContext, systemPrompt } from "../src/assistant-intent.js";

const directory = await mkdtemp(join(tmpdir(), "ah-sheli-users-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { handleAssistantMessage, buildAssistantContext } = await import("../src/assistant.js");
const { analyzeMessage } = await import("../src/groq-assistant.js");
const { createReminderWorker } = await import("../src/reminder-worker.js");
const { handleAuthorizedUpdate } = await import("../src/user-update-handler.js");
after(() => rm(directory, { recursive: true, force: true }));

function fixture() {
  let clock = Date.now();
  const rows = new Map();
  const notifications = new Map();
  const repository = {
    async claimNotification(key) {
      if (notifications.has(key)) return false;
      notifications.set(key, "unknown"); return true;
    },
    async finishNotification(key, status) { notifications.set(key, status); },
    async register(actor, owner) {
      const isNew = !rows.has(actor.id);
      const user = { status: "pending", expiresAt: null, messagesOptedOut: false,
        ...rows.get(actor.id), ...actor };
      if (owner) Object.assign(user, { status: "active", expiresAt: null });
      rows.set(user.id, user);
      return { ...user, isNew };
    },
    async get(id) { return rows.has(id) ? { ...rows.get(id) } : undefined; },
    messagingPreferencesReady() { return true; },
    async isMessagingOptedOut(id) { return rows.get(id)?.messagesOptedOut === true; },
    async setMessagingOptedOut(id, value) {
      const user = rows.get(id);
      if (!user) return false;
      user.messagesOptedOut = value;
      return true;
    },
    async grant(id, days) {
      const user = rows.get(id);
      if (!user) return;
      user.expiresAt = new Date(Math.max(clock, user.status === "active"
        ? new Date(user.expiresAt).getTime() : clock) + days * 86_400_000).toISOString();
      user.status = "active";
      return { ...user };
    },
    async revoke(id) { const user = rows.get(id); if (user) user.status = "revoked"; return user; },
    async list() { return { users: [...rows.values()], hasNext: false }; },
  };
  const access = createUserAccess({ repository, ownerId: "1", now: () => clock });
  const sent = [], calls = [];
  const telegram = {
    async sendMessage(...args) { sent.push(args); return { message_id: sent.length }; },
    async call(...args) { calls.push(args); },
  };
  const store = createEmptyStore();
  store.lists["1"] = { קניות: [{ id: "original", text: "סוד של המנהל", checked: false }] };
  store.lists["2"] = { קניות: [{ id: "member", text: "לחם", checked: false }] };
  Object.defineProperty(store, "assistantIdentity", { value: id => access.context(id) });
  function update(id = 2, text = "/register") {
    return { update_id: 7, message: { message_id: 10, date: Math.floor(clock / 1000),
      from: { id, first_name: `משתמש ${id}` }, chat: { id, type: "private" },
      ...(text === null ? { voice: { file_id: "voice", duration: 2 } } : { text }) } };
  }
  return { rows, repository, notifications, access, telegram, sent, calls, store, update,
    expire: () => { clock += 86_400_001; },
    dispatch: (update, options = {}) => handleAuthorizedUpdate(store, telegram, update, {
      userAccess: access, ...options,
    }) };
}

test("public menu has no manual registration or admin commands; admin menu is owner-scoped", () => {
  const [publicMenu, ownerMenu] = botCommandUpdates("1");
  assert.deepEqual(publicMenu.scope, { type: "default" });
  assert.deepEqual(publicMenu.commands.map(command => command.command),
    ["start", "stop", "help", "status"]);
  assert.deepEqual(ownerMenu.scope, { type: "chat", chat_id: "1" });
  for (const command of ["users", "grant", "revoke"]) {
    assert.ok(ownerMenu.commands.some(item => item.command === command));
  }
  assert.equal(botCommandUpdates(null).length, 1);
  assert.ok(botCommandUpdates("1").every(menu => menu.commands.every(command => command.command !== "register")));
});

test("STOP mutes all bot messages without changing access or data; /start resumes messages", async () => {
  const f = fixture();
  await f.dispatch(f.update(2, "/register"));
  const granted = await f.repository.grant("2", 30);
  const originalExpiry = granted.expiresAt;
  const originalData = JSON.stringify(f.store);

  await f.dispatch(f.update(2, "STOP"));
  const user = f.rows.get("2");
  assert.equal(user.messagesOptedOut, true);
  assert.equal(user.status, "active");
  assert.equal(user.expiresAt, originalExpiry);
  assert.equal(JSON.stringify(f.store), originalData);
  assert.match(f.sent.at(-1)[1], /הודעות הבוט הושתקו/u);
  assert.equal(await f.access.authorizedId(f.update(2, "שלום")), null);
  assert.equal(await f.access.authorizedId(f.update(2, "/start")), "2");

  const afterStopConfirmation = f.sent.length;
  await f.dispatch(f.update(2, "תזכיר לי לקנות לחם"));
  await f.dispatch(f.update(2, "/status"));
  assert.equal(f.sent.length, afterStopConfirmation);
  assert.equal(await f.access.canUse("2"), true);

  await f.dispatch(f.update(2, "/start"));
  const resumedUser = f.rows.get("2");
  assert.equal(resumedUser.messagesOptedOut, false);
  assert.equal(resumedUser.status, "active");
  assert.equal(resumedUser.expiresAt, originalExpiry);
  assert.match(f.sent.at(-1)[1], /הופעלו מחדש/u);
});

test("STOP never claims success when the Staging preference schema is missing", async () => {
  const f = fixture();
  f.repository.messagingPreferencesReady = () => false;
  await f.dispatch(f.update(2, "/stop"));
  assert.equal(f.rows.has("2"), false);
  assert.match(f.sent.at(-1)[1], /לא הצלחתי לשמור את בקשת ההשתקה/u);
});

test("registration alerts are private, once-only across repeated messages and a fresh access instance", async () => {
  const f = fixture(), before = JSON.stringify(f.store);
  await Promise.all([f.dispatch(f.update()), f.dispatch(f.update())]);
  await f.dispatch(f.update(2, "שוב"));
  const restarted = createUserAccess({ repository: f.repository, ownerId: "1" });
  await restarted.handle(f.update(), f.telegram);
  await restarted.notifyNewRegistration("2", f.telegram);
  await f.dispatch(f.update(1, "/status"));
  const alerts = f.sent.filter(([id, text]) => id === "1" && text.includes("משתמש חדש"));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0][1], /מזהה טלגרם: 2/);
  assert.doesNotMatch(alerts[0][1], /סוד של המנהל|לחם/);
  assert.equal(JSON.stringify(f.store), before);
  assert.equal(f.notifications.get("registration:2"), "sent");
});

for (const status of ["sent", "failed", "unknown"]) {
  test(`grant and renewal remain saved with ${status} notification delivery, without replay`, async () => {
    const f = fixture(), before = JSON.stringify(f.store);
    await f.dispatch(f.update());
    const send = f.telegram.sendMessage;
    let attempts = 0;
    f.telegram.sendMessage = async (id, ...args) => {
      if (id === "2") {
        attempts++;
        if (status !== "sent") throw Object.assign(new Error("synthetic"), {
          deliveryRejected: status === "failed",
        });
      }
      return send(id, ...args);
    };
    await f.dispatch(f.update(1, "/grant 2 1"));
    assert.equal(await f.access.canUse("2"), true);
    const expiry = f.rows.get("2").expiresAt;
    assert.equal(f.notifications.get(`grant:2:${expiry}`), status);
    assert.match(f.sent.at(-1)[1], /סגור, הגישה אושרה/);
    assert.doesNotMatch(f.sent.at(-1)[1], /לא הצלחתי לאשר/);
    const { sendAccessNotification } = await import("../src/access-notifications.js");
    await sendAccessNotification({ repository: f.repository, telegram: f.telegram,
      eventKey: `grant:2:${expiry}`, userId: "2", recipientId: "2",
      text: "duplicate", assertActive() {} });
    assert.equal(attempts, 1);
    await f.dispatch(f.update(1, "/grant 2 1"));
    assert.equal(attempts, 2);
    assert.equal(new Date(f.rows.get("2").expiresAt) - new Date(expiry), 86_400_000);
    assert.equal(JSON.stringify(f.store), before);
  });
}

test("registration delivery rejection or timeout never replays and never blocks the user's response", async () => {
  for (const deliveryRejected of [true, false]) {
    const f = fixture(), send = f.telegram.sendMessage;
    let attempts = 0;
    f.telegram.sendMessage = async (id, text, ...args) => {
      if (id === "1" && text.includes("משתמש חדש")) {
        attempts++; throw Object.assign(new Error("synthetic"), { deliveryRejected });
      }
      return send(id, text, ...args);
    };
    await f.dispatch(f.update());
    await f.dispatch(f.update());
    await createUserAccess({ repository: f.repository, ownerId: "1" }).notifyNewRegistration("2", f.telegram);
    assert.equal(attempts, 1);
    assert.equal(f.notifications.get("registration:2"), deliveryRejected ? "failed" : "unknown");
    assert.match(f.sent.at(-1)[1], /כדי להתחיל/);
  }
});

test("notification claim/receipt failure preserves approval and an uncertain receipt blocks restart replay", async () => {
  for (const phase of ["claim", "receipt"]) {
    const f = fixture();
    await f.dispatch(f.update());
    const original = phase === "claim" ? f.repository.claimNotification : f.repository.finishNotification;
    const method = phase === "claim" ? "claimNotification" : "finishNotification";
    f.repository[method] = async () => { throw new Error("synthetic database disconnect"); };
    await f.dispatch(f.update(1, "/grant 2 1"));
    assert.equal(await f.access.canUse("2"), true);
    assert.match(f.sent.at(-1)[1], /הגישה נשמרה.*אינה מאומתת/);
    if (phase === "receipt") {
      const key = `grant:2:${f.rows.get("2").expiresAt}`;
      assert.equal(f.notifications.get(key), "unknown");
      f.repository[method] = original;
      assert.equal(await f.repository.claimNotification(key), false);
    }
  }
});

test("new private users and legacy register commands receive the website link without access", async () => {
  const f = fixture(), original = JSON.stringify(f.store);
  for (const text of ["היי", "/start", "/register"]) {
    await f.dispatch(f.update(2, text));
    const [, message, options] = f.sent.at(-1);
    assert.match(message, /אחרי תשלום מאומת.*30 יום/u);
    const buttons = options.reply_markup.inline_keyboard.flat();
    assert.equal(buttons[0].url, landingPageUrl());
    assert.equal(new URL(buttons[0].url).protocol, "https:");
    assert.ok(buttons.every(button => button.callback_data !== "u:register"));
    assert.equal(await f.access.canUse("2"), false);
    assert.equal(f.rows.get("2").status, "pending");
    assert.equal(JSON.stringify(f.store), original);
  }
});

test("IDs are canonical and expiry is exclusive; absent/invalid expiry never grants access", () => {
  for (const id of [null, "01", "-2", "1; DROP TABLE", "9007199254740992"]) {
    assert.throws(() => telegramUserId(id));
  }
  assert.equal(telegramUserId(123), "123");
  const user = { id: "2", status: "active", expiresAt: new Date(1000).toISOString() };
  assert.equal(effectiveSubscription(user, "1", 999), "active");
  assert.equal(effectiveSubscription(user, "1", 1000), "expired");
  assert.equal(effectiveSubscription({ ...user, expiresAt: null }, "1"), "expired");
  assert.equal(effectiveSubscription(undefined, undefined), "pending");
  assert.equal(effectiveSubscription({ id: "1", status: "revoked" }, "1"), "owner");
});

test("registration is pending, repeated registration cannot renew or reactivate, and owner stays enabled", async () => {
  const f = fixture();
  await f.dispatch(f.update());
  assert.equal(f.rows.get("2").status, "pending");
  assert.equal(await f.access.canUse("2"), false);
  await f.dispatch(f.update(1, "/grant 2 1"));
  const expiry = f.rows.get("2").expiresAt;
  assert.equal(await f.access.canUse("2"), true);
  await f.dispatch(f.update());
  assert.equal(f.rows.get("2").expiresAt, expiry);
  f.expire();
  await f.dispatch(f.update());
  assert.equal(await f.access.canUse("2"), false);
  assert.match(f.sent.at(-1)[1], /תוקף המנוי הסתיים/u);
  assert.equal(await f.access.canUse("1"), true);
});

test("only the owner can administer, invalid grants fail closed and self-revocation is forbidden", async () => {
  const f = fixture();
  await f.dispatch(f.update());
  await f.dispatch(f.update(2, "/grant 2 3650"));
  assert.equal(f.rows.get("2").status, "pending");
  for (const command of ["/grant 2 0", "/grant 2 -1", "/grant 2 1.5", "/grant 2 3651", "/revoke 1"]) {
    await f.dispatch(f.update(1, command));
  }
  assert.equal(f.rows.get("2").status, "pending");
  assert.equal(await f.access.canUse("1"), true);
  await f.dispatch(f.update(1, "/user 2"));
  assert.match(f.sent.at(-1)[1], /ממתין להפעלת גישה/u);
  await f.dispatch(f.update(1, "/users"));
  assert.match(f.sent.at(-1)[1], /משתמש 2/u);
});

test("pending/expired/revoked users cannot invoke AI, speech, history, or mutate existing data", async () => {
  const f = fixture(), before = JSON.stringify(f.store);
  const options = { transcribeVoice: async () => assert.fail("no speech request"),
    replyOptions: { readHistory: async () => assert.fail("no history request"),
      assistant: async () => assert.fail("no AI or actions") } };
  for (const state of ["pending", "expired", "revoked"]) {
    if (state === "expired") {
      await f.repository.grant("2", 1); f.expire();
    }
    if (state === "revoked") await f.repository.revoke("2");
    await f.dispatch(f.update(2, "תמחק את רשימת הקניות"), options);
    await f.dispatch(f.update(2, null), options);
    assert.equal(JSON.stringify(f.store), before);
  }
});

test("groups and mismatched sender/chat identities cannot register or use an account", async () => {
  const f = fixture();
  const incoming = f.update();
  incoming.message.chat.type = "group";
  await f.dispatch(incoming);
  incoming.message.chat.type = "private";
  incoming.message.from.id = 1;
  await f.dispatch(incoming);
  assert.equal(f.rows.size, 0);
  assert.equal(f.sent.length, 0);
});

test("authorized text and voice share the original pipeline and remain isolated from owner records", async () => {
  const f = fixture(), ownerData = JSON.stringify(f.store.lists["1"]), turns = [];
  await f.dispatch(f.update());
  await f.dispatch(f.update(1, "/grant 2 1"));
  const text = "תוסיף חלב לרשימת קניות";
  const options = {
    transcribeVoice: async () => text,
    replyOptions: { readHistory: async id => { assert.equal(id, "2"); return []; },
      saveConversation: async (...args) => turns.push(args),
      assistant: (state, id, message, _unused, history, auth) => handleAssistantMessage(state, id, message,
        async () => ({ type: "add-items", listName: "קניות", items: ["חלב"] }), history, auth) },
  };
  await f.dispatch(f.update(2, text), options);
  await f.dispatch(f.update(2, null), options);
  assert.equal(turns.length, 2);
  assert.ok(turns.every(([id, message]) => id === "2" && message === text));
  assert.ok(f.store.lists["2"].קניות.some(item => item.text === "חלב"));
  assert.equal(JSON.stringify(f.store.lists["1"]), ownerData);
  const preserved = JSON.stringify(f.store);
  await f.dispatch(f.update(1, "/revoke 2"));
  assert.equal(JSON.stringify(f.store), preserved);
  await f.dispatch(f.update(1, "/grant 2 1"));
  assert.equal(JSON.stringify(f.store), preserved);
});

test("expiry during transcription blocks the resulting text before actions or history", async () => {
  const f = fixture();
  await f.dispatch(f.update()); await f.repository.grant("2", 1);
  const before = JSON.stringify(f.store);
  await f.dispatch(f.update(2, null), {
    transcribeVoice: async () => { f.expire(); return "תמחק רשימה"; },
    replyOptions: { readHistory: async () => assert.fail("no post-expiry history"),
      assistant: async () => assert.fail("no post-expiry action") },
  });
  assert.equal(JSON.stringify(f.store), before);
  assert.match(f.sent.at(-1)[1], /תוקף המנוי הסתיים/u);
});

test("expiry during AI prevents applying the returned action", async () => {
  const f = fixture();
  await f.dispatch(f.update()); await f.repository.grant("2", 1);
  const before = JSON.stringify(f.store);
  await assert.rejects(handleAssistantMessage(f.store, "2", "בקשה מורכבת לניהול הנתונים", async () => {
    f.expire();
    return { type: "add-items", listName: "קניות", items: ["אסור"] };
  }, [], { assertPermission: () => f.access.assertPermission("2") }), UserAccessError);
  assert.equal(JSON.stringify(f.store), before);
});

test("provider requests and summary contexts never disclose the owner's profile or data to members", async () => {
  const f = fixture(); await f.dispatch(f.update());
  const context = buildAssistantContext(f.store, "2");
  assert.equal(context.isOwner, false);
  assert.equal(context.dailyScheduleContextOnly, undefined);
  assert.equal(context.user.preferredName, "משתמש 2");
  assert.doesNotMatch(JSON.stringify(context), /סוד של המנהל|בן 56/u);
  let body;
  await analyzeMessage("שלום", context, { complete: async request => {
    body = request;
    return { choices: [{ message: { content: "אהלן" }, finish_reason: "stop" }] };
  } });
  assert.doesNotMatch(body.messages[0].content, /יוטי|בן 56|06:35 יציאה/u);
  assert.equal(promptForContext({ isOwner: true }), systemPrompt);
  assert.doesNotMatch(promptForContext(), /יוטי|בן 56/u);
  assert.match(body.messages.at(-1).content, /משתמש 2/u);
});

test("member reminders and nudges use subscription checks while owner reminders remain unchanged", async t => {
  const f = fixture(), base = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: base });
  await f.dispatch(f.update()); await f.repository.grant("2", 1);
  f.store.reminders = [
    { id: "owner", chatId: "1", text: "של המנהל", dueAt: base },
    { id: "member", chatId: "2", text: "של החבר", dueAt: base },
    { id: "pending", chatId: "3", text: "בלי גישה", dueAt: base },
  ];
  f.sent.length = 0;
  const worker = createReminderWorker(f.store, f.telegram, "1", () => {}, async () => {}, () => {},
    { isAuthorized: id => f.access.canUse(id) });
  await worker();
  assert.deepEqual(f.sent.map(([id]) => id), ["1", "2"]);
  assert.equal(f.store.reminders[2].sentAt, undefined);
  t.mock.timers.setTime(base + 300_000);
  await worker();
  assert.deepEqual(f.sent.map(([id]) => id), ["1", "2", "1", "2"]);
  await f.repository.revoke("2");
  t.mock.timers.setTime(base + 600_000);
  await worker();
  assert.deepEqual(f.sent.map(([id]) => id), ["1", "2", "1", "2", "1"]);
});

test("STOP suppresses scheduled owner reminders and nudges", async () => {
  const f = fixture();
  const now = Date.now();
  await f.dispatch(f.update(1, "/start"));
  await f.repository.setMessagingOptedOut("1", true);
  f.sent.length = 0;
  f.store.reminders = [
    { id: "owner-due", chatId: "1", text: "תזכורת חדשה", dueAt: now - 1 },
    { id: "owner-nudge", chatId: "1", text: "תזכורת שנשלחה",
      dueAt: now - 5 * 60_000, sentAt: now - 5 * 60_000,
      telegramDeliveries: { "1": { state: "sent", messageId: 7, sentAt: now - 5 * 60_000 } } },
  ];
  const worker = createReminderWorker(f.store, f.telegram, "1", () => {},
    async () => {}, () => {}, {
      isAuthorized: id => f.access.canUse(id),
      isMessagingEnabled: async id => !(await f.repository.isMessagingOptedOut(id)),
    });
  await worker();
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.reminders[0].sentAt, undefined);
  assert.equal(f.store.reminders[1].telegramDeliveries["1"].nagAttemptAt, undefined);
});

test("revocation while persisting an attempt prevents the Telegram send without losing the reminder", async () => {
  const f = fixture(); await f.dispatch(f.update()); await f.repository.grant("2", 1);
  f.store.reminders = [{ id: "member", chatId: "2", text: "שמורה", dueAt: Date.now() - 1 }];
  const before = JSON.stringify(f.store), prior = f.sent.length;
  const worker = createReminderWorker(f.store, f.telegram, "1", () => {},
    async () => { await f.repository.revoke("2"); }, () => {},
    { isAuthorized: id => f.access.canUse(id) });
  await worker();
  assert.equal(f.sent.length, prior);
  assert.equal(JSON.stringify(f.store), before);
});

async function reminderCallbackFixture() {
  const f = fixture();
  await f.dispatch(f.update()); await f.repository.grant("2", 1);
  f.store.reminders = [{ id: "member", chatId: "2", text: "המשימה שלי", dueAt: Date.now() - 1 }];
  await createReminderWorker(f.store, f.telegram, "1", () => {}, async () => {}, () => {},
    { isAuthorized: id => f.access.canUse(id) })();
  const [id, text, options] = f.sent.at(-1);
  const callback = { update_id: 21, callback_query: { id: "click",
    from: { id: 2, first_name: "משתמש 2" },
    data: options.reply_markup.inline_keyboard[0][0].callback_data,
    message: { message_id: f.sent.length, text, from: { is_bot: true },
      chat: { id: Number(id), type: "private" } },
  } };
  return { ...f, callback };
}

test("active members can complete their own reminders, but another approved account cannot forge that action", async () => {
  const f = await reminderCallbackFixture();
  await f.dispatch(f.update(3)); await f.repository.grant("3", 1);
  const forged = structuredClone(f.callback);
  forged.callback_query.from.id = 3;
  forged.callback_query.message.chat.id = 3;
  const before = JSON.stringify(f.store);
  await f.dispatch(forged);
  assert.equal(JSON.stringify(f.store), before);
  await f.dispatch(f.callback);
  assert.ok(Object.values(f.store.reminders[0].telegramDeliveries).every(row => row.state === "done"));
});

test("access expiring while a callback waits for the reminder queue blocks completion and preserves its receipt", async () => {
  const f = await reminderCallbackFixture(), before = JSON.stringify(f.store);
  await f.dispatch(f.callback, { reminderOperation: async work => { f.expire(); return work(); } });
  assert.equal(JSON.stringify(f.store), before);
  assert.match(f.sent.at(-1)[1], /תוקף המנוי הסתיים/u);
});

test("repository queries are parameterized, preserve membership on re-registration and never do startup DDL", async () => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params }); return { rows: [{ table_name: "ah_sheli_telegram_users",
      notifications_table: "ah_sheli_access_notifications", messages_opted_out_column: true }] };
  } };
  const repository = createTelegramUserRepository(pool);
  await repository.initialize();
  await repository.register({ id: "2", name: "'; DROP TABLE data; --" });
  await repository.grant("2", 30);
  await repository.revoke("2");
  await repository.list(2);
  await repository.isMessagingOptedOut("2");
  await repository.setMessagingOptedOut("2", true);
  assert.doesNotMatch(queries[0].sql, /CREATE|ALTER|DROP/u);
  assert.ok(!queries[1].sql.includes("DROP TABLE data"));
  assert.equal(queries[1].params[1], "'; DROP TABLE data; --");
  assert.match(queries[1].sql, /ELSE ah_sheli_telegram_users.subscription_status/u);
  assert.match(queries[2].sql, /GREATEST\(NOW\(\)/u);
  assert.equal(queries.at(-2).params[0], "2");
  assert.deepEqual(queries.at(-1).params, ["2", true]);
  assert.deepEqual(queries[4].params, [20]);
});
