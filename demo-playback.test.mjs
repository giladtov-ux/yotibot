import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Run the shipped inline script with deterministic timers and a small DOM.
// This covers timer/interaction behavior without network or Telegram calls.
function createDemo({ reducedMotion = false, hash = "#demo" } = {}) {
  let now = 0;
  let nextTimer = 0;
  let peakTimers = 0;
  const timers = new Map();
  const nodes = {};
  const events = {};
  function element(id = "") {
    const classes = new Set();
    const listeners = {};
    return {
      id, hidden: false, disabled: false, textContent: "", value: "",
      children: [], attributes: {}, scrollTop: 0,
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { listeners[name] = handler; },
      emit(name, event = {}) { listeners[name]?.(event); },
      focus() { this.focused = true; document.activeElement = this; this.emit("focus"); },
      scrollIntoView() {},
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
    };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes[id] = element(id);
  for (const id of ["demo-request", "demo-reply", "demo-reminder-popup"]) nodes[id].hidden = true;
  const doneButton = element();
  doneButton.textContent = "בוצע";
  doneButton.closest = () => nodes["demo-reminder-popup"];
  const deleteButton = element();
  deleteButton.closest = () => nodes["demo-reminder-popup"];
  nodes["demo-reminder-popup"].querySelector = () => doneButton;
  nodes["demo-reminder-popup"].querySelectorAll = () => [doneButton, deleteButton];
  const document = {
    hidden: false,
    activeElement: null,
    getElementById: id => nodes[id],
    querySelectorAll: () => ["demo", "features", "pricing"].map(id => nodes["btn-" + id]),
    createElement: () => element(),
    addEventListener(name, handler) { events[name] = handler; },
  };
  const motion = {
    matches: reducedMotion,
    addEventListener(name, handler) { this[name] = handler; },
  };
  const window = {
    location: { hash },
    history: { replaceState(_state, _title, hash) { window.location.hash = hash; } },
    matchMedia: () => motion,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      peakTimers = Math.max(peakTimers, timers.size);
      return id;
    },
    clearTimeout: id => timers.delete(id),
  };
  const context = vm.createContext({ document, window, Date: { now: () => now } });
  vm.runInContext(script, context);
  function advance(ms) {
    const end = now + ms;
    for (let count = 0; count < 1000; count++) {
      const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) { now = end; return; }
      now = first[1].at;
      timers.delete(first[0]);
      first[1].callback();
    }
    assert.fail("A timer loop did not terminate");
  }
  return {
    nodes, timers, context, doneButton, deleteButton, advance,
    togglePause() { nodes["demo-pause"].focus(); context.toggleDemoPause(); },
    until(predicate) {
      for (let elapsed = 0; elapsed <= 20_000; elapsed += 1) {
        if (predicate()) return;
        advance(1);
      }
      assert.fail("The expected demo stage was not reached");
    },
    get peakTimers() { return peakTimers; },
    visibility(hidden) { document.hidden = hidden; events.visibilitychange(); },
    reduce(value) { motion.matches = value; motion.change?.(); },
  };
}

test("the exact wake-up request and reply have isolated LTR times", () => {
  const text = id => html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</div>`))[1].replace(/<[^>]+>/g, "");
  assert.equal(text("demo-request"), "תזכורת השכמה לשעה 7:30 בבוקר");
  assert.equal(text("demo-reply"), "קיבלתי, אעשה השכמה לשעה 7:30 בבוקר.");
  assert.match(html, /class="popup-time" dir="ltr"[^>]*>7:30/);
  assert.doesNotMatch(html, /תזכורת לקנות עוגה|בעוד 2 דקות/);
  assert.doesNotMatch(script, /\bfetch\s*\(|Notification|localStorage|sessionStorage/);
});

test("the demo shows request, reply, popup and loops with one timer", () => {
  const demo = createDemo();
  const hidden = id => demo.nodes[id].hidden;
  assert.equal(hidden("demo-request"), false);
  demo.advance(700);
  assert.equal(hidden("demo-request"), false);
  assert.equal(hidden("demo-reply"), true);
  demo.advance(220);
  assert.equal(hidden("demo-typing-indicator"), false);
  assert.equal(hidden("demo-reply"), true);
  demo.advance(650);
  assert.equal(hidden("demo-typing-indicator"), true);
  assert.equal(hidden("demo-reply"), false);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, "");
  demo.advance(34);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, "ק");
  assert.equal(demo.nodes["demo-reply-announcement"].textContent, "");
  assert.equal(hidden("demo-reminder-popup"), true);
  demo.until(() => demo.nodes["demo-reply-announcement"].textContent !== "");
  assert.equal(
    ["prefix", "time", "suffix"].map(part => demo.nodes["demo-reply-" + part].textContent).join(""),
    "קיבלתי, אעשה השכמה לשעה 7:30 בבוקר.",
  );
  demo.advance(600);
  assert.equal(hidden("demo-reminder-popup"), false);
  assert.equal(demo.doneButton.disabled, true);
  assert.equal(demo.deleteButton.disabled, true);
  demo.advance(55);
  assert.equal(demo.nodes["demo-popup-title"].textContent, "ת");
  demo.until(() => demo.nodes["demo-popup-announcement"].textContent !== "");
  assert.equal(demo.nodes["demo-popup-title"].textContent, "תזכורת");
  assert.equal(demo.nodes["demo-popup-body"].textContent, "השכמה");
  assert.equal(demo.nodes["demo-popup-time"].textContent, "7:30");
  assert.equal(demo.nodes["demo-popup-period"].textContent, "בבוקר");
  assert.equal(demo.doneButton.disabled, false);
  assert.equal(demo.deleteButton.disabled, false);
  demo.advance(1150);
  assert.equal(demo.nodes["demo-done-stage"].hidden, false);
  assert.equal(demo.doneButton.textContent, "הושלם");
  assert.equal(demo.doneButton.disabled, true);
  assert.equal(demo.timers.size, 1);
  demo.advance(500);
  assert.equal(demo.nodes["demo-acknowledgement"].hidden, false);
  assert.equal(demo.nodes["demo-acknowledgement"].textContent, "סגור, התזכורת הושלמה בהדגמה.");
  demo.advance(1850);
  assert.equal(demo.nodes["demo-reminder-popup"].classList.contains("is-leaving"), true);
  demo.advance(350);
  assert.equal(hidden("demo-request"), true);
  assert.equal(hidden("demo-reminder-popup"), true);
  demo.advance(500);
  assert.equal(hidden("demo-acknowledgement"), true);
  assert.equal(hidden("demo-done-stage"), true);
  assert.equal(demo.nodes["demo-acknowledgement"].textContent, "");
  assert.equal(demo.doneButton.textContent, "בוצע");
  assert.equal(demo.nodes["demo-reminder-popup"].classList.contains("is-complete"), false);
  assert.equal(hidden("demo-request"), false);
  demo.advance(30_000);
  assert.equal(demo.peakTimers, 1);
});

test("switching tabs or hiding the page pauses and resumes the remaining delay", () => {
  const demo = createDemo();
  demo.advance(300);
  demo.context.switchTab("features");
  assert.equal(demo.timers.size, 0);
  demo.advance(20_000);
  demo.context.switchTab("demo");
  demo.advance(399);
  assert.equal(vm.runInContext("demoPlayback.stage", demo.context), "request");
  demo.advance(1);
  assert.equal(demo.nodes["demo-request"].hidden, false);
  demo.until(() => demo.nodes["demo-reply-prefix"].textContent.length === 3);
  const partial = demo.nodes["demo-reply-prefix"].textContent;
  demo.visibility(true);
  assert.equal(demo.timers.size, 0);
  demo.advance(20_000);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, partial);
  demo.visibility(false);
  demo.advance(33);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, partial);
  demo.advance(1);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent.length, 4);
  assert.equal(demo.peakTimers, 1);
});

test("local typing pauses autoplay and replay preserves custom messages", () => {
  const demo = createDemo();
  demo.nodes["chat-input"].focus();
  assert.equal(demo.timers.size, 0);
  demo.nodes["chat-input"].value = "תזכיר לי להתקשר";
  demo.nodes["chat-form"].emit("submit", { preventDefault() {} });
  assert.equal(demo.nodes.conversation.children.length, 2);
  demo.nodes["demo-replay"].focus();
  demo.context.replayDemo();
  assert.equal(demo.nodes.conversation.children.length, 2);
  demo.advance(150);
  assert.equal(demo.nodes["demo-request"].hidden, false);
});

test("the live demo CTA starts playback instead of accidentally pausing it", () => {
  const demo = createDemo({ hash: "#features" });
  assert.equal(demo.timers.size, 0);
  demo.context.focusDemo();
  assert.equal(demo.nodes["local-demo"].focused, true);
  assert.equal(demo.timers.size, 1);
  demo.until(() => !demo.nodes["demo-reminder-popup"].hidden);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, false);
});

test("popup actions pause the loop and replay restores the popup controls", () => {
  const demo = createDemo();
  demo.until(() => !demo.doneButton.disabled);
  demo.context.demoAction(demo.doneButton, "done");
  assert.equal(demo.doneButton.disabled, true);
  assert.equal(demo.timers.size, 0);
  demo.context.demoAction(demo.deleteButton, "delete");
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  demo.context.replayDemo();
  assert.equal(demo.doneButton.disabled, true);
  assert.equal(demo.doneButton.textContent, "בוצע");
  demo.until(() => !demo.doneButton.disabled);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, false);
});

test("the demo autoplays with reduced motion and deletion stays paused through visibility", () => {
  const demo = createDemo({ reducedMotion: true });
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  assert.equal(demo.timers.size, 1);
  demo.until(() => demo.nodes["demo-reply-prefix"].textContent.length === 3);
  assert.equal(demo.nodes["demo-reply-announcement"].textContent, "");
  demo.until(() => !demo.doneButton.disabled);
  assert.equal(demo.nodes["demo-reply-announcement"].textContent, "קיבלתי, אעשה השכמה לשעה 7:30 בבוקר.");
  assert.equal(demo.nodes["demo-popup-time"].textContent, "7:30");
  demo.context.demoAction(demo.deleteButton, "delete");
  demo.visibility(true);
  demo.visibility(false);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  demo.reduce(false);
  demo.reduce(true);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  assert.equal(demo.timers.size, 0);
  demo.context.replayDemo();
  assert.equal(demo.timers.size, 1);
  demo.until(() => !demo.doneButton.disabled);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, false);
  demo.advance(4500 + 350 + 500);
  assert.equal(demo.nodes["demo-request"].hidden, false);
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  assert.equal(demo.peakTimers, 1);
});

test("restarting mid-typing clears partial text and cannot duplicate timers", () => {
  const demo = createDemo();
  demo.until(() => demo.nodes["demo-reply-prefix"].textContent.length === 5);
  demo.context.replayDemo();
  demo.context.replayDemo();
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, "");
  assert.equal(demo.nodes["demo-reply-time"].textContent, "");
  assert.equal(demo.nodes["demo-popup-time"].textContent, "");
  assert.equal(demo.nodes["demo-typing-indicator"].hidden, true);
  assert.equal(demo.timers.size, 1);
  demo.until(() => !demo.doneButton.disabled);
  assert.equal(demo.nodes["demo-popup-time"].textContent, "7:30");
  assert.equal(demo.peakTimers, 1);
});

test("the explicit control is accessible and keeps the separate restart button", () => {
  assert.match(html, /id="demo-pause" type="button" onclick="toggleDemoPause\(\)" aria-controls="demo-sequence" aria-label="השהיית ההדגמה המקומית"/);
  assert.match(html, /id="demo-replay" type="button" onclick="replayDemo\(\)"/);
  const demo = createDemo();
  assert.equal(demo.nodes["demo-pause"].textContent, "השהיה");
  demo.togglePause();
  assert.equal(demo.nodes["demo-pause"].textContent, "המשך");
  assert.equal(demo.nodes["demo-pause"].attributes["aria-label"], "המשך ההדגמה המקומית מאותה נקודה");
  demo.togglePause();
  assert.equal(demo.nodes["demo-pause"].textContent, "השהיה");
});

test("explicit pause preserves the remaining delay even through repeated clicks", () => {
  const demo = createDemo();
  demo.advance(300);
  for (let click = 0; click < 20; click++) {
    demo.togglePause();
    assert.equal(demo.timers.size, 0);
    demo.advance(10_000);
    demo.togglePause();
    assert.equal(demo.timers.size, 1);
  }
  demo.advance(399);
  assert.equal(vm.runInContext("demoPlayback.stage", demo.context), "request");
  demo.advance(1);
  assert.equal(demo.nodes["demo-request"].hidden, false);
  assert.equal(demo.peakTimers, 1);
});

for (const [id, delay] of [
  ["demo-reply-prefix", 34], ["demo-reply-time", 34], ["demo-reply-suffix", 34],
  ["demo-popup-title", 55], ["demo-popup-body", 55], ["demo-popup-time", 55], ["demo-popup-period", 55],
]) {
  test(`explicit pause resumes ${id} at its next character without resetting the stage`, () => {
    const demo = createDemo();
    demo.until(() => demo.nodes[id].textContent.length === 1);
    demo.advance(10);
    const snapshot = Object.fromEntries(Object.entries(demo.nodes).map(([key, node]) => [key, [node.hidden, node.textContent]]));
    demo.togglePause();
    demo.advance(10_000);
    demo.togglePause();
    demo.advance(delay - 11);
    for (const [key, value] of Object.entries(snapshot)) {
      if (key !== "demo-pause") assert.deepEqual([demo.nodes[key].hidden, demo.nodes[key].textContent], value);
    }
    demo.advance(1);
    assert.equal(demo.nodes[id].textContent.length, 2);
    demo.until(() => !demo.doneButton.disabled);
    assert.equal(demo.nodes["demo-popup-time"].textContent, "7:30");
    assert.equal(demo.peakTimers, 1);
  });
}

test("explicit pause survives automatic visibility and tab changes; resume respects them", () => {
  const demo = createDemo();
  demo.advance(300);
  demo.togglePause();
  demo.visibility(true);
  demo.context.switchTab("features");
  demo.visibility(false);
  demo.context.switchTab("demo");
  assert.equal(demo.timers.size, 0);
  assert.equal(demo.nodes["demo-pause"].textContent, "המשך");
  demo.context.switchTab("features");
  demo.visibility(true);
  demo.togglePause();
  assert.equal(demo.timers.size, 0);
  demo.context.switchTab("demo");
  assert.equal(demo.timers.size, 0);
  demo.visibility(false);
  demo.advance(399);
  assert.equal(vm.runInContext("demoPlayback.stage", demo.context), "request");
  demo.advance(1);
  assert.equal(demo.nodes["demo-request"].hidden, false);
});

test("input interaction stays paused until deliberate resume and preserves local messages", () => {
  const demo = createDemo();
  demo.advance(300);
  demo.nodes["chat-input"].focus();
  demo.nodes["chat-input"].value = "הודעה מקומית";
  demo.nodes["chat-form"].emit("submit", { preventDefault() {} });
  demo.context.toggleDemoPause();
  assert.equal(demo.timers.size, 0);
  demo.visibility(true);
  demo.visibility(false);
  assert.equal(demo.timers.size, 0);
  demo.togglePause();
  demo.advance(399);
  assert.equal(vm.runInContext("demoPlayback.stage", demo.context), "request");
  demo.advance(1);
  assert.equal(demo.nodes["demo-request"].hidden, false);
  assert.equal(demo.nodes.conversation.children.length, 2);
});

test("popup interaction can resume its remaining hold without replaying or undoing deletion", () => {
  const demo = createDemo();
  demo.until(() => !demo.doneButton.disabled);
  demo.advance(1000);
  demo.context.demoAction(demo.deleteButton, "delete");
  demo.advance(10_000);
  assert.equal(demo.nodes["demo-pause"].textContent, "המשך");
  demo.togglePause();
  assert.equal(demo.nodes["demo-reminder-popup"].hidden, true);
  demo.advance(2499);
  assert.equal(demo.nodes["demo-acknowledgement"].hidden, true);
  assert.equal(demo.nodes["demo-done-stage"].hidden, true);
  assert.equal(demo.nodes["demo-request"].classList.contains("is-leaving"), false);
  demo.advance(1);
  assert.equal(demo.nodes["demo-request"].classList.contains("is-leaving"), true);
  assert.equal(demo.peakTimers, 1);
});

test("automatic completion pauses safely and replay clears its acknowledgement", () => {
  const demo = createDemo();
  demo.until(() => !demo.doneButton.disabled);
  demo.advance(600);
  demo.togglePause();
  demo.advance(20_000);
  assert.equal(demo.nodes["demo-done-stage"].hidden, true);
  demo.togglePause();
  demo.advance(549);
  assert.equal(demo.nodes["demo-done-stage"].hidden, true);
  demo.advance(1);
  assert.equal(demo.nodes["demo-done-stage"].hidden, false);
  demo.visibility(true);
  demo.advance(20_000);
  assert.equal(demo.nodes["demo-acknowledgement"].hidden, true);
  demo.visibility(false);
  demo.advance(500);
  assert.equal(demo.nodes["demo-acknowledgement"].hidden, false);
  demo.context.replayDemo();
  assert.equal(demo.nodes["demo-acknowledgement"].hidden, true);
  assert.equal(demo.nodes["demo-acknowledgement"].textContent, "");
  assert.equal(demo.nodes["demo-done-stage"].hidden, true);
  assert.equal(demo.nodes["demo-reminder-popup"].classList.contains("is-complete"), false);
  assert.equal(demo.peakTimers, 1);
});

test("pause and resume stay available regardless of device motion preference", () => {
  const demo = createDemo({ reducedMotion: true });
  assert.equal(demo.nodes["demo-pause"].disabled, false);
  assert.equal(demo.nodes["demo-pause"].textContent, "השהיה");
  demo.until(() => demo.nodes["demo-reply-prefix"].textContent.length === 3);
  const partial = demo.nodes["demo-reply-prefix"].textContent;
  demo.togglePause();
  assert.equal(demo.timers.size, 0);
  demo.reduce(false);
  demo.reduce(true);
  demo.advance(20_000);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent, partial);
  assert.equal(demo.timers.size, 0);
  assert.equal(demo.nodes["demo-pause"].textContent, "המשך");
  demo.togglePause();
  assert.equal(demo.timers.size, 1);
  demo.reduce(false);
  demo.advance(34);
  assert.equal(demo.nodes["demo-reply-prefix"].textContent.length, 4);
  demo.context.replayDemo();
  assert.equal(demo.nodes["demo-pause"].textContent, "השהיה");
  assert.equal(demo.peakTimers, 1);
});
