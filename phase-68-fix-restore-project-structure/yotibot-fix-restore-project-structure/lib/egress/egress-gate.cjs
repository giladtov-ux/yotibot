"use strict";

const dns = require("node:dns");
const dgram = require("node:dgram");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const http2 = require("node:http2");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");
const { syncBuiltinESMExports } = require("node:module");
const { fileURLToPath } = require("node:url");
const workerThreads = require("node:worker_threads");

const GATE_SYMBOL = Symbol.for("ah-sheli.egress-gate");
const HOOKS_SYMBOL = Symbol.for("ah-sheli.egress-hooks-installed");
const SIGNAL_SYMBOL = Symbol.for("ah-sheli.egress-kill-signal-installed");
const WORKER_SIGNAL_SYMBOL = Symbol.for("ah-sheli.egress-worker-kill-signal-installed");

class EgressDeniedError extends Error {
  constructor(code = "EGRESS_DENIED") {
    super("Outbound network request blocked by the egress safety gate.");
    this.name = "EgressDeniedError";
    this.code = code;
  }
}

class EgressConfigurationError extends Error {
  constructor() {
    super("Egress authorization is missing, invalid, or not approved.");
    this.name = "EgressConfigurationError";
    this.code = "EGRESS_CONFIGURATION_INVALID";
  }
}

function normalizeHost(value) {
  let host = String(value ?? "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host.replace(/\.$/u, "");
}

function parseAllowedTarget(value) {
  const entry = String(value ?? "").trim();
  const ipv6 = entry.match(/^\[([0-9a-f:.]+)\]:(\d{1,5})$/iu);
  const hostname = entry.match(/^([a-z0-9.-]+):(\d{1,5})$/iu);
  const match = ipv6 ?? hostname;
  if (!match || entry.includes("*")) throw new EgressConfigurationError();

  const host = normalizeHost(match[1]);
  const port = Number(match[2]);
  const ipVersion = net.isIP(host);
  const validHostname = host.length <= 253
    && host.split(".").every(label => label.length > 0 && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
  if (port < 1 || port > 65_535 || (!ipVersion && !validHostname)) {
    throw new EgressConfigurationError();
  }
  return { host, port, key: targetKey(host, port) };
}

function parseBrowserOrigins(value, allowedTargets) {
  const raw = String(value ?? "").trim();
  if (!raw) return Object.freeze([]);
  const entries = raw.split(",");
  if (entries.some(entry => !entry.trim())) throw new EgressConfigurationError();
  const origins = entries.map(entry => {
    let url;
    try { url = new URL(entry.trim()); } catch { throw new EgressConfigurationError(); }
    if (!["https:", "wss:", "http:", "ws:"].includes(url.protocol)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new EgressConfigurationError();
    }
    const host = normalizeHost(url.hostname);
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    if (!secure && !isLoopbackHost(host)) throw new EgressConfigurationError();
    const port = Number(url.port || (secure ? 443 : 80));
    if (!allowedTargets.has(targetKey(host, port))) throw new EgressConfigurationError();
    return `${url.protocol}//${url.host}`;
  });
  return Object.freeze([...new Set(origins)].sort());
}

function targetKey(host, port) {
  return `${host.includes(":") ? `[${host}]` : host}:${Number(port)}`;
}

function createEgressPolicy(env = {}) {
  const approval = env.EGRESS_APPROVED;
  if (approval === undefined || approval === "" || approval === "0") {
    return Object.freeze({
      approved: false,
      environment: String(env.NODE_ENV ?? ""),
      approvalRef: "",
      approvedBy: "",
      targets: Object.freeze([]),
    });
  }
  if (approval !== "1") throw new EgressConfigurationError();

  const environment = String(env.NODE_ENV ?? "").trim();
  const approvalEnvironment = String(env.EGRESS_APPROVAL_ENV ?? "").trim();
  const approvalRef = String(env.EGRESS_APPROVAL_REF ?? "").trim();
  const approvedBy = String(env.EGRESS_APPROVED_BY ?? "").trim();
  if (!environment || approvalEnvironment !== environment
    || !/^[a-z0-9][a-z0-9._:-]{2,79}$/iu.test(approvalRef)
    || !/^[a-z0-9][a-z0-9._@ -]{1,99}$/iu.test(approvedBy)) {
    throw new EgressConfigurationError();
  }

  const rawTargets = String(env.EGRESS_ALLOWED_TARGETS ?? "").split(",");
  if (rawTargets.length === 0 || rawTargets.some(item => !item.trim())) {
    throw new EgressConfigurationError();
  }
  const targets = rawTargets.map(parseAllowedTarget);
  const keys = [...new Set(targets.map(target => target.key))].sort();
  if (keys.length === 0) throw new EgressConfigurationError();
  const targetSet = new Set(keys);
  return Object.freeze({
    approved: true,
    environment,
    approvalRef,
    approvedBy,
    targets: Object.freeze(keys),
    browserOrigins: parseBrowserOrigins(env.EGRESS_BROWSER_ALLOWED_ORIGINS, targetSet),
  });
}

function isLoopbackHost(value) {
  const host = normalizeHost(value);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return Number(host.split(".")[0]) === 127;
  return ipVersion === 6 && /^::ffff:127\./iu.test(host);
}

function normalizeTarget(target, defaultProtocol = "https:") {
  if (target instanceof URL || typeof target === "string") {
    let url;
    try {
      url = target instanceof URL ? target : new URL(target);
    } catch {
      throw new EgressDeniedError("EGRESS_TARGET_INVALID");
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
      throw new EgressDeniedError("EGRESS_TARGET_INVALID");
    }
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    const port = Number(url.port || (secure ? 443 : 80));
    return { host: normalizeHost(url.hostname), port };
  }
  if (!target || typeof target !== "object") {
    throw new EgressDeniedError("EGRESS_TARGET_INVALID");
  }
  if (target.path && !target.host && !target.hostname) {
    throw new EgressDeniedError("EGRESS_UNIX_SOCKET_BLOCKED");
  }
  const protocol = target.protocol || defaultProtocol;
  if (!["http:", "https:", "ws:", "wss:"].includes(protocol)) {
    throw new EgressDeniedError("EGRESS_TARGET_INVALID");
  }
  const host = normalizeHost(target.hostname || target.host || "localhost");
  const secure = protocol === "https:" || protocol === "wss:";
  const port = Number(target.port || (secure ? 443 : 80));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new EgressDeniedError("EGRESS_TARGET_INVALID");
  }
  return { host, port };
}

class EgressGate {
  constructor(policy) {
    this.policy = policy;
    this.allowedTargets = new Set(policy.targets);
    this.tripped = false;
    this.activeResources = new Set();
    this.children = new Set();
    this.workers = new Set();
    this.tripListeners = new Set();
  }

  assertStartupAuthorized() {
    if (!this.policy.approved) throw new EgressConfigurationError();
  }

  authorize(target) {
    if (!this.policy.approved) throw new EgressDeniedError("EGRESS_AUTHORIZATION_REQUIRED");
    if (this.tripped) throw new EgressDeniedError("EGRESS_KILL_SWITCH_ACTIVE");
    const normalized = normalizeTarget(target);
    if (isLoopbackHost(normalized.host)) return { ...normalized, external: false };
    const key = targetKey(normalized.host, normalized.port);
    if (!this.allowedTargets.has(key)) {
      throw new EgressDeniedError("EGRESS_TARGET_NOT_ALLOWLISTED");
    }
    return { ...normalized, external: true };
  }

  authorizeDns(hostValue) {
    if (!this.policy.approved) throw new EgressDeniedError("EGRESS_AUTHORIZATION_REQUIRED");
    if (this.tripped) throw new EgressDeniedError("EGRESS_KILL_SWITCH_ACTIVE");
    const host = normalizeHost(hostValue);
    if (!host) throw new EgressDeniedError("EGRESS_TARGET_INVALID");
    if (isLoopbackHost(host)) return true;
    if (![...this.allowedTargets].some(key => key.startsWith(`${host}:`) || key.startsWith(`[${host}]:`))) {
      throw new EgressDeniedError("EGRESS_TARGET_NOT_ALLOWLISTED");
    }
    return true;
  }

  assertCanSpawnGuardedEntry() {
    if (!this.policy.approved) throw new EgressDeniedError("EGRESS_AUTHORIZATION_REQUIRED");
    if (this.tripped) throw new EgressDeniedError("EGRESS_KILL_SWITCH_ACTIVE");
  }

  track(target, resource) {
    this.authorize(target);
    if (!resource) return () => {};
    this.activeResources.add(resource);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeResources.delete(resource);
    };
  }

  registerChild(child) {
    if (!child || typeof child.kill !== "function") {
      throw new TypeError("An egress-managed child process is required.");
    }
    this.children.add(child);
    const release = () => this.children.delete(child);
    child.once?.("exit", release);
    if (this.tripped) {
      try { child.kill("SIGUSR2"); } catch { /* The child may already have exited. */ }
    }
    return release;
  }

  registerWorker(worker) {
    this.workers.add(worker);
    const release = () => this.workers.delete(worker);
    worker.once?.("exit", release);
    if (this.tripped) void worker.terminate().catch(() => {});
    return release;
  }

  onTrip(listener) {
    if (typeof listener !== "function") throw new TypeError("A kill-switch listener is required.");
    if (this.tripped) {
      listener();
      return () => {};
    }
    this.tripListeners.add(listener);
    return () => this.tripListeners.delete(listener);
  }

  trip() {
    if (this.tripped) return 0;
    this.tripped = true;
    const resources = [...this.activeResources];
    this.activeResources.clear();
    for (const resource of resources) {
      try {
        if (typeof resource.abort === "function") resource.abort();
        else if (typeof resource.destroy === "function") resource.destroy();
        else if (typeof resource.close === "function") resource.close();
      } catch { /* Continue tripping the remaining outbound resources. */ }
    }
    for (const child of [...this.children]) {
      try { child.kill("SIGUSR2"); } catch { /* Continue tripping remaining children. */ }
    }
    for (const worker of [...this.workers]) {
      try { worker.postMessage({ type: "AH_SHELI_EGRESS_KILL_SWITCH" }); } catch { /* Continue tripping workers. */ }
      try { void worker.terminate().catch(() => {}); } catch { /* Continue tripping remaining workers. */ }
    }
    for (const listener of [...this.tripListeners]) {
      try { listener(); } catch { /* The egress latch stays tripped if shutdown cleanup fails. */ }
    }
    this.tripListeners.clear();
    return resources.length;
  }

  status() {
    return Object.freeze({
      approved: this.policy.approved,
      tripped: this.tripped,
      activeRequests: this.activeResources.size,
      targetCount: this.allowedTargets.size,
    });
  }
}

function createGatedFetch(gate, dispatch) {
  if (typeof dispatch !== "function") throw new TypeError("A fetch transport is required.");
  return function gatedFetch(input, init = {}) {
    let target;
    try {
      const requestUrl = typeof Request !== "undefined" && input instanceof Request ? input.url : input;
      target = normalizeTarget(requestUrl);
      gate.authorize(target);
    } catch (error) {
      return Promise.reject(error);
    }

    const controller = new AbortController();
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    let release;
    try {
      release = gate.track(target, controller);
    } catch (error) {
      return Promise.reject(error);
    }

    return Promise.resolve().then(() => {
      // Recheck immediately before dispatch; a concurrent trip cancels queued work.
      gate.authorize(target);
      return dispatch(input, { ...init, signal });
    }).finally(release);
  };
}

function requestTarget(args, protocol) {
  const first = args[0];
  const second = args[1];
  if (first instanceof URL || typeof first === "string") {
    try {
      const url = new URL(first);
      return normalizeTarget(url, protocol);
    } catch {
      if (typeof second === "object" && second) {
        return normalizeTarget({ ...second, protocol: second.protocol || protocol }, protocol);
      }
      throw new EgressDeniedError("EGRESS_TARGET_INVALID");
    }
  }
  if (typeof first === "number") {
    const options = typeof second === "object" && second ? second : {};
    return normalizeTarget({ ...options, port: first, protocol: options.protocol || protocol }, protocol);
  }
  return normalizeTarget({ ...(first || {}), protocol: first?.protocol || protocol }, protocol);
}

function socketTarget(args) {
  const first = args[0];
  if (Array.isArray(first)) return socketTarget(first);
  if (first && typeof first === "object") {
    if (first.path && !first.host && !first.hostname) {
      throw new EgressDeniedError("EGRESS_UNIX_SOCKET_BLOCKED");
    }
    if (!first.port) throw new EgressDeniedError("EGRESS_TARGET_INVALID");
    return normalizeTarget(first);
  }
  if (typeof first === "number") {
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    return normalizeTarget({ host, port: first });
  }
  throw new EgressDeniedError("EGRESS_TARGET_INVALID");
}

function patchHttpModule(module, protocol, gate) {
  const original = module.request;
  module.request = function guardedRequest(...args) {
    const target = requestTarget(args, protocol);
    gate.authorize(target);
    const request = original.apply(this, args);
    const release = gate.track(target, request);
    request.once("close", release);
    request.once("error", release);
    return request;
  };
}

function patchDnsMethod(object, method, gate) {
  const original = object?.[method];
  if (typeof original !== "function") return;
  object[method] = function guardedDnsLookup(host, ...args) {
    gate.authorizeDns(host);
    return original.call(this, host, ...args);
  };
}

function findWorkspaceRoot() {
  const entryDir = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    entryDir,
    path.resolve(entryDir, "../.."),
  ];
  return candidates.find(root =>
    fs.existsSync(path.join(root, "index.js"))
    && fs.existsSync(path.join(root, "artifacts/ah-sheli-bot/index.js"))
    && fs.existsSync(path.join(root, "lib/egress/bootstrap.cjs")));
}

function isGuardedChild(command, args, options = {}) {
  if (options.shell === true || path.resolve(String(command)) !== path.resolve(process.execPath)) return false;
  const values = Array.isArray(args) ? args.map(String) : [];
  const root = findWorkspaceRoot();
  if (!root) return false;
  const requestedCwd = options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd || process.cwd();
  const cwd = path.resolve(requestedCwd);
  const resolved = value => path.resolve(cwd, value);
  if (values.length === 1 && resolved(values[0]) === path.join(root, "index.js")) return true;
  const hasBootstrap = values[0] === "--require"
    && resolved(values[1]) === path.join(root, "lib/egress/bootstrap.cjs");
  if (hasBootstrap && values.length === 3
    && resolved(values[2]) === path.join(root, "artifacts/ah-sheli-bot/index.js")) return true;
  return values.length === 4
    && values[0] === "--enable-source-maps"
    && values[1] === "--require"
    && resolved(values[2]) === path.join(root, "lib/egress/bootstrap.cjs")
    && resolved(values[3]) === path.join(root, "artifacts/api-server/dist/index.mjs");
}

function patchChildProcess(gate) {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function guardedSpawn(command, args, options) {
    if (!isGuardedChild(command, args, options)) {
      throw new EgressDeniedError("EGRESS_CHILD_PROCESS_BLOCKED");
    }
    gate.assertCanSpawnGuardedEntry();
    return originalSpawn.call(this, command, args, options);
  };

  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function guardedSpawnSync(command, args, options) {
    if (!isGuardedChild(command, args, options)) {
      throw new EgressDeniedError("EGRESS_CHILD_PROCESS_BLOCKED");
    }
    gate.assertCanSpawnGuardedEntry();
    return originalSpawnSync.call(this, command, args, options);
  };

  for (const method of ["exec", "execSync", "execFile", "execFileSync", "fork"]) {
    if (typeof childProcess[method] !== "function") continue;
    childProcess[method] = function blockedChildProcessMethod() {
      throw new EgressDeniedError("EGRESS_CHILD_PROCESS_BLOCKED");
    };
  }
}

function patchWorkerThreads(gate) {
  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class GuardedWorker extends OriginalWorker {
    constructor(filename, options = {}) {
      gate.assertCanSpawnGuardedEntry();
      const root = findWorkspaceRoot();
      if (!root) throw new EgressDeniedError("EGRESS_CHILD_PROCESS_BLOCKED");
      const bootstrap = path.join(root, "lib/egress/bootstrap.cjs");
      const execArgv = [...(options.execArgv ?? process.execArgv)];
      const preloaded = execArgv.some((argument, index) =>
        argument === "--require"
        && execArgv[index + 1]
        && path.resolve(process.cwd(), execArgv[index + 1]) === bootstrap);
      if (!preloaded) execArgv.push("--require", bootstrap);
      super(filename, { ...options, execArgv });
      gate.registerWorker(this);
    }
  };
}

function lockGuardedMethod(target, method) {
  const descriptor = Object.getOwnPropertyDescriptor(target, method);
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new EgressConfigurationError();
  }
  Object.defineProperty(target, method, {
    ...descriptor,
    writable: false,
    configurable: false,
  });
}

function installNetworkGuards(gate) {
  if (globalThis[HOOKS_SYMBOL]) {
    throw new Error("Egress network guards are already installed in this process.");
  }

  if (typeof globalThis.fetch === "function") {
    globalThis.fetch = createGatedFetch(gate, globalThis.fetch.bind(globalThis));
  }

  patchHttpModule(http, "http:", gate);
  patchHttpModule(https, "https:", gate);

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const target = socketTarget(args);
    gate.authorize(target);
    const release = gate.track(target, this);
    this.once("close", release);
    try {
      return originalConnect.apply(this, args);
    } catch (error) {
      release();
      throw error;
    }
  };

  const originalTlsConnect = tls.connect;
  tls.connect = function guardedTlsConnect(...args) {
    const first = args[0];
    const options = typeof first === "object" && first ? first : {};
    const target = normalizeTarget({
      ...options,
      host: options.host || options.hostname || "localhost",
      port: options.port,
      protocol: "https:",
    });
    gate.authorize(target);
    return originalTlsConnect.apply(this, args);
  };

  const originalHttp2Connect = http2.connect;
  http2.connect = function guardedHttp2Connect(authority, ...args) {
    gate.authorize(normalizeTarget(authority));
    return originalHttp2Connect.call(this, authority, ...args);
  };

  for (const method of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny",
    "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr",
    "resolveSoa", "resolveSrv", "resolveTxt"]) {
    patchDnsMethod(dns, method, gate);
    patchDnsMethod(dns.promises, method, gate);
    patchDnsMethod(dns.Resolver?.prototype, method, gate);
  }
  if (typeof dns.lookupService === "function") {
    const originalLookupService = dns.lookupService;
    dns.lookupService = function guardedLookupService(address, port, ...args) {
      if (!isLoopbackHost(address)) throw new EgressDeniedError("EGRESS_DNS_REVERSE_LOOKUP_BLOCKED");
      gate.authorize({ host: address, port });
      return originalLookupService.call(this, address, port, ...args);
    };
  }

  if (typeof dgram.Socket?.prototype?.send === "function") {
    dgram.Socket.prototype.send = function blockedDatagramSend() {
      throw new EgressDeniedError("EGRESS_UDP_BLOCKED");
    };
  }

  patchChildProcess(gate);
  patchWorkerThreads(gate);

  if (typeof globalThis.WebSocket === "function") {
    const OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class GuardedWebSocket extends OriginalWebSocket {
      constructor(url, protocols) {
        const target = normalizeTarget(url);
        gate.authorize(target);
        super(url, protocols);
        const release = gate.track(target, this);
        this.addEventListener("close", release, { once: true });
      }
    };
  }

  syncBuiltinESMExports();
  for (const [target, method] of [
    [globalThis, "fetch"],
    [globalThis, "WebSocket"],
    [http, "request"],
    [https, "request"],
    [net.Socket.prototype, "connect"],
    [tls, "connect"],
    [http2, "connect"],
    [dns, "lookup"],
    [dns, "resolve"],
    [dns, "resolve4"],
    [dns, "resolve6"],
    [dns, "resolveAny"],
    [dns, "resolveCname"],
    [dns, "resolveMx"],
    [dns, "resolveNaptr"],
    [dns, "resolveNs"],
    [dns, "resolvePtr"],
    [dns, "resolveSoa"],
    [dns, "resolveSrv"],
    [dns, "resolveTxt"],
    [dns.promises, "lookup"],
    [dns.promises, "resolve"],
    [dns.promises, "resolve4"],
    [dns.promises, "resolve6"],
    [dns.promises, "resolveAny"],
    [dns.promises, "resolveCname"],
    [dns.promises, "resolveMx"],
    [dns.promises, "resolveNaptr"],
    [dns.promises, "resolveNs"],
    [dns.promises, "resolvePtr"],
    [dns.promises, "resolveSoa"],
    [dns.promises, "resolveSrv"],
    [dns.promises, "resolveTxt"],
    [dns.Resolver?.prototype, "lookup"],
    [dns.Resolver?.prototype, "resolve"],
    [dns.Resolver?.prototype, "resolve4"],
    [dns.Resolver?.prototype, "resolve6"],
    [dns.Resolver?.prototype, "resolveAny"],
    [dns.Resolver?.prototype, "resolveCname"],
    [dns.Resolver?.prototype, "resolveMx"],
    [dns.Resolver?.prototype, "resolveNaptr"],
    [dns.Resolver?.prototype, "resolveNs"],
    [dns.Resolver?.prototype, "resolvePtr"],
    [dns.Resolver?.prototype, "resolveSoa"],
    [dns.Resolver?.prototype, "resolveSrv"],
    [dns.Resolver?.prototype, "resolveTxt"],
    [dns, "lookupService"],
    [dgram.Socket.prototype, "send"],
    [childProcess, "spawn"],
    [childProcess, "spawnSync"],
    [childProcess, "exec"],
    [childProcess, "execSync"],
    [childProcess, "execFile"],
    [childProcess, "execFileSync"],
    [childProcess, "fork"],
    [workerThreads, "Worker"],
  ]) {
    if (target && Object.getOwnPropertyDescriptor(target, method)?.value) {
      lockGuardedMethod(target, method);
    }
  }
  Object.defineProperty(globalThis, HOOKS_SYMBOL, { value: true });
}

function installProcessEgressGuard(env = process.env) {
  const existing = globalThis[GATE_SYMBOL];
  if (existing) {
    const candidate = createEgressPolicy(env);
    if (JSON.stringify(candidate) !== JSON.stringify(existing.policy)) {
      throw new EgressConfigurationError();
    }
    existing.assertStartupAuthorized();
    return existing;
  }

  let policy;
  let invalid = false;
  try {
    policy = createEgressPolicy(env);
  } catch {
    invalid = true;
    policy = Object.freeze({
      approved: false,
      environment: String(env.NODE_ENV ?? ""),
      approvalRef: "",
      approvedBy: "",
      targets: Object.freeze([]),
    });
  }
  const gate = new EgressGate(policy);
  Object.defineProperty(globalThis, GATE_SYMBOL, { value: gate });
  installNetworkGuards(gate);

  if (workerThreads.isMainThread && !globalThis[SIGNAL_SYMBOL]) {
    process.on("SIGUSR2", () => {
      const stopped = gate.trip();
      console.error(`[egress] emergency kill-switch engaged; terminated ${stopped} outbound request(s).`);
    });
    Object.defineProperty(globalThis, SIGNAL_SYMBOL, { value: true });
  } else if (!workerThreads.isMainThread && workerThreads.parentPort && !globalThis[WORKER_SIGNAL_SYMBOL]) {
    workerThreads.parentPort.on("message", message => {
      if (message?.type === "AH_SHELI_EGRESS_KILL_SWITCH") gate.trip();
    });
    Object.defineProperty(globalThis, WORKER_SIGNAL_SYMBOL, { value: true });
  }

  if (invalid) throw new EgressConfigurationError();
  gate.assertStartupAuthorized();
  return gate;
}

function getProcessEgressGate() {
  return globalThis[GATE_SYMBOL];
}

module.exports = {
  EgressConfigurationError,
  EgressDeniedError,
  EgressGate,
  createEgressPolicy,
  createEgressGate: policy => new EgressGate(policy),
  browserConnectSource: policy => `connect-src 'self'${(policy?.browserOrigins ?? []).length
    ? ` ${(policy.browserOrigins).join(" ")}` : ""}`,
  createGatedFetch,
  installNetworkGuards,
  installProcessEgressGuard,
  getProcessEgressGate,
};
