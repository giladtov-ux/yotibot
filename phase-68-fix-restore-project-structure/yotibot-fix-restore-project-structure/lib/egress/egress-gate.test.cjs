"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  EgressConfigurationError,
  EgressDeniedError,
  createEgressGate,
  createEgressPolicy,
  createGatedFetch,
  browserConnectSource,
} = require("./egress-gate.cjs");

const approvedEnv = targets => ({
  NODE_ENV: "test",
  EGRESS_APPROVED: "1",
  EGRESS_APPROVAL_ENV: "test",
  EGRESS_APPROVED_BY: "local-test",
  EGRESS_APPROVAL_REF: "TEST-109",
  EGRESS_ALLOWED_TARGETS: targets,
});

function runChild(script, env = {}) {
  return spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, "../.."),
    env: { PATH: process.env.PATH, NODE_ENV: "development", ...env },
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("missing approval fails closed and cannot dispatch through an injected transport", async () => {
  const gate = createEgressGate(createEgressPolicy({ NODE_ENV: "test" }));
  assert.throws(() => gate.assertStartupAuthorized(), EgressConfigurationError);
  let dispatched = 0;
  const fetch = createGatedFetch(gate, async () => { dispatched++; });
  await assert.rejects(fetch("https://api.telegram.org/bot/redacted"), EgressDeniedError);
  assert.equal(dispatched, 0);
});

test("approved exact host and port authorize a mock transport only", async () => {
  const gate = createEgressGate(createEgressPolicy(approvedEnv("api.telegram.org:443")));
  let dispatched = 0;
  const fetch = createGatedFetch(gate, async (input, init) => {
    dispatched++;
    assert.equal(new URL(input).hostname, "api.telegram.org");
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: true, status: 200 };
  });
  const response = await fetch("https://api.telegram.org/bot/test-method");
  assert.equal(response.status, 200);
  assert.equal(dispatched, 1);
  await assert.rejects(fetch("https://api.whop.com/api"), error =>
    error.code === "EGRESS_TARGET_NOT_ALLOWLISTED");
  assert.equal(dispatched, 1);
});

test("invalid approvals, environment mismatch, and wildcard targets are rejected", () => {
  assert.throws(() => createEgressPolicy({
    ...approvedEnv("api.telegram.org:443"), EGRESS_APPROVAL_ENV: "production",
  }), EgressConfigurationError);
  assert.throws(() => createEgressPolicy({
    ...approvedEnv("*.telegram.org:443"),
  }), EgressConfigurationError);
  assert.throws(() => createEgressPolicy({
    ...approvedEnv("api.telegram.org"),
  }), EgressConfigurationError);
  assert.throws(() => createEgressPolicy({
    ...approvedEnv("api.telegram.org:443"), EGRESS_APPROVED: "yes",
  }), EgressConfigurationError);
});

test("Staging egress approval uses deployment identity independently of NODE_ENV", () => {
  const staging = createEgressPolicy({
    ...approvedEnv("dpg-stage12345-a.oregon-postgres.render.com:5432"),
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "staging",
    EGRESS_APPROVAL_ENV: "staging",
  });
  assert.equal(staging.environment, "staging");
  assert.equal(staging.approved, true);
  assert.deepEqual(staging.targets, ["dpg-stage12345-a.oregon-postgres.render.com:5432"]);
  const gate = createEgressGate(staging);
  assert.throws(() => gate.authorize("https://api.telegram.org"), error =>
    error.code === "EGRESS_TARGET_NOT_ALLOWLISTED");

  assert.throws(() => createEgressPolicy({
    ...approvedEnv("dpg-stage12345-a.oregon-postgres.render.com:5432"),
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "staging",
    EGRESS_APPROVAL_ENV: "production",
  }), EgressConfigurationError);
});

test("browser connect policy is limited to explicitly approved origins", () => {
  const policy = createEgressPolicy({
    ...approvedEnv("accounts.example:443,api.telegram.org:443"),
    EGRESS_BROWSER_ALLOWED_ORIGINS: "https://accounts.example",
  });
  assert.equal(browserConnectSource(policy), "connect-src 'self' https://accounts.example");
  assert.throws(() => createEgressPolicy({
    ...approvedEnv("api.telegram.org:443"),
    EGRESS_BROWSER_ALLOWED_ORIGINS: "https://accounts.example",
  }), EgressConfigurationError);
});

test("queued concurrent requests are denied if the kill switch trips before dispatch", async () => {
  const gate = createEgressGate(createEgressPolicy(approvedEnv("api.whop.com:443")));
  let dispatched = 0;
  const fetch = createGatedFetch(gate, async () => { dispatched++; });
  const pending = Array.from({ length: 12 }, () => fetch("https://api.whop.com/api"));
  gate.trip();
  const results = await Promise.allSettled(pending);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(dispatched, 0);
  await assert.rejects(fetch("https://api.whop.com/api"), error =>
    error.code === "EGRESS_KILL_SWITCH_ACTIVE");
});

test("the kill switch aborts in-flight mocked requests and remains latched", async () => {
  const gate = createEgressGate(createEgressPolicy(approvedEnv("api.whop.com:443")));
  let dispatched = 0;
  let inFlightSignal;
  const fetch = createGatedFetch(gate, (_input, init) => {
    dispatched++;
    inFlightSignal = init.signal;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("mock-aborted")), { once: true });
    });
  });
  const pending = fetch("https://api.whop.com/api");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatched, 1);
  assert.equal(inFlightSignal.aborted, false);
  assert.equal(gate.trip(), 1);
  await assert.rejects(pending, /mock-aborted/);
  assert.equal(inFlightSignal.aborted, true);
  assert.equal(gate.trip(), 0);
});

test("the kill switch also aborts approved loopback API and database requests", async () => {
  const gate = createEgressGate(createEgressPolicy(approvedEnv("api.whop.com:443")));
  let dispatched = 0;
  const fetch = createGatedFetch(gate, (_input, init) => {
    dispatched++;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("loopback-aborted")), { once: true });
    });
  });
  const pending = fetch("http://127.0.0.1:5000/internal");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatched, 1);
  assert.equal(gate.status().activeRequests, 1);
  gate.trip();
  await assert.rejects(pending, /loopback-aborted/);
  assert.equal(gate.status().activeRequests, 0);
});

test("process bootstrap halts on restart when approval is absent", () => {
  const bootstrapPath = path.resolve(__dirname, "bootstrap.cjs");
  const result = runChild(`require(${JSON.stringify(bootstrapPath)})`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Egress authorization is missing, invalid, or not approved/u);
  assert.doesNotMatch(result.stderr, /TELEGRAM_BOT_TOKEN|DATABASE_URL|WHOP_API_KEY/u);
});

test("global fetch, HTTP, TCP, and DNS paths are blocked before their transports run", () => {
  const gatePath = path.resolve(__dirname, "egress-gate.cjs");
  const script = `
    const http = require("node:http");
    const https = require("node:https");
    const tls = require("node:tls");
    const http2 = require("node:http2");
    const net = require("node:net");
    const dns = require("node:dns");
    const dgram = require("node:dgram");
    let dispatched = 0;
    globalThis.fetch = async () => { dispatched++; };
    http.request = () => { dispatched++; return { once() { return this; } }; };
    const gate = require(${JSON.stringify(gatePath)});
    try { gate.installProcessEgressGuard(process.env); } catch {}
    const replacementFetch = async () => { dispatched++; };
    const replacementRequest = () => { dispatched++; };
    try { Object.defineProperty(globalThis, "fetch", { value: replacementFetch }); } catch {}
    try { Object.defineProperty(http, "request", { value: replacementRequest }); } catch {}
    if (globalThis.fetch === replacementFetch || http.request === replacementRequest) process.exit(3);
    const checks = [];
    checks.push(fetch("https://api.telegram.org/").catch(e => e.code));
    try { http.request("https://api.whop.com/"); } catch (e) { checks.push(Promise.resolve(e.code)); }
    try { https.request("https://api.whop.com/"); } catch (e) { checks.push(Promise.resolve(e.code)); }
    try { tls.connect({ host: "api.telegram.org", port: 443 }); } catch (e) { checks.push(Promise.resolve(e.code)); }
    try { http2.connect("https://api.telegram.org"); } catch (e) { checks.push(Promise.resolve(e.code)); }
    try { new net.Socket().connect({ host: "database.invalid", port: 5432 }); }
    catch (e) { checks.push(Promise.resolve(e.code)); }
    try { dns.lookup("api.telegram.org", () => {}); }
    catch (e) { checks.push(Promise.resolve(e.code)); }
    try { dgram.createSocket("udp4").send(Buffer.from("blocked"), 53, "203.0.113.1"); }
    catch (e) { checks.push(Promise.resolve(e.code)); }
    if (typeof WebSocket === "function") {
      try { new WebSocket("wss://api.telegram.org"); }
      catch (e) { checks.push(Promise.resolve(e.code)); }
    }
    Promise.all(checks).then(codes => {
      if (dispatched !== 0 || codes.some(code => !String(code).startsWith("EGRESS_"))) process.exit(2);
      process.exit(0);
    });
  `;
  const result = runChild(script);
  assert.equal(result.status, 0, result.stderr);
});

test("the bot entry point halts before token, database, or Telegram initialization", () => {
  const botEntry = path.resolve(__dirname, "../../artifacts/ah-sheli-bot/index.js");
  const result = spawnSync(process.execPath, [botEntry], {
    cwd: path.resolve(__dirname, "../.."),
    env: { PATH: process.env.PATH, NODE_ENV: "development" },
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Egress authorization is missing, invalid, or not approved/u);
  assert.doesNotMatch(result.stderr, /TELEGRAM_BOT_TOKEN|DATABASE_URL/u);
});

test("maintenance command entry points also halt before touching provider or database state", () => {
  const root = path.resolve(__dirname, "../..");
  const entries = [
    [path.join(root, "artifacts/ah-sheli-bot/src/connect-owner.js")],
    [path.join(root, "scripts/telegram-render-webhook.mjs"), "--check"],
    [path.join(root, "scripts/cloud-start.mjs")],
  ];
  for (const args of entries) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { PATH: process.env.PATH, NODE_ENV: "development" },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Egress authorization is missing, invalid, or not approved|Webhook operation blocked/iu);
    assert.doesNotMatch(result.stderr, /TELEGRAM_BOT_TOKEN|DATABASE_URL|WHOP_API_KEY/u);
  }
});

test("unapproved child processes are blocked while the guarded bot worker is the only allowed spawn", () => {
  const gatePath = path.resolve(__dirname, "egress-gate.cjs");
  const workspaceRoot = path.resolve(__dirname, "../..");
  const script = `
    const cp = require("node:child_process");
    let spawned = 0;
    cp.spawn = () => { spawned++; return { once() { return this; } }; };
    const gateModule = require(${JSON.stringify(gatePath)});
    gateModule.installProcessEgressGuard(process.env);
    let blocked = false;
    try { cp.spawn(process.execPath, ["-e", "process.exit(0)"]); }
    catch (error) { blocked = error.code === "EGRESS_CHILD_PROCESS_BLOCKED"; }
    try { cp.execSync("curl https://api.telegram.org"); }
    catch (error) { blocked = blocked && error.code === "EGRESS_CHILD_PROCESS_BLOCKED"; }
    const worker = require("node:path").join(${JSON.stringify(workspaceRoot)}, "artifacts/ah-sheli-bot/index.js");
    const preload = require("node:path").join(${JSON.stringify(workspaceRoot)}, "lib/egress/bootstrap.cjs");
    cp.spawn(process.execPath, ["--require", preload, worker], { cwd: ${JSON.stringify(workspaceRoot)} });
    process.exit(blocked && spawned === 1 ? 0 : 2);
  `;
  const result = runChild(script, approvedEnv("api.telegram.org:443"));
  assert.equal(result.status, 0, result.stderr);
});

test("worker threads preload the gate and are tripped with their supervisor", () => {
  const gatePath = path.resolve(__dirname, "egress-gate.cjs");
  const root = path.resolve(__dirname, "../..");
  const script = `
    const { EventEmitter } = require("node:events");
    const workerThreads = require("node:worker_threads");
    let terminated = 0;
    let message;
    class FakeWorker extends EventEmitter {
      constructor(filename, options) { super(); this.filename = filename; this.options = options; }
      postMessage(value) { message = value; }
      terminate() { terminated++; return Promise.resolve(); }
    }
    workerThreads.Worker = FakeWorker;
    const gateModule = require(${JSON.stringify(gatePath)});
    const gate = gateModule.installProcessEgressGuard(process.env);
    const worker = new workerThreads.Worker("mock-worker.js", { execArgv: [] });
    const bootstrap = require("node:path").join(${JSON.stringify(root)}, "lib/egress/bootstrap.cjs");
    gate.trip();
    const passed = worker.options.execArgv.includes("--require")
      && worker.options.execArgv.includes(bootstrap)
      && terminated === 1
      && message?.type === "AH_SHELI_EGRESS_KILL_SWITCH";
    process.exit(passed ? 0 : 2);
  `;
  const result = runChild(script, approvedEnv("api.telegram.org:443"));
  assert.equal(result.status, 0, result.stderr);
});

test("SIGUSR2 trips the process-wide kill switch without dispatching a request", () => {
  const bootstrapPath = path.resolve(__dirname, "bootstrap.cjs");
  const script = `
    let dispatched = 0;
    globalThis.fetch = async () => { dispatched++; return { ok: true }; };
    require(${JSON.stringify(bootstrapPath)});
    process.emit("SIGUSR2");
    fetch("https://api.telegram.org/").then(
      () => process.exit(2),
      error => process.exit(dispatched === 0 && error.code === "EGRESS_KILL_SWITCH_ACTIVE" ? 0 : 3),
    );
  `;
  const result = runChild(script, approvedEnv("api.telegram.org:443"));
  assert.equal(result.status, 0, result.stderr);
});

test("a tripped supervisor signals its worker and does not permit replacement egress", () => {
  const gate = createEgressGate(createEgressPolicy(approvedEnv("api.telegram.org:443")));
  const signals = [];
  const child = {
    once(event, listener) { if (event === "exit") this.onExit = listener; },
    kill(signal) { signals.push(signal); return true; },
  };
  gate.registerChild(child);
  gate.trip();
  assert.deepEqual(signals, ["SIGUSR2"]);
  assert.equal(gate.status().tripped, true);
  assert.throws(() => gate.authorize("https://api.telegram.org"), error =>
    error.code === "EGRESS_KILL_SWITCH_ACTIVE");
});
