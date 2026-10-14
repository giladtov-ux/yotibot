import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateTelegramInitData, signMiniAppRequest } from "./mini-app-auth";

const token = "synthetic-telegram-token-not-a-real-credential";
const now = Date.now();
function signed(timestamp = Math.floor(now / 1000), user = { id: 12345, first_name: "משתמש בדיקה" }) {
  const params = new URLSearchParams({ auth_date: String(timestamp), query_id: "synthetic", user: JSON.stringify(user) });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const check = [...params].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${key}=${value}`).join("\n");
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
test("accepts Telegram HMAC and numeric private user identity", () => {
  assert.deepEqual(validateTelegramInitData(signed(), token, now), { id: "12345", name: "משתמש בדיקה" });
});
test("rejects forged identities and unsigned client identity fields", () => {
  assert.equal(validateTelegramInitData(signed().replace("12345", "54321"), token, now), null);
  assert.equal(validateTelegramInitData("user=%7B%22id%22%3A12345%7D", token, now), null);
});
test("rejects wrong token, stale/future proof and duplicate query parameters", () => {
  assert.equal(validateTelegramInitData(signed(), "different-token", now), null);
  assert.equal(validateTelegramInitData(signed(Math.floor(now / 1000) - 86_401), token, now), null);
  assert.equal(validateTelegramInitData(signed(Math.floor(now / 1000) + 61), token, now), null);
  assert.equal(validateTelegramInitData(signed() + "&auth_date=0", token, now), null);
});
test("rejects unsafe and nonpositive Telegram identities", () => {
  assert.equal(validateTelegramInitData(signed(undefined, { id: -1, first_name: "invalid" }), token, now), null);
  assert.equal(validateTelegramInitData(signed(undefined, { id: Number.MAX_SAFE_INTEGER + 1, first_name: "invalid" }), token, now), null);
});
test("worker signatures bind the actor, action and timestamp", () => {
  const body = { userId: "12345", timestamp: now, action: { entity: "item" } };
  assert.notEqual(signMiniAppRequest(body, token), signMiniAppRequest({ ...body, userId: "54321" }, token));
  assert.notEqual(signMiniAppRequest(body, token), signMiniAppRequest({ ...body, timestamp: now + 1 }, token));
});
