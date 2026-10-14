import pg from "pg";
import { createWorkerLock, LOCK_QUERY_TIMEOUT_MS } from "./worker-lock.js";

let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
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
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: LOCK_QUERY_TIMEOUT_MS,
    statement_timeout: LOCK_QUERY_TIMEOUT_MS,
    query_timeout: LOCK_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "ah-sheli-worker-lock",
  });
  return createWorkerLock(client, { onLost: onLost ?? (() => process.exit(1)) });
}
