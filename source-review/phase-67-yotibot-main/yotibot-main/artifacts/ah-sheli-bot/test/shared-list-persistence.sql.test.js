import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPool, closeDatabase } from "../src/database.js";

test("goal deadlines and shared-list deletion commit atomically in isolated real SQL", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ah-sheli-shares-"));
  // Set isolation before importing any module with a transitive store import.
  process.env.AH_SHELI_DATA_DIR = directory;
  const { createEmptyStore, initializeStatePersistence, saveStore, loadStore } = await import("../src/store.js");
  const { applyMiniAppAction } = await import("../src/mini-app-actions.js");
  const client = await getPool().connect();
  const schema = `qa_shares_${randomBytes(8).toString("hex")}`;
  const pool = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) };
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE ah_sheli_state(key TEXT PRIMARY KEY,value JSONB,updated_at TIMESTAMPTZ);
      CREATE TABLE ah_sheli_list_shares(id UUID PRIMARY KEY,owner_id TEXT,list_name TEXT,member_id TEXT,role TEXT);`);
    const store = createEmptyStore();
    store.lists["123"] = { מטרות: [], קניות: [] };
    store.lists["456"] = { פרטית: [{ id: "private-item", text: "פרטי", checked: false }] };
    await initializeStatePersistence(store, pool);
    await saveStore(store);
    const deadline = Date.parse("2026-10-15T10:00:00Z");
    const request = { requestId: randomUUID(), action: "create", entity: "item", listName: "מטרות", text: "יעד", dueAt: deadline };
    await applyMiniAppAction(store, "123", request);
    assert.equal((await loadStore(pool)).lists["123"]["מטרות"][0].dueAt, deadline);
    assert.equal((await loadStore(pool)).reminders.length, 0);
    await client.query("INSERT INTO ah_sheli_list_shares VALUES($1,'123','מטרות','456','editor'),($2,'456','פרטית','123','viewer')", [randomUUID(), randomUUID()]);
    // Force revocation to fail: neither data deletion nor access revocation may commit partially.
    await client.query(`CREATE FUNCTION reject_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'qa_revocation_blocked'; END $$;
      CREATE TRIGGER reject_revoke BEFORE DELETE ON ah_sheli_list_shares FOR EACH ROW EXECUTE FUNCTION reject_revoke();`);
    await assert.rejects(applyMiniAppAction(store, "123", {
      requestId: randomUUID(), action: "delete", entity: "list", listName: "מטרות",
    }), /qa_revocation_blocked/);
    assert.equal((await loadStore(pool)).lists["123"]["מטרות"][0].dueAt, deadline);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM ah_sheli_list_shares")).rows[0].n, 2);
    await client.query("DROP TRIGGER reject_revoke ON ah_sheli_list_shares");
    await applyMiniAppAction(store, "123", { requestId: randomUUID(), action: "delete", entity: "list", listName: "מטרות" });
    assert.equal((await loadStore(pool)).lists["123"]["מטרות"], undefined);
    const remaining = (await client.query("SELECT owner_id FROM ah_sheli_list_shares")).rows;
    assert.deepEqual(remaining, [{ owner_id: "456" }]);
    await applyMiniAppAction(store, "123", { requestId: randomUUID(), action: "create", entity: "list", listName: "מטרות" });
    assert.deepEqual((await loadStore(pool)).lists["123"]["מטרות"], []);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM ah_sheli_list_shares WHERE owner_id='123'")).rows[0].n, 0);
    assert.equal((await loadStore(pool)).lists["456"]["פרטית"][0].text, "פרטי");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await closeDatabase();
    await rm(directory, { recursive: true, force: true });
  }
});
