import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/app.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../public/mini-app-navigation.js", import.meta.url), "utf8");

test("active tasks vanish immediately after completion or deletion; history is retained", () => {
  const element = () => ({
    children: [], dataset: {}, classList: { toggle() {} },
    set innerHTML(value) { this.html = value; this.children = []; },
    get innerHTML() { return this.html; },
    append(child) { this.children.push(child); },
  });
  const switcher = element(), content = element();
  const open = { id: "open", text: "OPEN_TASK", checked: false };
  const done = { id: "done", text: "DONE_TASK", checked: true };
  const state = { taskList: "משימות", taskFilter: "active", data: {
    lists: [{ name: "משימות", items: [open, done] }],
    tasks: [{ ...open, listName: "משימות" }],
  } };
  const context = vm.createContext({
    state, taskLists: () => state.data.lists, safe: String,
    $: selector => selector === "#tasks-content" ? content : switcher,
    $$: () => switcher.children,
    document: { createElement: element }, glyphs: { check: "CHECK", undo: "UNDO", edit: "", trash: "" },
  });
  vm.runInContext(script.slice(script.indexOf("function renderTasks()"),
    script.indexOf("function renderCalendar()")), context);
  vm.runInContext("renderTasks()", context);
  assert.equal(content.children.length, 1);
  assert.match(content.children[0].innerHTML, /OPEN_TASK/);
  assert.doesNotMatch(content.children[0].innerHTML, /DONE_TASK/);
  open.checked = true;
  state.data.tasks = [];
  vm.runInContext("renderTasks()", context);
  assert.equal(content.children.length, 0);
  assert.match(content.innerHTML, /אין משימות פתוחות/);
  state.taskFilter = "history";
  vm.runInContext("renderTasks()", context);
  assert.equal(content.children.length, 2);
  assert.equal(state.data.lists[0].items.length, 2);
  state.taskFilter = "active";
  state.data.lists[0].items = [done];
  vm.runInContext("renderTasks()", context);
  assert.equal(content.children.length, 0);
});

test("brand is an external website link with a native new-tab fallback", () => {
  const brand = html.match(/<a\b[^>]*class="brand"[^>]*>/)?.[0];
  assert.ok(brand);
  assert.match(brand, /href="index\.html\?onboarding=1"/);
  assert.match(brand, /target="_blank"/);
  assert.match(brand, /rel="noopener noreferrer"/);
  assert.doesNotMatch(brand, /data-tab=|disabled/);
  assert.ok(html.indexOf('src="mini-app-navigation.js"') < html.indexOf('src="app.js"'));
  assert.doesNotMatch(script, /\.brand\[data-tab\]/);
});

test("logo opens the website through Telegram without leaking launch proof or changing the Mini App", () => {
  for (const current of [
    'https://example.test/app.html',
    'https://example.test/app.html?tgWebAppPlatform=ios#tgWebAppData=test-proof&tgWebAppVersion=8.0',
    'https://example.test/nested/app.html?startapp=abc#tgWebAppData=test-proof',
  ]) {
    let click;
    const opened = [];
    const brand = { href: 'app.html', addEventListener: (event, handler) => {
      assert.equal(event, 'click');
      click = handler;
    } };
    const url = new URL(current);
    const location = { href: url.href };
    vm.runInNewContext(navigation, {
      URL,
      document: { querySelector: selector => { assert.equal(selector, 'a.brand'); return brand; } },
      window: { location, AhSheliMiniApp: { active: true }, Telegram: { WebApp: { openLink: href => opened.push(href) } } },
    });
    const destination = new URL('index.html?onboarding=1', current).href;
    assert.equal(brand.href, destination);
    let prevented = false;
    click({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(opened, [destination]);
    assert.equal(location.href, current);
    assert.doesNotMatch(brand.href, /tgWebApp|test-proof|startapp|#/);
  }
});

test("missing or failing Telegram SDK leaves the native external link unblocked", () => {
  for (const Telegram of [undefined, { WebApp: {} }, { WebApp: { openLink: () => { throw new Error('SDK unavailable'); } } }]) {
    let click;
    const brand = { addEventListener: (_, handler) => { click = handler; } };
    vm.runInNewContext(navigation, {
      URL, document: { querySelector: () => brand },
      window: { location: { href: 'https://example.test/app.html' }, AhSheliMiniApp: { active: true }, Telegram },
    });
    let prevented = false;
    click({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false, 'native new-tab navigation must remain available');
    assert.equal(brand.href, 'https://example.test/index.html?onboarding=1');
  }
});

test("five tabs keep their existing in-place navigation unchanged", () => {
  const binding = script.match(/\$\$\('\.nav-item'\)\.forEach\(\(button\)=>button\.addEventListener[\s\S]*?^}\)\);/m)?.[0];
  assert.ok(binding, "use the existing client-side tab handlers");
  const handlers = [];
  const switches = [];
  const controls = ["profile", "lists", "calendar", "reminders", "tasks"].map(tab => ({
    dataset: { tab },
    addEventListener(event, handler) {
      assert.equal(event, "click");
      handlers.push(handler);
    },
  }));
  // No location/history object is provided: document-navigation code would fail.
  vm.runInNewContext(binding, { $$: () => controls, switchTab: tab => switches.push(tab) });
  handlers.forEach(handler => {
    let prevented = false;
    handler({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  });
  assert.deepEqual(switches, controls.map(control => control.dataset.tab));
});
