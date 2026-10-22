import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createGuardedPool,
  createLabTestEnvironment,
  databaseUrlForProcess,
  validateLocalLabDatabaseUrl,
} from "./database-isolation.mjs";

const localLabUrl = "postgresql://lab_user@127.0.0.1:55432/ah_sheli_lab";
const stagingHost = "dpg-stage12345-a.oregon-postgres.render.com";
const stagingName = "ah_sheli_staging";
const stagingDatabaseUrl = `postgresql://staging_user@${stagingHost}:5432/${stagingName}`;
const stagingEnv = overrides => ({
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "staging",
  DATA_ENVIRONMENT: "staging",
  CLOUD_CUTOVER_APPROVED: "0",
  DATABASE_URL: stagingDatabaseUrl,
  STAGING_DATABASE_HOST: stagingHost,
  STAGING_DATABASE_NAME: stagingName,
  STAGING_DATABASE_RESOURCE_ID: "dpg-stage12345",
  ...overrides,
});

test("Lab test environment excludes inherited Production and generic database variables", () => {
  const env = createLabTestEnvironment({
    PATH: "/safe/path",
    REPLIT_ENVIRONMENT: "production",
    DATABASE_URL: "postgresql://fixture.invalid/fixture_db",
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

test("standard test runner halts on known Production targets and refuses database URLs", () => {
  assert.throws(
    () => createLabTestEnvironment({ DATABASE_URL: "postgresql://helium/heliumdb" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ DATABASE_URL: "postgresql://helium/ah_sheli_lab" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ DATABASE_URL: "postgresql://127.0.0.1/heliumdb" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ DATABASE_URL: "postgresql://prod-db.example/ah_sheli_lab" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ PGHOST: "helium" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ PGDATABASE: "heliumdb" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ LAB_DATABASE_URL: localLabUrl }),
    /mock-only/u,
  );
  assert.throws(
    () => createLabTestEnvironment({ LAB_SQL_TESTS_ENABLED: "1" }),
    /does not permit database-backed tests/u,
  );
});

test("test launcher exits before spawning Node tests for helium/heliumdb", () => {
  const runnerPath = fileURLToPath(new URL("./run-lab-tests.mjs", import.meta.url));
  for (const databaseUrl of [
    "postgresql://helium/ah_sheli_lab",
    "postgresql://127.0.0.1/heliumdb",
  ]) {
    const result = spawnSync(process.execPath, [
      runnerPath,
      "--test",
      "scripts/lab-memory-database.test.mjs",
    ], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        DATA_ENVIRONMENT: "production",
        DATABASE_URL: databaseUrl,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /known Production or live identifier/u);
    assert.doesNotMatch(result.stderr, /postgresql:|heliumdb/u);
  }
});

test("concurrent test launcher processes all fail closed for Production targets", async () => {
  const runnerPath = fileURLToPath(new URL("./run-lab-tests.mjs", import.meta.url));
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      runnerPath,
      "--test",
      "scripts/lab-memory-database.test.mjs",
    ], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        DATA_ENVIRONMENT: "production",
        DATABASE_URL: "postgresql://helium/heliumdb",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stderr }));
  });

  const results = await Promise.all([launch(), launch(), launch()]);
  for (const result of results) {
    assert.equal(result.status, 2);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /known Production or live identifier/u);
    assert.doesNotMatch(result.stderr, /postgresql:|heliumdb/u);
  }
});

test("a fresh process still rejects Lab SQL opt-in after restart", () => {
  const runnerPath = fileURLToPath(new URL("./run-lab-tests.mjs", import.meta.url));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [
      runnerPath,
      "--test",
      "scripts/lab-memory-database.test.mjs",
    ], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
        DATA_ENVIRONMENT: "lab",
        LAB_SQL_TESTS_ENABLED: "1",
        LAB_DATABASE_URL: localLabUrl,
        DATABASE_URL: localLabUrl,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /mock-only/u);
  }
});

test("test launcher rejects remote Lab database targets before spawning tests", () => {
  assert.throws(
    () => createLabTestEnvironment({
      LAB_DATABASE_URL: "postgresql://lab_user@remote.example.invalid/ah_sheli_lab",
    }),
    /restricted to a local host/u,
  );
});

test("only explicit, local, Lab-named SQL opt-in is accepted by the database guard", () => {
  const env = {
    NODE_ENV: "test",
    NODE_TEST_CONTEXT: "child-v8",
    DATA_ENVIRONMENT: "lab",
    LAB_SQL_TESTS_ENABLED: "1",
    LAB_DATABASE_URL: localLabUrl,
    DATABASE_URL: localLabUrl,
  };
  assert.equal(databaseUrlForProcess(env), localLabUrl);
  assert.throws(
    () => databaseUrlForProcess({ ...env, DATABASE_URL: "postgresql://localhost/heliumdb" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => databaseUrlForProcess({ ...env, DATABASE_URL: "postgresql://localhost/ah_sheli_live" }),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => databaseUrlForProcess({ ...env, PGHOST: "helium" }),
    /known Production or live identifier/u,
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
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: "child-v8",
      DATA_ENVIRONMENT: "production",
      DATABASE_URL: "postgresql://helium/heliumdb",
    },
    {
      NODE_ENV: "test",
      DATA_ENVIRONMENT: "lab",
      LAB_SQL_TESTS_ENABLED: "1",
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

test("verified Render Staging database identity is accepted without opening a connection", () => {
  const env = stagingEnv();
  assert.equal(databaseUrlForProcess(env), stagingDatabaseUrl);

  let capturedOptions;
  const pool = createGuardedPool(env, options => {
    capturedOptions = options;
    return { mocked: true };
  }, { max: 1 });

  assert.deepEqual(pool, { mocked: true });
  assert.equal(capturedOptions.connectionString, stagingDatabaseUrl);
  assert.equal(capturedOptions.max, 1);
});

test("Staging database access fails closed for unverified or Production identities before pool construction", () => {
  const cases = [
    stagingEnv({ DEPLOYMENT_ENV: undefined }),
    stagingEnv({ DATA_ENVIRONMENT: "production" }),
    stagingEnv({ CLOUD_CUTOVER_APPROVED: "1" }),
    stagingEnv({ NODE_ENV: "development" }),
    stagingEnv({ STAGING_DATABASE_HOST: undefined }),
    stagingEnv({ STAGING_DATABASE_NAME: undefined }),
    stagingEnv({ STAGING_DATABASE_RESOURCE_ID: undefined }),
    stagingEnv({ STAGING_DATABASE_RESOURCE_ID: "dpg-prod-12345" }),
    stagingEnv({
      STAGING_DATABASE_HOST: "dpg-other12345-a.oregon-postgres.render.com",
    }),
    stagingEnv({
      DATABASE_URL: "postgresql://prod-db.example/ah_sheli_staging",
    }),
    stagingEnv({
      DATABASE_URL: "postgresql://dpg-stage12345-a.oregon-postgres.render.com/ah_sheli_prod",
    }),
    stagingEnv({
      DATABASE_URL: "postgresql://dpg-stage12345-a.example.invalid/ah_sheli_staging",
      STAGING_DATABASE_HOST: "dpg-stage12345-a.example.invalid",
    }),
    stagingEnv({ REPLIT_ENVIRONMENT: "production" }),
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

test("a Node test process cannot use Render Staging database credentials", () => {
  assert.throws(
    () => databaseUrlForProcess(stagingEnv({ NODE_TEST_CONTEXT: "child-v8" })),
    /test database access requires DATA_ENVIRONMENT=lab/u,
  );
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
    /not PostgreSQL/u,
  );
  assert.throws(
    () => validateLocalLabDatabaseUrl("postgresql://localhost/heliumdb"),
    /known Production or live identifier/u,
  );
  assert.throws(
    () => validateLocalLabDatabaseUrl("postgresql://127.0.0.1/fixture_db"),
    /dedicated ah_sheli_lab namespace/u,
  );
});

test("Node test runner supplies a marker so Production settings cannot be accepted inside a test", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT);
});
