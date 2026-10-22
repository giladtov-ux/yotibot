import pg from "pg";
import { createWorkerLock, LOCK_QUERY_TIMEOUT_MS } from "./worker-lock.js";
import { databaseUrlForProcess } from "../../../scripts/database-isolation.mjs";

let pool;
export function getPool() {
  const connectionString = databaseUrlForProcess(process.env);
  pool ??= new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 16_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "ah-sheli-queries",
  });
  // Idle query connections may disappear independently of the worker lock.
  // pg removes them from the pool; an unhandled error must not kill the bot.
  if (!pool.listenerCount("error")) pool.on("error", () => {
    console.warn("[Ah Sheli] Idle query connection closed; pool will replace it.");
  });
  return pool;
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
}

// A session lock prevents two processes against this database from running
// polling, reminder delivery, or snapshot writes at the same time.
export async function acquireWorkerLock(onLost) {
  const connectionString = databaseUrlForProcess(process.env);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: LOCK_QUERY_TIMEOUT_MS,
    statement_timeout: LOCK_QUERY_TIMEOUT_MS,
    query_timeout: LOCK_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "ah-sheli-worker-lock",
  });
  return createWorkerLock(client, { onLost: onLost ?? (() => process.exit(1)) });
}
