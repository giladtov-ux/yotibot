import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { miniAppMenuUpdate } from "../src/telegram-mini-app.js";

const bridge = readFileSync(new URL("../../api-server/public/telegram-mini-app.js", import.meta.url), "utf8");
function run(app) {
  const calls = [];
  const callbacks = {};
  const properties = {};
  const context = {
    URL,
    window: {
      Telegram: app ? { WebApp: app } : undefined,
      location: { assign: url => calls.push(["navigate", url]) },
    },
    document: {
      documentElement: { classList: { add: name => calls.push(["class", name]) },
        style: { setProperty: (key, value) => { properties[key] = value; } } },
      getElementById: () => null,
      addEventListener: (name, handler) => { callbacks[name] = handler; },
    },
  };
  vm.runInNewContext(bridge, context);
  return { api: context.window.AhSheliMiniApp, calls, callbacks, properties };
}
test("menu opens management directly, without changing bot command scopes", () => {
  const menu = miniAppMenuUpdate();
  assert.equal(menu.menu_button.type, "web_app");
  assert.equal(menu.menu_button.text, "🟡");
  const url = new URL(menu.menu_button.web_app.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/app.html");
  assert.equal(url.search, "");
  assert.equal(menu.chat_id, undefined);
});
test("native Mini App action button uses brand yellow without changing visibility or navigation", () => {
  const colors = [];
  const result = run({
    platform: "ios", initData: "proof",
    MainButton: { setParams: params => colors.push(JSON.parse(JSON.stringify(params))) },
    ready() {}, expand() {}, onEvent() {},
  });
  assert.equal(result.api.active, true);
  assert.deepEqual(colors, [{ color: "#FFD000", text_color: "#080808" }]);
  assert.deepEqual(result.calls, [["class", "telegram-mini-app"]]);
});
const launcher = readFileSync(new URL("../../api-server/public/launch-mini-app.js", import.meta.url), "utf8");
function launch(search = "", hash = "", active = false) {
  const calls = [];
  vm.runInNewContext(launcher, { URL, URLSearchParams, window: {
    AhSheliMiniApp: { active },
    location: { search, hash, href: `https://example.com/${search}${hash}`, replace: url => calls.push(url) },
  } });
  return calls;
}
test("legacy native root entry redirects before SDK loading and preserves Telegram data", () => {
  const hash = "#tgWebAppData=test-proof&tgWebAppPlatform=ios";
  assert.deepEqual(launch("", hash), [`https://example.com/app.html${hash}`]);
  assert.deepEqual(launch("?tgWebAppPlatform=android", "#demo"),
    ["https://example.com/app.html?tgWebAppPlatform=android#demo"]);
});
test("ordinary marketing and explicit registration do not redirect to management", () => {
  assert.deepEqual(launch("", "#demo"), []);
  assert.deepEqual(launch("?onboarding=1", "#tgWebAppPlatform=ios", true), []);
});
test("browser and SDK-download failure keep ordinary navigation", () => {
  for (const app of [undefined, { platform: "unknown", initData: "" }]) {
    const result = run(app);
    assert.equal(result.api.active, false);
    assert.equal(result.api.openExternal("https://whop.com/checkout/example"), false);
    assert.deepEqual(result.calls, [["navigate", "https://whop.com/checkout/example"]]);
  }
});
test("native SDK receives ready, expansion and links without replacing the Mini App", () => {
  const events = {};
  const actions = [];
  const app = {
    platform: "ios", initData: "not-used-as-authentication",
    viewportHeight: 650, safeAreaInset: { bottom: 20 },
    ready: () => actions.push("ready"), expand: () => actions.push("expand"),
    onEvent: (name, callback) => { events[name] = callback; },
    openLink: url => actions.push(url),
    openTelegramLink: url => actions.push(url),
  };
  const result = run(app);
  assert.equal(result.api.active, true);
  assert.deepEqual(actions, ["expand", "ready"]);
  assert.equal(result.properties["--mini-app-height"], "650px");
  assert.equal(result.properties["--mini-safe-bottom"], "20px");
  app.viewportHeight = 410;
  events.viewportChanged();
  assert.equal(result.properties["--mini-app-height"], "410px");
  assert.equal(result.api.openExternal("https://whop.com/checkout/example"), true);
  assert.equal(result.api.openExternal("https://t.me/example_bot"), true);
  assert.equal(result.calls.filter(([action]) => action === "navigate").length, 0);
});
test("blocked protocols, credential URLs and lookalike hosts never navigate", () => {
  const result = run();
  for (const url of ["http://whop.com", "javascript:alert(1)", "https://whop.com.evil.test",
    "https://evil-whop.com", "https://user:password@whop.com"]) {
    assert.throws(() => result.api.openExternal(url));
  }
  assert.equal(result.calls.length, 0);
});
test("older native clients fall back when openLink is unavailable or fails", () => {
  const result = run({ platform: "android", ready() {}, expand() {},
    openLink() { throw new Error("unsupported"); } });
  assert.equal(result.api.openExternal("https://whop.com/checkout/example"), false);
  assert.deepEqual(result.calls.at(-1), ["navigate", "https://whop.com/checkout/example"]);
});
