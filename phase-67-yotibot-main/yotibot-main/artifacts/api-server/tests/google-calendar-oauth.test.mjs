import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const compile = async file => (await transform(
  await readFile(new URL(file, import.meta.url), "utf8"),
  { loader: "ts", format: "cjs" },
)).code;
const originCode = await compile("../src/lib/billing-config.ts");
const calendarCode = await compile("../src/lib/mini-app-calendar.ts");
const routerCode = await compile("../src/routes/mini-app-calendar.ts");
const { calendarAuthorizationUrl } = await import("../public/calendar-oauth-link.js");
const publishedCallback = "https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback";
const obsoleteOrigin = `https://ah-sheli-telegram-bot.${["repl", "app"].join(".")}`;

function fixture(overrides = {}) {
  // No real credentials, network requests or database writes in these tests.
  const env = { NODE_ENV: "production", GOOGLE_CALENDAR_CLIENT_ID: "synthetic-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-secret", SESSION_SECRET: "synthetic-session", ...overrides };
  const origin = { exports: {} };
  vm.runInNewContext(originCode, { module: origin, exports: origin.exports, process: { env }, URL });
  const module = { exports: {} }, queries = [], exchanges = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    return { rows: sql.includes("RETURNING telegram_user_id") ? [{ telegram_user_id: "12345" }] : [] };
  } };
  vm.runInNewContext(calendarCode, {
    module, exports: module.exports, process: { env }, URL, URLSearchParams, Buffer, AbortSignal,
    require(name) {
      if (name === "node:crypto") return require(name);
      if (name === "@workspace/db") return { pool };
      if (name === "./billing-config") return origin.exports;
      if (name === "./mini-app-data") return { initializeMiniAppStorage: async () => {} };
      throw new Error(`Unexpected import ${name}`);
    },
    async fetch(url, options) {
      exchanges.push({ url, body: options.body });
      return { ok: true, json: async () => ({ access_token: "synthetic-token", expires_in: 3600 }) };
    },
  });
  return { ...module.exports, websiteOrigin: origin.exports.websiteOrigin, queries, exchanges };
}

test("production callback uses the verified public domain, never an obsolete or preview host", () => {
  const f = fixture({ REPLIT_DEV_DOMAIN: "preview.example" });
  assert.equal(f.googleCalendarCallbackUrl(), publishedCallback);
});

test("stale base URL and callback overrides cannot restore the old production domain", () => {
  const f = fixture({
    PUBLIC_APP_URL: obsoleteOrigin,
    GOOGLE_CALENDAR_REDIRECT_URI: `${obsoleteOrigin}/api/mini-app/calendar/callback`,
  });
  assert.equal(f.googleCalendarCallbackUrl(), publishedCallback);
});

test("unset runtime mode and a legacy preview override cannot generate a legacy callback", () => {
  for (const overrides of [
    { NODE_ENV: undefined },
    { NODE_ENV: "development", REPLIT_DEV_DOMAIN: "preview.replit.dev" },
  ]) {
    const f = fixture({ ...overrides,
      GOOGLE_CALENDAR_REDIRECT_URI: `${obsoleteOrigin}/api/mini-app/calendar/callback` });
    assert.equal(f.googleCalendarCallbackUrl(), publishedCallback);
  }
});

test("the actual connect router returns the canonical Google link accepted by the Mini App", async () => {
  const f = fixture({
    NODE_ENV: undefined,
    GOOGLE_CALENDAR_REDIRECT_URI: `${obsoleteOrigin}/api/mini-app/calendar/callback`,
  });
  const module = { exports: {} }, routes = new Map(), logs = [];
  const router = { get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); } };
  vm.runInNewContext(routerCode, { module, exports: module.exports, URL,
    require(name) {
      if (name === "express") return { Router: () => router };
      if (name === "../lib/mini-app-calendar") return f;
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const response = () => ({
    locals: { miniAppIdentity: { id: "12345" } }, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; },
  });
  const req = { log: { info: (...args) => logs.push(args), warn: () => {} } };
  const res = response();
  await routes.get("POST /connect")(req, res);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const link = calendarAuthorizationUrl(res.body.url, "https://yotibot-azbu.onrender.com");
  assert.equal(new URL(link).searchParams.get("redirect_uri"), publishedCallback);
  assert.equal(logs[0][0].redirectUri, publishedCallback);
  assert.ok(!JSON.stringify(logs).includes("state="));
  const config = response();
  module.exports.handleCalendarConfiguration(req, config);
  assert.equal(config.body.redirectUri, new URL(link).searchParams.get("redirect_uri"));
});

test("the Mini App refuses legacy, foreign or duplicate callbacks instead of opening them", () => {
  const link = redirect => `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(redirect)}`;
  const origin = "https://yotibot-azbu.onrender.com";
  assert.equal(calendarAuthorizationUrl(link(publishedCallback), origin), link(publishedCallback));
  for (const bad of [
    link(`${obsoleteOrigin}/api/mini-app/calendar/callback`),
    link("https://foreign.example/api/mini-app/calendar/callback"),
    `${link(publishedCallback)}&redirect_uri=${encodeURIComponent(publishedCallback)}`,
    link(publishedCallback).replace("accounts.google.com", "foreign.example"),
  ]) assert.throws(() => calendarAuthorizationUrl(bad, origin));
  const preview = "https://preview.replit.dev/api/mini-app/calendar/callback";
  assert.throws(() => calendarAuthorizationUrl(link(preview), "https://preview.replit.dev"));
});

test("preview advertises the canonical production origin and cannot create mismatched SQL state", async () => {
  const f = fixture({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "preview.example" });
  assert.equal(f.googleCalendarCallbackUrl(), publishedCallback);
  assert.equal(f.websiteOrigin(), "https://yotibot-azbu.onrender.com");
  await assert.rejects(f.calendarConnectUrl("12345"), /calendar_production_required/);
  assert.equal(f.queries.length, 0);
  assert.equal(fixture({ GOOGLE_CALENDAR_REDIRECT_URI: ` ${publishedCallback} ` }).googleCalendarCallbackUrl(),
    publishedCallback);
});

test("authorization and code exchange use exactly the same explicit redirect URI", async () => {
  const f = fixture({ GOOGLE_CALENDAR_REDIRECT_URI: publishedCallback,
    PUBLIC_APP_URL: "https://another-site.example" });
  const authorization = new URL(await f.calendarConnectUrl("12345"));
  assert.equal(authorization.searchParams.get("redirect_uri"), publishedCallback);
  assert.equal(authorization.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events.readonly");
  assert.equal(authorization.searchParams.get("state").length, 43);
  await f.calendarOAuthCallback(authorization.searchParams.get("state"), "synthetic-code");
  assert.equal(f.exchanges[0].body.get("redirect_uri"), publishedCallback);
  assert.equal(f.exchanges[0].body.get("grant_type"), "authorization_code");
  assert.ok(f.queries.some(query => query.sql.includes("INSERT INTO ah_sheli_google_calendar")
    && query.params[0] === "12345"));
});

test("environment values cannot alter the fixed callback, even with unsafe or malformed values", async () => {
  for (const uri of [
    publishedCallback.replace("https:", "http:"),
    `${publishedCallback}/`, `${publishedCallback}?x=1`, `${publishedCallback}#fragment`,
    publishedCallback.replace("https://", "https://user:password@"),
  ]) {
    const f = fixture({ GOOGLE_CALENDAR_REDIRECT_URI: uri });
    assert.equal(f.googleCalendarCallbackUrl(), publishedCallback);
    assert.equal(new URL(await f.calendarConnectUrl("12345")).searchParams.get("redirect_uri"), publishedCallback);
  }
});

test("invalid callback state never exchanges tokens or stores credentials", async () => {
  const f = fixture();
  await assert.rejects(f.calendarOAuthCallback("invalid-state", "synthetic-code"));
  assert.equal(f.exchanges.length, 0);
  assert.equal(f.queries.length, 0);
});
