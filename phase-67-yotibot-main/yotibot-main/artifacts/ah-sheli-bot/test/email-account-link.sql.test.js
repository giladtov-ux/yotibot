import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { getPool, closeDatabase } from "../src/database.js";
import { handleEmailAccountLink } from "../src/email-account-link.js";

test("email identity proofs use isolated real SQL, explicit consent and atomic uniqueness", {
  skip: !process.env.DATABASE_URL,
}, async t => {
  const client = await getPool().connect();
  const schema = `qa_email_${randomBytes(8).toString("hex")}`;
  const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
  const token = randomBytes(24).toString("hex");
  const digest = createHash("sha256").update(token).digest("hex");
  const sent = [];
  const telegram = {
    sendMessage: async (_id, text, options) => { sent.push({ text, options }); },
    call: async () => {},
  };
  const start = id => ({ message: { text: `/start email_${token}`, from: { id, first_name: "QA" }, chat: { id, type: "private" } } });
  const confirm = (id, yes = true) => ({ callback_query: { id: "qa-callback", data: `email:${yes ? "y" : "n"}:${token}`,
    from: { id, first_name: "QA" }, message: { chat: { id, type: "private" } } } });
  const account = async () => (await client.query("SELECT telegram_id FROM ah_sheli_email_users WHERE clerk_id='qa-user'")).rows[0].telegram_id;
  const seed = async () => {
    sent.length = 0;
    await client.query("TRUNCATE ah_sheli_email_links,ah_sheli_email_users,ah_sheli_telegram_users CASCADE");
    await client.query("INSERT INTO ah_sheli_email_users(clerk_id,email) VALUES('qa-user','qa+clerk_test@example.test')");
    await client.query(`INSERT INTO ah_sheli_email_links(digest,clerk_id,expires_at) VALUES($1,'qa-user',NOW()+INTERVAL '15 minutes')`, [digest]);
  };
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE ah_sheli_email_users(clerk_id TEXT PRIMARY KEY,email TEXT NOT NULL,telegram_id TEXT UNIQUE);
      CREATE TABLE ah_sheli_email_links(digest TEXT PRIMARY KEY,clerk_id TEXT REFERENCES ah_sheli_email_users(clerk_id),
        candidate_id TEXT,expires_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ);
      CREATE TABLE ah_sheli_telegram_users(telegram_user_id TEXT PRIMARY KEY,display_name TEXT,username TEXT);`);
    await t.test("ordinary text and ordinary callbacks do not enter account linking", async () => {
      assert.equal(await handleEmailAccountLink({ message: { text: "רשימת קניות" } }, telegram, pool), false);
      assert.equal(await handleEmailAccountLink({ callback_query: { data: "v:d:record" } }, telegram, pool), false);
    });
    await t.test("opening the deep link never binds identity before explicit confirmation", async () => {
      await seed();
      await handleEmailAccountLink(start(123), telegram, pool);
      assert.equal(await account(), null);
      assert.equal((await client.query("SELECT candidate_id FROM ah_sheli_email_links")).rows[0].candidate_id, "123");
      assert.match(sent[0].text, /qa\+clerk_test@example.test/);
      assert.match(sent[0].options.reply_markup.inline_keyboard[0][0].callback_data, /^email:y:/);
    });
    await t.test("a different Telegram user cannot accept or retarget another user's link", async () => {
      await seed();
      await handleEmailAccountLink(start(123), telegram, pool);
      await handleEmailAccountLink(confirm(456), telegram, pool);
      await handleEmailAccountLink(start(456), telegram, pool);
      assert.equal(await account(), null);
      assert.equal((await client.query("SELECT candidate_id FROM ah_sheli_email_links")).rows[0].candidate_id, "123");
    });
    await t.test("approval persists SQL first and consumes the token; repeated approval is idempotent", async () => {
      await seed();
      const registered = [];
      const options = { onRegistered: async id => {
        assert.equal(await account(), "123");
        registered.push(id);
        throw new Error("synthetic notification failure");
      } };
      await handleEmailAccountLink(start(123), telegram, pool);
      const checkedTelegram = { ...telegram, sendMessage: async (...args) => {
        assert.equal(await account(), "123");
        assert.notEqual((await client.query("SELECT consumed_at FROM ah_sheli_email_links")).rows[0].consumed_at, null);
        return telegram.sendMessage(...args);
      } };
      await handleEmailAccountLink(confirm(123), checkedTelegram, pool, options);
      await handleEmailAccountLink(confirm(123), checkedTelegram, pool, options);
      assert.deepEqual(registered, ["123"]);
      assert.equal(await account(), "123");
      assert.equal((await client.query("SELECT count(*)::int AS n FROM ah_sheli_telegram_users")).rows[0].n, 1);
    });
    await t.test("decline consumes the link without binding or granting access", async () => {
      await seed();
      await handleEmailAccountLink(start(123), telegram, pool);
      await handleEmailAccountLink(confirm(123, false), telegram, pool);
      await handleEmailAccountLink(confirm(123), telegram, pool);
      assert.equal(await account(), null);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM ah_sheli_telegram_users")).rows[0].n, 0);
    });
    await t.test("expired links cannot bind an account", async () => {
      await seed();
      await client.query("UPDATE ah_sheli_email_links SET expires_at=NOW()-INTERVAL '1 minute'");
      await handleEmailAccountLink(start(123), telegram, pool);
      assert.equal(await account(), null);
    });
    await t.test("SQL uniqueness prevents claiming Telegram already linked to a different email", async () => {
      await seed();
      await client.query("INSERT INTO ah_sheli_email_users(clerk_id,email,telegram_id) VALUES('existing','other@example.test','123')");
      await handleEmailAccountLink(start(123), telegram, pool);
      await handleEmailAccountLink(confirm(123), telegram, pool);
      assert.equal(await account(), null);
      assert.equal((await client.query("SELECT telegram_id FROM ah_sheli_email_users WHERE clerk_id='existing'")).rows[0].telegram_id, "123");
      assert.match(sent.at(-1).text, /כבר מקושר/);
    });
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await closeDatabase();
  }
});
