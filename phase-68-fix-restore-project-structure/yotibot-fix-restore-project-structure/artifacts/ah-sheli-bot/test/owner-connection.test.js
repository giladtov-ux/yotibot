import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { numericChatId, verifyConnection } from "../src/owner-connection.js";

const code = "a".repeat(32);
const connection = {
  digest: createHash("sha256").update(code).digest("hex"),
  expiresAt: 2000,
};
const message = {
  text: `/connect ${code}`,
  chat: { id: 12345, type: "private" },
  from: { id: 12345, is_bot: false },
};

test("owner config accepts numeric IDs, never bot tokens", () => {
  assert.equal(numericChatId("12345"), "12345");
  assert.equal(numericChatId("-12345"), "-12345");
  assert.equal(numericChatId("12345:bot-token"), null);
  assert.equal(numericChatId(undefined), null);
});
test("a valid unexpired connection identifies the verified private sender", () => {
  assert.equal(verifyConnection(message, connection, 1000), "12345");
  assert.equal(verifyConnection({ ...message, text: `/connect@SomeBot ${code}` }, connection, 1000), "12345");
});
test("wrong, missing and expired connection commands do not authorize a sender", () => {
  assert.equal(verifyConnection({ ...message, text: `/connect ${"b".repeat(32)}` }, connection, 1000), null);
  assert.equal(verifyConnection(message, null, 1000), null);
  assert.equal(verifyConnection(message, connection, 2000), null);
});
test("groups, bots and mismatched sender identities cannot connect", () => {
  assert.equal(verifyConnection({ ...message, chat: { id: -12345, type: "group" } }, connection, 1000), null);
  assert.equal(verifyConnection({ ...message, from: { id: 12345, is_bot: true } }, connection, 1000), null);
  assert.equal(verifyConnection({ ...message, from: { id: 54321 } }, connection, 1000), null);
});
