import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as nodeCrypto from "node:crypto";
import pg from "pg";
import ts from "typescript";
import { billingRuntimeEnabled } from "../src/lib/whop-config.ts";

const runtimeSource = readFileSync(new URL("../src/lib/billing-runtime.ts", import.meta.url), "utf8");

function loadRuntime(env) {
  const effects = {
    imports: [],
    queries: [],
    dbPoolConstructions: 0,
    whopClientConstructions: 0,
    providerCalls: 0,
    fetches: 0,
    timers: 0,
  };
  const pool = {
    async query(sql) {
      effects.queries.push(String(sql));
      return { rows: [] };
    },
  };
  const modules = {
    "node:crypto": nodeCrypto,
    "./logger": { logger: { info() {}, warn() {} } },
    "./billing-config": { websiteOrigin: () => "https://staging.example.invalid", planAmounts: { Pro: 100, Unlimited: 200 } },
    "./whop-config": {
      billingCheckoutEnabled: () => false,
      billingRuntimeEnabled: candidate => billingRuntimeEnabled(candidate ?? env),
      hasWhopSandboxConfiguration: () => true,
      whopCompanyId: () => "company_test",
      whopMode: () => "sandbox",
      whopPlanId: tier => `plan_test_${tier.toLowerCase()}`,
    },
    "../../../../lib/egress/egress-gate.cjs": {
      __esModule: true,
      default: { getProcessEgressGate: () => ({ status: () => ({ tripped: false }) }) },
    },
    "@workspace/db": {
      get pool() {
        effects.dbPoolConstructions++;
        return pool;
      },
    },
    "./whopClient": {
      getWhopClient: async () => {
        effects.whopClientConstructions++;
        return {
          plans: { retrieve: async () => { effects.providerCalls++; throw Error("unexpected Whop call"); } },
        };
      },
    },
    "./whop-webhook": {
      processVerifiedWhopWebhook: async () => { effects.providerCalls++; },
    },
    "./whop-reconciliation": {
      reconcileWhopPayments: async () => { effects.providerCalls++; },
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(runtimeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    process: { env },
    Buffer,
    console,
    setInterval() { effects.timers++; throw Error("unexpected timer"); },
    clearInterval() {},
    setTimeout() { effects.timers++; throw Error("unexpected retry timer"); },
    clearTimeout() {},
    fetch: async () => { effects.fetches++; throw Error("unexpected network call"); },
    require(name) {
      effects.imports.push(name);
      if (!(name in modules)) throw Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return { runtime: module.exports, effects };
}

test("Staging billing startup is a no-op even with complete Sandbox config and checkout disabled", async () => {
  const baseEnv = {
    NODE_ENV: "production",
    WHOP_MODE: "live",
    WHOP_API_KEY: "mock-live-key-not-used",
    WHOP_COMPANY_ID: "company_live_mock",
    WHOP_SANDBOX_API_KEY: "mock-sandbox-key",
    WHOP_SANDBOX_COMPANY_ID: "company_test",
    WHOP_SANDBOX_PRO_PLAN_ID: "plan_test_pro",
    WHOP_SANDBOX_UNLIMITED_PLAN_ID: "plan_test_unlimited",
    BILLING_CHECKOUTS_ENABLED: "false",
    TELEGRAM_BOT_TOKEN: "mock-telegram-token",
    CLOUD_CUTOVER_APPROVED: "0",
  };

  for (const env of [
    { ...baseEnv, DEPLOYMENT_ENV: "staging", DATA_ENVIRONMENT: "staging" },
    { ...baseEnv, DATA_ENVIRONMENT: "staging" },
  ]) {
    const { runtime, effects } = loadRuntime(env);
    await runtime.initializeBilling();
    await runtime.reconcilePayments();
    assert.equal(await runtime.paidPrice("Pro"), null);
    await assert.rejects(
      runtime.processWhopWebhook(Buffer.from("mock"), {}),
      /billing_runtime_disabled/u,
    );

    assert.equal(effects.queries.length, 0, "no DDL or DML query may run");
    assert.equal(effects.dbPoolConstructions, 0, "Billing must not load the DB pool");
    assert.equal(effects.whopClientConstructions, 0, "Billing must not construct a Whop client");
    assert.equal(effects.providerCalls, 0, "webhook and reconciliation paths must stay idle");
    assert.equal(effects.fetches, 0, "no Telegram or provider HTTP request may run");
    assert.equal(effects.timers, 0, "no reconciliation or retry timer may be scheduled");
    assert.equal(
      effects.imports.some(name => ["@workspace/db", "./whopClient", "./whop-webhook", "./whop-reconciliation"].includes(name)),
      false,
      "database and provider modules must not load indirectly",
    );
  }
});

test("billing startup policy fails closed for either Staging identity marker", () => {
  assert.equal(billingRuntimeEnabled({ DEPLOYMENT_ENV: "staging" }), false);
  assert.equal(billingRuntimeEnabled({ DATA_ENVIRONMENT: "staging" }), false);
  assert.equal(billingRuntimeEnabled({ DEPLOYMENT_ENV: "production", DATA_ENVIRONMENT: "production" }), true);

  const apiStartup = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(apiStartup, /if\s*\(billingRuntimeEnabled\(process\.env\)\)\s*\{\s*void initializeBilling/u);
});

test("database module import constructs only a lazy pool and cannot connect or query", async () => {
  const source = readFileSync(new URL("../../../lib/db/src/index.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const originalPoolConnect = pg.Pool.prototype.connect;
  const originalPoolQuery = pg.Pool.prototype.query;
  const originalClientConnect = pg.Client.prototype.connect;
  let connectionAttempts = 0, queryAttempts = 0;
  pg.Pool.prototype.connect = function () {
    connectionAttempts++;
    throw Error("Lab test blocked a database connection attempt");
  };
  pg.Pool.prototype.query = function () {
    queryAttempts++;
    throw Error("Lab test blocked a database query");
  };
  pg.Client.prototype.connect = function () {
    connectionAttempts++;
    throw Error("Lab test blocked a database client connection attempt");
  };

  let module;
  try {
    module = { exports: {} };
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      process: {
        env: {
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "staging",
          DATA_ENVIRONMENT: "staging",
          CLOUD_CUTOVER_APPROVED: "0",
        },
        cwd: () => "/isolated-lab",
      },
      console,
      require(name) {
        if (name === "drizzle-orm/node-postgres") return { drizzle: pool => ({ pool }) };
        if (name === "pg") return { __esModule: true, default: pg };
        if (name === "./schema") return {};
        if (name === "../../../scripts/database-isolation.mjs") {
          return {
            createGuardedPool(_env, createPool, options) {
              return createPool({
                ...options,
                connectionString: "postgresql://lab_user:mock@127.0.0.1:5432/ah_sheli_lab",
              });
            },
          };
        }
        throw Error(`Unexpected dependency: ${name}`);
      },
    });
    assert.equal(connectionAttempts, 0);
    assert.equal(queryAttempts, 0);
    assert.equal(module.exports.pool.totalCount, 0);
  } finally {
    pg.Pool.prototype.connect = originalPoolConnect;
    pg.Pool.prototype.query = originalPoolQuery;
    pg.Client.prototype.connect = originalClientConnect;
    if (module?.exports?.pool) await module.exports.pool.end();
  }
});
