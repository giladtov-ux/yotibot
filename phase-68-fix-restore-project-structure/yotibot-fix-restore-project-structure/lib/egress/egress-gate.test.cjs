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
    const net = require("node:net");
    const dns = require("node:dns");
    let dispatched = 0;
    globalThis.fetch = async () => { dispatched++; };
    http.request = () => { dispatched++; return { once() { return this; } }; };
    const gate = require(${JSON.stringify(gatePath)});
    try { gate.installProcessEgressGuard(process.env); } catch {}
    const checks = [];
    checks.push(fetch("https://api.telegram.org/").catch(e => e.code));
    try { http.request("https://api.whop.com/"); } catch (e) { checks.push(Promise.resolve(e.code)); }
    try { new net.Socket().connect({ host: "database.invalid", port: 5432 }); }
    catch (e) { checks.push(Promise.resolve(e.code)); }
    try { dns.lookup("api.telegram.org", () => {}); }
    catch (e) { checks.push(Promise.resolve(e.code)); }
    Promise.all(checks).then(codes => {
      if (dispatched !== 0 || codes.some(code => !String(code).startsWith("EGRESS_"))) process.exit(2);
      process.exit(0);
    });
  `;
  const result = runChild(script);
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
