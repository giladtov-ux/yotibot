import test from "node:test";
import assert from "node:assert/strict";
import { landingPageUrl } from "../src/user-access.js";
import { miniAppMenuUpdate } from "../src/telegram-mini-app.js";

test("Telegram website and Mini App links always use the canonical published host", () => {
  // A stale PUBLIC_APP_URL cannot override the literal production origin.
  assert.equal(landingPageUrl(), "https://yotibot-azbu.onrender.com");
  assert.equal(miniAppMenuUpdate().menu_button.web_app.url,
    "https://yotibot-azbu.onrender.com/app.html");
});
