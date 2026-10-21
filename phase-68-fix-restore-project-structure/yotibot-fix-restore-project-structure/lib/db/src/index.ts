import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  query_timeout: 16_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: "ah-sheli-api",
});
// Idle socket failures should be recovered by pg, not crash Express.
pool.on("error", () => {
  console.warn("[Ah Sheli API] Idle database connection closed; pool will replace it.");
});
export const db = drizzle(pool, { schema });

export * from "./schema";
