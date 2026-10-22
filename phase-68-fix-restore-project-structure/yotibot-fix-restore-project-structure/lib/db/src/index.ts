import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { createGuardedPool } from "../../../scripts/database-isolation.mjs";

const { Pool } = pg;

export const pool = createGuardedPool(process.env, options => new Pool(options), {
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
