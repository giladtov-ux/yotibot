import { test, expect } from "@playwright/test";

const reply = "קיבלתי, אעשה השכמה לשעה 7:30 בבוקר.";
const fields = {
  "demo-reply-prefix": "קיבלתי, אעשה השכמה לשעה ",
  "demo-reply-time": "7:30",
  "demo-reply-suffix": " בבוקר.",
  "demo-popup-title": "תזכורת",
  "demo-popup-body": "השכמה",
  "demo-popup-time": "7:30",
  "demo-popup-period": "בבוקר",
};

test.beforeEach(async ({ page, context }) => {
  // Only public same-origin assets and fonts may leave this browser. Never
  // contact Telegram: the unrelated Mini App SDK is explicitly inert here.
  // API calls, checkout and navigation outside the demo must fail, not send.
  const unexpected = [];
  const origin = new URL(test.info().project.use.baseURL).origin;
  const staticAssets = new Set([
    "/launch-mini-app.js", "/telegram-mini-app.js", "/telegram-mini-app.css",
    "/billing.css", "/billing.js", "/homepage-neo.css", "/brand-colors.css",
  ]);
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" &&
        url.href === "https://telegram.org/js/telegram-web-app.js") {
      await route.fulfill({ contentType: "application/javascript", body: "" });
      return;
    }
    if (request.method() === "GET" &&
        ((url.origin === origin && (
          (request.resourceType() === "document" && url.pathname === "/") ||
          (["script", "stylesheet"].includes(request.resourceType()) && staticAssets.has(url.pathname))
        )) ||
         ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname))) {
      await route.continue();
    } else {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    }
  });
  page.on("pageerror", error => unexpected.push(error.message));
  page.__demoErrors = unexpected;
});

test.afterEach(async ({ page }) => {
  expect(page.__demoErrors).toEqual([]);
});

async function openDemo(page, width = 320) {
  await page.setViewportSize({ width, height: 740 });
  await page.clock.install();
  await page.goto("/#demo");
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator("#demo-replay").click();
  await page.locator("#local-demo").scrollIntoViewIfNeeded();
}

// Measure the rendered glyphs, not just dir attributes. Range rectangles catch
// bidi inversions even when textContent still says "7:30".
async function checkRenderedFields(page) {
  const snapshot = await page.evaluate(expected => {
    const errors = [];
    const rect = node => node.getBoundingClientRect();
    const inside = (child, parent, label) => {
      const c = rect(child), p = rect(parent);
      if (c.left < p.left - 1 || c.right > p.right + 1 ||
          c.top < p.top - 1 || c.bottom > p.bottom + 1) errors.push(`${label} outside card`);
    };
    const glyphs = node => {
      if (!node.firstChild || node.firstChild.nodeType !== Node.TEXT_NODE) return [];
      return Array.from(node.textContent, (_, i) => {
        const range = document.createRange();
        range.setStart(node.firstChild, i);
        range.setEnd(node.firstChild, i + 1);
        return range.getBoundingClientRect();
      });
    };
    const conversation = document.getElementById("conversation");
    const popup = document.getElementById("demo-reminder-popup");
    const chat = document.querySelector(".chat-card");
    for (const [id, text] of Object.entries(expected)) {
      const node = document.getElementById(id);
      if (!text.startsWith(node.textContent)) errors.push(`${id} is not a progressive prefix`);
      if (node.closest("[hidden]") || !node.textContent) continue;
      const style = getComputedStyle(node);
      const time = id.endsWith("-time");
      if (style.direction !== (time ? "ltr" : "rtl")) errors.push(`${id} direction`);
      if (time && style.unicodeBidi !== "isolate") errors.push(`${id} not isolated`);
      if (time) {
        const boxes = glyphs(node);
        for (let i = 1; i < boxes.length; i++) {
          if (boxes[i].left < boxes[i - 1].right - 1) errors.push(`${id} inverted glyph ${i}`);
        }
      }
      if (id.startsWith("demo-popup-")) inside(node, popup, id);
    }
    // The opening Hebrew word must read right to left on one line.
    const prefix = document.getElementById("demo-reply-prefix");
    if (!prefix.closest("[hidden]") && prefix.textContent.startsWith("קיבלתי")) {
      const boxes = glyphs(prefix).slice(0, 6);
      for (let i = 1; i < boxes.length; i++) {
        if (boxes[i].right > boxes[i - 1].right + 1) errors.push("Hebrew glyph order");
      }
    }
    if (!popup.hidden) {
      // Vertical scrolling is allowed; horizontal clipping is not.
      const p = rect(popup), c = rect(conversation);
      if (p.left < c.left - 1 || p.right > c.right + 1) errors.push("popup horizontally clipped");
      inside(popup, chat, "popup");
      popup.querySelectorAll("button").forEach(node => inside(node, popup, node.textContent));
    }
    if (conversation.scrollWidth > conversation.clientWidth + 1) errors.push("horizontal card overflow");
    return {
      errors,
      values: Object.fromEntries(Object.keys(expected).map(id => [id, document.getElementById(id).textContent])),
    };
  }, fields);
  expect(snapshot.errors).toEqual([]);
  return snapshot.values;
}

test("page load immediately shows the real user bubble and starts the loop without replay", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.goto("/#demo");
  await expect(page.locator("#demo-request")).toBeVisible();
  await expect(page.locator("#demo-request")).toHaveText("תזכורת השכמה לשעה 7:30 בבוקר");
  await expect(page.locator("#demo-reply")).toBeHidden();
  await page.clock.runFor(1570);
  await expect(page.locator("#demo-reply")).toBeVisible();
  await page.clock.runFor(4000);
  await expect(page.locator("#demo-reply")).toHaveText(reply);
  await expect(page.locator("#demo-popup-announcement")).toHaveText("תזכורת השכמה לשעה 7:30 בבוקר");
  await expect(page.locator("#demo-reminder-popup")).toBeVisible();
  await checkRenderedFields(page);
  await page.clock.runFor(1650);
  await expect(page.locator("#demo-done-stage")).toBeVisible();
  await expect(page.locator("#demo-acknowledgement")).toBeVisible();
  await expect(page.locator("#demo-acknowledgement")).toHaveText("סגור, התזכורת הושלמה בהדגמה.");
  await expect(page.locator("#demo-pause")).toHaveText("השהיה");
});

for (const width of [320, 360, 390]) {
  test(`full progressive Hebrew cycle fits at ${width}px`, async ({ page }, testInfo) => {
    await openDemo(page, width);
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("#demo-reply")).toHaveCSS("direction", "rtl");
    const seen = Object.fromEntries(Object.keys(fields).map(id => [id, new Set()]));
    // Request 150ms, indicator 220+650ms, then one reply character per 34ms.
    await page.clock.runFor(1020);
    for (let i = 0; i <= Array.from(reply).length; i++) {
      await page.clock.runFor(34);
      const values = await checkRenderedFields(page);
      for (const [id, value] of Object.entries(values)) seen[id].add(value);
    }
    await expect(page.locator("#demo-reply")).toHaveText(reply);
    await expect(page.locator("#demo-request")).toHaveText("תזכורת השכמה לשעה 7:30 בבוקר");
    await page.clock.runFor(600);
    // Popup title/body/time/period type one character per 55ms, including
    // transitions between fields; check every intermediate rendered state.
    for (let i = 0; i < 28; i++) {
      await page.clock.runFor(55);
      const values = await checkRenderedFields(page);
      for (const [id, value] of Object.entries(values)) seen[id].add(value);
    }
    for (const id of ["demo-reply-time", "demo-popup-time"]) {
      for (const partial of ["7", "7:", "7:3", "7:30"]) expect(seen[id].has(partial), `${id}: ${partial}`).toBe(true);
    }
    for (const [id, text] of Object.entries(fields)) await expect(page.locator(`#${id}`)).toHaveText(text);
    await expect(page.locator(".mini-action").first()).toBeEnabled();
    await expect(page.locator(".mini-action").last()).toBeEnabled();
    await page.locator("#demo-pause").click();
    await page.locator("#demo-reminder-popup").scrollIntoViewIfNeeded();
    await checkRenderedFields(page);
    await testInfo.attach(`completed-${width}`, { body: await page.locator("#local-demo").screenshot(), contentType: "image/png" });
    // Both local actions remain reachable inside the scrollable card.
    await page.locator(".mini-action").first().click();
    await expect(page.locator("#demo-notice")).toContainText("הדגמה");
    await page.locator(".mini-action").last().click();
    await expect(page.locator("#demo-reminder-popup")).toBeHidden();
    // Replay and let the finished sequence fade/reset: cover an entire loop.
    await page.locator("#demo-replay").click();
    await page.clock.runFor(1020 + (Array.from(reply).length + 1) * 34 + 600 + 24 * 55);
    await expect(page.locator("#demo-popup-announcement")).toHaveText("תזכורת השכמה לשעה 7:30 בבוקר");
    await page.clock.runFor(1150);
    await expect(page.locator("#demo-done-stage")).toBeVisible();
    await expect(page.locator(".mini-action").first()).toHaveText("הושלם");
    await expect(page.locator("#demo-pause")).toHaveText("השהיה");
    await page.clock.runFor(500);
    await expect(page.locator("#demo-acknowledgement")).toHaveText("סגור, התזכורת הושלמה בהדגמה.");
    await expect(page.locator("#demo-acknowledgement")).toBeVisible();
    const videoFrame = testInfo.outputPath("video-completed.png");
    await page.locator("#local-demo").screenshot({ path: videoFrame });
    await testInfo.attach(`video-completed-${width}`, { path: videoFrame, contentType: "image/png" });
    // Advance to just after the completion tick, then to reset, staying inside
    // the 500ms blank interval rather than accidentally entering the next loop.
    await page.clock.runFor(1850 + 350);
    await expect(page.locator("#demo-request")).toBeHidden();
    await expect(page.locator("#demo-acknowledgement")).toBeHidden();
    await expect(page.locator("#demo-acknowledgement")).toBeEmpty();
    await page.clock.runFor(500);
    await expect(page.locator("#demo-request")).toBeVisible();
  });
}

test("tab and controlled page-visibility events pause and resume partial text", async ({ page }) => {
  await openDemo(page);
  await page.clock.runFor(1300);
  const before = await page.locator("#demo-reply").textContent();
  expect(before.length).toBeGreaterThan(0);
  expect(before).not.toBe(reply);
  await page.locator("#btn-features").click();
  await page.clock.runFor(2000);
  expect(await page.locator("#demo-reply").textContent()).toBe(before);
  await page.locator("#btn-demo").click();
  await page.clock.runFor(100);
  const resumed = await page.locator("#demo-reply").textContent();
  expect(resumed.length).toBeGreaterThan(before.length);
  // Headless browser tabs do not consistently become hidden. Emulate the
  // visibility API explicitly; do not call this a device/backgrounding test.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(2000);
  expect(await page.locator("#demo-reply").textContent()).toBe(resumed);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(200);
  expect((await page.locator("#demo-reply").textContent()).length).toBeGreaterThan(resumed.length);
  await checkRenderedFields(page);
});

const pauseName = "השהיית ההדגמה המקומית";
const resumeName = "המשך ההדגמה המקומית מאותה נקודה";
const replayName = "הפעלה מחדש של ההדגמה המקומית";

async function expectPlaybackControl(page, name, text) {
  const control = page.getByRole("button", { name, exact: true });
  await expect(control).toHaveAttribute("id", "demo-pause");
  await expect(control).toHaveAccessibleName(name);
  await expect(control).toHaveText(text);
  await expect(control).toBeEnabled();
  await expect(control).toBeFocused();
  // Inspect the browser's accessibility tree as well as the DOM attribute.
  // This verifies the exposed name, not actual speech from an OS screen reader.
  expect(await control.ariaSnapshot()).toContain(`button "${name}"`);
}

for (const key of ["Enter", "Space"]) {
  test(`keyboard accessibility: ${key} pauses and resumes without moving focus`, async ({ page }) => {
    await openDemo(page, 390);
    await page.clock.runFor(1300);
    const partial = await page.locator("#demo-reply").textContent();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toBe(reply);

    // Replay precedes this in the test setup; Shift+Tab reaches pause naturally.
    await page.keyboard.press("Shift+Tab");
    await expectPlaybackControl(page, pauseName, "השהיה");
    const focusStyle = await page.locator("#demo-pause").evaluate(node => ({
      visible: node.matches(":focus-visible"),
      outline: getComputedStyle(node).outlineStyle,
      width: parseFloat(getComputedStyle(node).outlineWidth),
    }));
    expect(focusStyle.visible).toBe(true);
    expect(focusStyle.outline).not.toBe("none");
    expect(focusStyle.width).toBeGreaterThan(0);

    await page.keyboard.press(key);
    await expectPlaybackControl(page, resumeName, "המשך");
    await page.clock.runFor(20_000);
    await expect(page.locator("#demo-reply")).toHaveText(partial);
    await expect(page.locator("#demo-pause")).toBeFocused();

    await page.keyboard.press(key);
    await expectPlaybackControl(page, pauseName, "השהיה");
    await page.clock.runFor(200);
    expect((await page.locator("#demo-reply").textContent()).length).toBeGreaterThan(partial.length);
    await expect(page.locator("#demo-pause")).toBeFocused();
    await page.clock.runFor(20_000);
    await expect(page.locator("#demo-pause")).toBeFocused();
  });
}

test("keyboard accessibility: message, send, resume and replay have a stable tab order", async ({ page }) => {
  await openDemo(page, 390);
  const input = page.getByRole("textbox", { name: "כתבו הודעה להדגמה", exact: true });
  const send = page.getByRole("button", { name: "הצגת תגובת הדגמה", exact: true });
  const replay = page.getByRole("button", { name: replayName, exact: true });
  const conversation = page.locator("#conversation");
  const initialBubbles = await conversation.locator(".bubble").count();

  // Enter on the preceding CTA focuses the demo container, not an arbitrary
  // control; subsequent real Tab presses must follow the document's order.
  await page.getByRole("button", { name: "צפו בהדגמה", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#local-demo")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await expect(page.locator("#demo-pause")).toHaveAccessibleName(resumeName);
  await page.keyboard.type("בדיקת מקלדת מקומית");
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(conversation.locator(".bubble")).toHaveCount(initialBubbles + 2);
  await expect(page.locator("#demo-notice")).toHaveText("ההודעה נשארת בדפדפן בלבד — לא נשלחה ולא נשמרה.");

  await page.keyboard.press("Tab");
  await expect(send).toBeFocused();
  await page.keyboard.press("Tab");
  await expectPlaybackControl(page, resumeName, "המשך");
  await page.keyboard.press("Enter");
  await expectPlaybackControl(page, pauseName, "השהיה");
  await page.clock.runFor(2000);
  await expect(page.locator("#demo-reply-prefix")).not.toHaveText("");
  await expect(page.locator("#demo-pause")).toBeFocused();
  await expect(conversation.getByText("בדיקת מקלדת מקומית", { exact: true })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(replay).toBeFocused();
  await expect(replay).toBeEnabled();
  await expect(replay).toHaveAccessibleName(replayName);
  expect(await replay.ariaSnapshot()).toContain(`button "${replayName}"`);
  for (const key of ["Enter", "Space"]) {
    await page.keyboard.press(key);
    await expect(replay).toBeFocused();
    await expect(page.locator("#demo-notice")).toHaveText("ההדגמה המקומית הופעלה מחדש.");
    await expect(page.locator("#demo-reply-prefix")).toHaveText("");
    await page.clock.runFor(2000);
    await expect(page.locator("#demo-reply-prefix")).not.toHaveText("");
    await expect(replay).toBeFocused();
    await expect(conversation.locator(".bubble")).toHaveCount(initialBubbles + 2);
  }

  await page.keyboard.press("Shift+Tab");
  await expectPlaybackControl(page, pauseName, "השהיה");
  await page.keyboard.press("Shift+Tab");
  await expect(send).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await expect(page.locator("#demo-pause")).toHaveAccessibleName(resumeName);
});

test("keyboard accessibility: reduced motion keeps pause, resume and replay reachable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDemo(page, 390);
  const pause = page.locator("#demo-pause");
  const replay = page.getByRole("button", { name: replayName, exact: true });
  await expect(pause).toBeEnabled();
  await expect(pause).toHaveAccessibleName("השהיית ההדגמה המקומית");
  await pause.focus();
  await page.keyboard.press("Space");
  await expect(pause).toHaveAccessibleName("המשך ההדגמה המקומית מאותה נקודה");
  await page.clock.runFor(20_000);
  await expect(page.locator("#demo-reply")).toBeHidden();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".send-button")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pause).toBeFocused();
  await page.keyboard.press("Space");
  await expect(pause).toHaveAccessibleName("השהיית ההדגמה המקומית");
  await page.keyboard.press("Tab");
  await expect(replay).toBeFocused();
  await page.keyboard.press("Space");
  await page.clock.runFor(6000);
  await expect(page.locator("#demo-reply")).toHaveText(reply);
  await expect(page.locator("#demo-reminder-popup")).toBeVisible();
});

test("reduced motion autoplays progressive typing and popup without a static mode", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 740 });
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.goto("/#demo");
  await expect(page.locator("#demo-pause")).toBeEnabled();
  await expect(page.locator("#demo-pause")).toHaveText("השהיה");
  await expect(page.locator("#demo-request")).toBeVisible();
  await expect(page.locator("#demo-reply")).toBeHidden();
  await page.clock.runFor(1570 + 102);
  await expect(page.locator("#demo-reply-prefix")).toHaveText("קיב");
  await expect(page.locator("#demo-reply-announcement")).toBeEmpty();
  await page.clock.runFor(4000);
  await expect(page.locator("#demo-reply")).toHaveText(reply);
  for (const [id, text] of Object.entries(fields)) await expect(page.locator(`#${id}`)).toHaveText(text);
  await page.locator("#demo-pause").click();
  await page.locator("#demo-reminder-popup").scrollIntoViewIfNeeded();
  await checkRenderedFields(page);
  for (const node of [page.locator("#demo-reply"), page.locator("#demo-reminder-popup")]) {
    const duration = await node.evaluate(element => parseFloat(getComputedStyle(element).animationDuration));
    expect(duration).toBeLessThanOrEqual(0.00001);
  }
  await page.locator(".mini-action").last().click();
  await expect(page.locator("#demo-reminder-popup")).toBeHidden();
  await page.clock.runFor(20_000);
  await expect(page.locator("#demo-reminder-popup")).toBeHidden();
  await page.locator("#demo-replay").click();
  await page.clock.runFor(6000);
  await expect(page.locator("#demo-reply")).toHaveText(reply);
  await expect(page.locator("#demo-reminder-popup")).toBeVisible();
});
