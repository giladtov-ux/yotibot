import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { registrationCookie, registrationSession } from "./registration-cookie";

function request(mini: boolean, cookies = {}) {
  return { get: () => mini ? "1" : undefined, cookies } as unknown as Request;
}
test("ordinary registration retains its original secure Lax cookie", () => {
  assert.deepEqual(registrationCookie(request(false)), {
    name: "ah_sheli_registration",
    options: { httpOnly: true, secure: true, path: "/", sameSite: "lax" },
  });
});
test("Mini App iframe uses a separate secure partitioned cookie, not identity data", () => {
  assert.deepEqual(registrationCookie(request(true)), {
    name: "ah_sheli_registration_mini",
    options: { httpOnly: true, secure: true, path: "/", sameSite: "none", partitioned: true },
  });
  const cookies = { ah_sheli_registration: "ordinary", ah_sheli_registration_mini: "mini" };
  assert.equal(registrationSession(request(false, cookies)), "ordinary");
  assert.equal(registrationSession(request(true, cookies)), "mini");
  assert.equal(registrationSession(request(true, { ah_sheli_registration: "ordinary" })), "");
});
