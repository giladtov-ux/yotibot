import test from "node:test";
import assert from "node:assert/strict";
import { handleWebsiteRegistration } from "../src/website-registration.js";
const token = "a".repeat(32);
function message(id = 9000000000000017) {
  return { message: { text: `/start web_${token}`, chat: { type: "private", id },
    from: { id, first_name: "ניסוי", last_name: "בלבד" } } };
}
function fixture(matches = true, newUser = false) {
  const calls = [], replies = [];
  const client = { query: async (sql, args) => {
    calls.push({ sql, args });
    return { rows: sql.includes("FOR UPDATE") && matches ? [{ id: "registration", verified_at: null }]
      : sql.includes("INSERT INTO") && newUser ? [{ telegram_user_id: "9000000000000017" }] : [] };
  }, release() {} };
  return { calls, replies, pool: { connect: async () => client },
    telegram: { sendMessage: async (id, text) => replies.push({ id, text }) } };
}
test("ordinary text and voice still bypass website registration", async () => {
  const f = fixture();
  for (const update of [{ message: { text: "מה הלו״ז היום" } }, { message: { voice: { file_id: "voice" } } }]) {
    assert.equal(await handleWebsiteRegistration(update, f.telegram, f.pool), false);
  }
  assert.equal(f.calls.length, 0);
});
test("private sender receives a code, never browser authentication or a subscription just by clicking", async () => {
  const f = fixture();
  assert.equal(await handleWebsiteRegistration(message(), f.telegram, f.pool), true);
  const proof = f.calls.find(c => c.sql.includes("FOR UPDATE"));
  assert.equal(proof.args[1], "9000000000000017");
  assert.match(proof.sql, /telegram_id=\$2 AND link_expires_at>now\(\)/);
  const profile = f.calls.find(c => c.sql.includes("INSERT INTO"));
  assert.match(profile.sql, /ON CONFLICT \(telegram_user_id\) DO NOTHING/);
  assert.deepEqual(profile.args, ["9000000000000017", "ניסוי בלבד", null]);
  assert.ok(!f.calls.some(c => c.sql.includes("subscription_status=")));
  assert.ok(!f.calls.some(c => c.sql.includes("SET verified_at")));
  assert.match(f.calls.find(c => c.sql.includes("SET code_hash")).args[1], /^[a-f0-9]{64}$/);
  assert.match(f.replies[0].text, /\b[0-9]{8}\b/);
  assert.equal(f.replies.length, 1);
});
test("wrong or expired linking token never creates a Telegram account or grants access", async () => {
  const f = fixture(false);
  await handleWebsiteRegistration(message(), f.telegram, f.pool);
  assert.ok(!f.calls.some(c => c.sql.includes("INSERT INTO")));
  assert.match(f.replies[0].text, /לא מתאים/);
});
test("group, forged sender and bot messages cannot prove account ownership", async () => {
  for (const patch of [{ chat: { id: 1, type: "group" } }, { from: { id: 1 } },
    { from: { id: 9000000000000017, is_bot: true } }]) {
    const f = fixture();
    const update = message();
    Object.assign(update.message, patch);
    assert.equal(await handleWebsiteRegistration(update, f.telegram, f.pool), true);
    assert.equal(f.calls.length, 0);
  }
});

test("website notification happens only after a new verified user commits; failed notification keeps registration working", async () => {
  for (const newUser of [false, true]) {
    const f = fixture(true, newUser);
    const registered = [];
    const onRegistered = async id => {
      assert.equal(f.calls.at(-1).sql, "COMMIT");
      registered.push(id);
      throw new Error("synthetic notification failure");
    };
    assert.equal(await handleWebsiteRegistration(message(), f.telegram, f.pool, { onRegistered }), true);
    assert.deepEqual(registered, newUser ? ["9000000000000017"] : []);
    assert.match(f.replies[0].text, /קוד החיבור/);
  }
  const f = fixture(false, true), registered = [];
  await handleWebsiteRegistration(message(), f.telegram, f.pool, { onRegistered: id => registered.push(id) });
  assert.deepEqual(registered, []);
});
