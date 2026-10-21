import { randomBytes } from "node:crypto";
import { getPool } from "./database.js";

export async function getHookToken() {
  await getPool().query(
    `INSERT INTO ah_sheli_config (key, value) VALUES ('hook_token', $1)
     ON CONFLICT (key) DO NOTHING`,
    [randomBytes(32).toString("hex")],
  );
  const { rows } = await getPool().query(
    "SELECT value FROM ah_sheli_config WHERE key = 'hook_token'",
  );
  return rows[0].value;
}

export async function claimUpdate(updateId, request = {}, pool = getPool()) {
  const { rowCount } = await pool.query(
    `INSERT INTO ah_sheli_updates (update_id, status, chat_id, request_text)
     VALUES ($1, 'processing', $2, $3)
     ON CONFLICT (update_id) DO NOTHING`,
    [updateId, request.chatId ?? null, request.text?.slice(0, 240) ?? null],
  );
  return rowCount === 1;
}

export async function finishUpdate(updateId, status, pool = getPool()) {
  await pool.query(
    "UPDATE ah_sheli_updates SET status = $2 WHERE update_id = $1",
    [updateId, status],
  );
}

// Read-only: neither status proves that the action failed or was rolled back.
// Legacy updates lack chat metadata, so surface them as unattributed IDs only.
export async function readInterruptedRequests(chatId, {
  currentUpdateId, beforeUpdateId = null, includeReviewed = false,
} = {}, pool = getPool()) {
  const { rows } = await pool.query(
    `SELECT update_id, status, created_at, chat_id, request_text, reviewed_at
     FROM ah_sheli_updates
     WHERE status IN ('processing', 'failed')
       AND (chat_id = $1 OR chat_id IS NULL)
       AND ($2::bigint IS NULL OR update_id <> $2)
       AND ($3::bigint IS NULL OR update_id < $3)
       AND ($4::boolean OR reviewed_at IS NULL)
     ORDER BY update_id DESC LIMIT 11`,
    [chatId, currentUpdateId ?? null, beforeUpdateId, includeReviewed],
  );
  return rows;
}

// Review is only an owner acknowledgement, never completion or permission to replay.
// Keep legacy rows unattributed and retain the original update ID/status/metadata.
export async function markInterruptedRequestReviewed(chatId, updateId, {
  currentUpdateId,
} = {}, pool = getPool()) {
  if (!chatId || !Number.isSafeInteger(updateId) || updateId < 1) return false;
  const { rowCount } = await pool.query(
    `UPDATE ah_sheli_updates
     SET reviewed_at = COALESCE(reviewed_at, NOW())
     WHERE update_id = $1
       AND (chat_id = $2 OR chat_id IS NULL)
       AND status IN ('processing', 'failed')
       AND ($3::bigint IS NULL OR update_id <> $3)
     RETURNING update_id`,
    [updateId, String(chatId), currentUpdateId ?? null],
  );
  return rowCount === 1;
}

// Removing acknowledgement does not reset processing or release deduplication.
export async function unmarkInterruptedRequestReviewed(chatId, updateId, {
  currentUpdateId,
} = {}, pool = getPool()) {
  if (!chatId || !Number.isSafeInteger(updateId) || updateId < 1) return false;
  const { rowCount } = await pool.query(
    `UPDATE ah_sheli_updates
     SET reviewed_at = NULL
     WHERE update_id = $1
       AND (chat_id = $2 OR chat_id IS NULL)
       AND status IN ('processing', 'failed')
       AND ($3::bigint IS NULL OR update_id <> $3)
     RETURNING update_id`,
    [updateId, String(chatId), currentUpdateId ?? null],
  );
  return rowCount === 1;
}

export async function loadHistory(chatId) {
  const { rows } = await getPool().query(
    `SELECT role, content FROM ah_sheli_messages WHERE chat_id = $1
     ORDER BY id DESC LIMIT 32`,
    [chatId],
  );
  return rows.reverse();
}

// Summary-only retrieval: owner-bound, dated, and wider than the chat's 32 rows.
export async function loadSummaryHistory(chatId, period, pool = getPool()) {
  const { rows } = await pool.query(
    `SELECT role, content, created_at AS "createdAt"
     FROM ah_sheli_messages WHERE chat_id = $1
       AND ($2::timestamptz IS NULL OR created_at >= $2)
       AND created_at < $3
     ORDER BY id DESC LIMIT 1001`,
    [chatId, period.from === null ? null : new Date(period.from), new Date(period.until)],
  );
  return { rows: rows.slice(0, 1000).reverse(), partial: rows.length > 1000 };
}

export async function saveTurn(chatId, text, reply) {
  await getPool().query(
    `INSERT INTO ah_sheli_messages (chat_id, role, content)
     VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
    [chatId, text, reply],
  );
}
