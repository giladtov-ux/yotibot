import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import pg from "pg";
import { createWorkerLock, WORKER_LOCK_KEY } from "../src/worker-lock.js";
import { getPool, closeDatabase } from "../src/database.js";
import { databaseUrlForProcess } from "../../../scripts/database-isolation.mjs";

class FakeClient extends EventEmitter {
  connected = false;
  ended = false;
  acquired = true;
  owned = true;
  calls = [];
  async connect() { this.connected = true; }
  async query(query) {
    this.calls.push(query);
    if (this.failure) throw this.failure;
    if (query.text.includes("pg_try_advisory_lock")) {
      return { rows: [{ acquired: this.acquired, pid: 42 }] };
    }
    return { rows: [{ owned: this.owned }] };
  }
  async end() { this.ended = true; this.emit("end"); }
}

function setup(client, overrides = {}) {
  let heartbeat;
  let lost = 0;
  let cancelled = false;
  return {
    make: () => createWorkerLock(client, {
      onLost: () => lost++,
      schedule: callback => { heartbeat = callback; return { unref() {} }; },
      cancel: () => { cancelled = true; },
      log: () => {},
      ...overrides,
    }),
    tick: async () => { heartbeat(); await new Promise(resolve => setImmediate(resolve)); },
    lost: () => lost,
    cancelled: () => cancelled,
  };
}

test("idle lock stays alive via bounded heartbeats without reacquiring the session lock", async () => {
  const client = new FakeClient();
  const env = setup(client);
  const lock = await env.make();
  await env.tick();
  await env.tick();
  assert.equal(lock.isActive(), true);
  assert.equal(client.calls.filter(q => q.text.includes("pg_try_advisory_lock")).length, 1);
  assert.deepEqual(client.calls[1].values, [42, WORKER_LOCK_KEY]);
  assert.equal(client.calls[1].query_timeout, 5000);
  await lock.release();
  await lock.release();
  assert.equal(client.ended, true);
  assert.equal(env.lost(), 0);
  assert.equal(env.cancelled(), true);
  assert.equal(client.calls.filter(q => q.text.includes("pg_advisory_unlock")).length, 1);
});

test("another active worker is rejected and its connection is closed", async () => {
  const client = new FakeClient();
  client.acquired = false;
  await assert.rejects(setup(client).make(), /Another Ah Sheli worker/);
  assert.equal(client.ended, true);
});

test("failed acquisition closes its connection", async () => {
  const client = new FakeClient();
  client.failure = new Error("database unavailable");
  await assert.rejects(setup(client).make(), /database unavailable/);
  assert.equal(client.ended, true);
});

for (const cause of ["error", "end", "missing-lock", "query-timeout"]) {
  test(`lock loss (${cause}) fails closed once and never reconnects`, async () => {
    const client = new FakeClient();
    const env = setup(client);
    const lock = await env.make();
    if (cause === "error") client.emit("error", { code: "ECONNRESET" });
    if (cause === "end") client.emit("end");
    if (cause === "missing-lock") client.owned = false;
    if (cause === "query-timeout") client.failure = { code: "QUERY_TIMEOUT" };
    await env.tick();
    client.emit("error", { code: "ECONNRESET" });
    assert.equal(lock.isActive(), false);
    assert.equal(env.lost(), 1);
    assert.equal(env.cancelled(), true);
    assert.equal(client.calls.filter(q => q.text.includes("pg_try_advisory_lock")).length, 1);
    await lock.release();
    assert.equal(client.ended, true);
  });
}

test("heartbeats do not overlap when the database is slow", async () => {
  const client = new FakeClient();
  const env = setup(client);
  const lock = await env.make();
  let complete;
  client.query = () => new Promise(resolve => { complete = resolve; });
  const first = lock.check();
  await lock.check();
  complete({ rows: [{ owned: true }] });
  await first;
  client.query = FakeClient.prototype.query;
  await lock.release();
});

// Explicit opt-in; no bot, Telegram requests, schema, or personal records.
// A separate advisory key ensures this probe cannot compete with the worker.
test("PostgreSQL preserves exclusivity and permits recovery after connection loss", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1"
    || process.env.AH_SHELI_DB_LOCK_TEST !== "1",
}, async () => {
  const options = {
    connectionString: databaseUrlForProcess(process.env),
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    application_name: "ah-sheli-lock-regression",
  };
  const lockKey = 192837464;
  const clients = [];
  const client = () => { const c = new pg.Client(options); clients.push(c); return c; };
  const settings = { lockKey, log: () => {} };
  let first;
  let recovered;
  try {
    let lost = 0;
    const firstClient = client();
    first = await createWorkerLock(firstClient, { ...settings, onLost: () => lost++ });
    await first.check();
    assert.equal(first.isActive(), true);
    await assert.rejects(createWorkerLock(client(), settings), /Another Ah Sheli worker/);
    // End only our synthetic test session, never a production/worker backend.
    await firstClient.end();
    assert.equal(first.isActive(), false);
    assert.equal(lost, 1);
    recovered = await createWorkerLock(client(), settings);
    await recovered.check();
    assert.equal(recovered.isActive(), true);
  } finally {
    await first?.release().catch(() => undefined);
    await recovered?.release().catch(() => undefined);
    await Promise.all(clients.map(c => c.end().catch(() => undefined)));
  }
});

test("an idle query-pool error is handled and does not invalidate the lock", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1"
    || process.env.AH_SHELI_DB_LOCK_TEST !== "1",
}, async () => {
  const pool = getPool();
  try {
    pool.emit("error", new Error("synthetic idle socket closed"));
    const { rows } = await pool.query("SELECT 1 AS alive");
    assert.equal(rows[0].alive, 1);
  } finally {
    await closeDatabase();
  }
});
