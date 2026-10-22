import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createGuardedPool,
  createLabTestEnvironment,
  databaseUrlForProcess,
  validateLocalLabDatabaseUrl,
} from "./database-isolation.mjs";

const localLabUrl = "postgresql://lab_user@127.0.0.1:55432/ah_sheli_lab";

test("Lab test environment excludes inherited Production and generic database variables", () => {
  const env = createLabTestEnvironment({
    PATH: "/safe/path",
    REPLIT_ENVIRONMENT: "production",
    DATABASE_URL: "postgresql://production.invalid/production_db",
    REPLIT_DB_URL: "runtime-managed-sentinel",
    CLERK_SECRET_KEY: "secret-sentinel",
    TELEGRAM_BOT_TOKEN: "token-sentinel",
    NODE_OPTIONS: "--require=untrusted-hook",
    AH_SHELI_DB_LOCK_TEST: "1",
  });

  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.DATA_ENVIRONMENT, "lab");
  assert.equal(env.PATH, "/safe/path");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.REPLIT_DB_URL, undefined);
  assert.equal(env.CLERK_SECRET_KEY, undefined);
  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.AH_SHELI_DB_LOCK_TEST, undefined);
  assert.equal(env.REPLIT_ENVIRONMENT, undefined);
});

test("only an explicit local Lab URL is forwarded to test processes", () => {
  const env = createLabTestEnvironment({ LAB_DATABASE_URL: localLabUrl });
  assert.equal(env.LAB_DATABASE_URL, localLabUrl);
  assert.equal(env.DATABASE_URL, localLabUrl);
  assert.equal(databaseUrlForProcess(env), localLabUrl);
});

test("test launcher rejects remote Lab database targets before spawning tests", () => {
  assert.throws(
    () => createLabTestEnvironment({
      LAB_DATABASE_URL: "postgresql://u:p@prod.example.invalid/prod",
    }),
    /restricted to a local host/u,
  );
});

test("unverified, missing, mismatched, or wrong-mode identities fail before pool construction", () => {
  const cases = [
    { NODE_ENV: "test", DATABASE_URL: "postgresql://prod.invalid/db" },
    { NODE_ENV: "test", DATA_ENVIRONMENT: "lab", DATABASE_URL: localLabUrl },
    {
      NODE_ENV: "test",
      DATA_ENVIRONMENT: "lab",
      LAB_DATABASE_URL: localLabUrl,
      DATABASE_URL: "postgresql://prod.invalid/db",
    },
    {
      NODE_ENV: "test",
      DATA_ENVIRONMENT: "lab",
      LAB_DATABASE_URL: localLabUrl,
      DATABASE_URL: localLabUrl,
      REPLIT_ENVIRONMENT: "production",
    },
    {
      NODE_ENV: "development",
      DATA_ENVIRONMENT: "staging",
      DATABASE_URL: "postgresql://staging.invalid/db",
    },
  ];

  for (const env of cases) {
    let poolFactoryCalled = false;
    assert.throws(() => createGuardedPool(env, () => {
      poolFactoryCalled = true;
      return {};
    }, {}), /Database connection blocked/u);
    assert.equal(poolFactoryCalled, false);
  }
});

test("bot database startup rejects an unverified identity before constructing a pool", () => {
  const botDatabaseUrl = new URL("../artifacts/ah-sheli-bot/src/database.js", import.meta.url).href;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `const { getPool } = await import(${JSON.stringify(botDatabaseUrl)}); getPool();`,
  ], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://synthetic.invalid/no-connect",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATA_ENVIRONMENT is missing or unsupported/u);
  assert.doesNotMatch(result.stderr, /synthetic\\.invalid/u);
});

test("Production URL is accepted only when both declared and runtime environments are Production", () => {
  const env = {
    NODE_ENV: "production",
    DATA_ENVIRONMENT: "production",
    DATABASE_URL: "postgresql://production.invalid/prod",
    REPLIT_ENVIRONMENT: "production",
  };
  assert.equal(databaseUrlForProcess(env), env.DATABASE_URL);

  assert.throws(
    () => databaseUrlForProcess({ ...env, NODE_ENV: "development" }),
    /Production runtime/u,
  );
  assert.throws(
    () => databaseUrlForProcess({ ...env, REPLIT_ENVIRONMENT: "development" }),
    /Production runtime/u,
  );
});

test("Lab URL must be a PostgreSQL URL with a local host and named database", () => {
  assert.equal(validateLocalLabDatabaseUrl(localLabUrl), localLabUrl);
  assert.throws(
    () => validateLocalLabDatabaseUrl("https://localhost/lab"),
    /must use PostgreSQL/u,
  );
  assert.throws(
    () => validateLocalLabDatabaseUrl("postgresql://localhost/"),
    /database name is missing/u,
  );
});
