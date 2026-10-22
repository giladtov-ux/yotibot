import test from "node:test";
import assert from "node:assert/strict";
import { getPool, closeDatabase } from "../src/database.js";
import { createTelegramUserRepository } from "../src/telegram-users.js";
import { createUserAccess } from "../src/user-access.js";
import { sendAccessNotification } from "../src/access-notifications.js";

test("real SQL uses atomic new-user detection and durable unique attempts without changing user data", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1",
}, async () => {
  const client = await getPool().connect();
  try {
    // Single connection and temp tables shadow production names; no real records.
    await client.query(`CREATE TEMP TABLE ah_sheli_telegram_users (
      telegram_user_id text PRIMARY KEY, display_name text NOT NULL, username text,
      subscription_status text NOT NULL DEFAULT 'pending', subscription_expires_at timestamptz,
      messages_opted_out boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE ah_sheli_access_notifications (
        event_key text PRIMARY KEY, telegram_user_id text NOT NULL,
        recipient_id text NOT NULL, delivery_status text DEFAULT 'unknown',
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`);
    const pool = { query: client.query.bind(client) };
    const repository = createTelegramUserRepository(pool);
    const actor = { id: "22", name: "Synthetic", username: "synthetic" };
    const results = await Promise.all([repository.register(actor), repository.register(actor)]);
    assert.equal(results.filter(row => row.isNew).length, 1);
    let attempts = 0;
    const telegram = { async sendMessage() {
      attempts++; throw new Error("synthetic missing response");
    } };
    const params = { repository, telegram, eventKey: "registration:22", userId: "22",
      recipientId: "11", text: "synthetic", assertActive() {} };
    await Promise.all([sendAccessNotification(params), sendAccessNotification(params)]);
    assert.equal(attempts, 1);
    assert.equal((await client.query("SELECT delivery_status FROM ah_sheli_access_notifications")).rows[0].delivery_status, "unknown");
    const grant = await repository.grant("22", 1);
    await repository.register({ ...actor, name: "Updated" });
    assert.equal((await repository.get("22")).expiresAt, grant.expiresAt);
    const restarted = createUserAccess({ repository: createTelegramUserRepository(pool), ownerId: "11" });
    await restarted.notifyNewRegistration("22", telegram);
    assert.equal(attempts, 1);
    const before = await repository.get("22");
    // Confirmed send followed by missing receipt is also never replayed.
    const receiptFailure = { ...repository, async finishNotification() { throw new Error("receipt missing"); } };
    const successTelegram = { async sendMessage() { attempts++; } };
    await sendAccessNotification({ ...params, repository: receiptFailure, telegram: successTelegram,
      eventKey: `grant:22:${grant.expiresAt}`, recipientId: "22" });
    await sendAccessNotification({ ...params, telegram: successTelegram,
      eventKey: `grant:22:${grant.expiresAt}`, recipientId: "22" });
    assert.equal(attempts, 2);
    assert.deepEqual(await repository.get("22"), before);
  } finally {
    client.release(true);
    await closeDatabase();
  }
});
