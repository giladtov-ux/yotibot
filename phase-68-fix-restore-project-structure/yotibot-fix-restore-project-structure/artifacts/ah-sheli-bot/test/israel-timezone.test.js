import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Israel timezone is explicit before date checks even on a differently configured host", () => {
  for (const hostZone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
    // Isolated subprocesses exercise real startup, not a mocked clock or timezone.
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { parseJerusalemDateTime, getJerusalemDateString } from "./src/time.js";
      const summer = new Date("2026-07-01T08:22:59Z");
      const winter = new Date("2026-12-01T09:22:59Z");
      let pastRejected = false;
      try { parseJerusalemDateTime("2026-07-01", "11:21", { now: summer.getTime() }); }
      catch { pastRejected = true; }
      console.log(JSON.stringify({
        configured: process.env.TZ,
        resolved: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        summerHour: summer.getHours(), summerMinute: summer.getMinutes(),
        winterHour: winter.getHours(), winterMinute: winter.getMinutes(),
        summerOffset: summer.getTimezoneOffset(), winterOffset: winter.getTimezoneOffset(),
        summerDue: parseJerusalemDateTime("2026-07-01", "11:22", { now: summer.getTime() }),
        winterDue: parseJerusalemDateTime("2026-12-01", "11:22", { now: winter.getTime() }),
        midnight: getJerusalemDateString(new Date("2026-07-01T21:00:00Z")),
        pastRejected,
      }));
    `], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { TZ: hostZone }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      configured: "Asia/Jerusalem", resolved: "Asia/Jerusalem",
      summerHour: 11, summerMinute: 22, winterHour: 11, winterMinute: 22,
      summerOffset: -180, winterOffset: -120,
      summerDue: Date.parse("2026-07-01T08:22:00Z"),
      winterDue: Date.parse("2026-12-01T09:22:00Z"),
      midnight: "2026-07-02", pastRejected: true,
    }, hostZone);
  }
});
