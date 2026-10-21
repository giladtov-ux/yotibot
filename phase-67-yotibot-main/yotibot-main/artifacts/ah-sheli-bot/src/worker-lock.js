export const WORKER_LOCK_KEY = 724839102;
export const LOCK_HEARTBEAT_MS = 10_000;
export const LOCK_QUERY_TIMEOUT_MS = 5_000;

// A session lock must stay on a dedicated connection. Never reconnect it
// underneath a running worker: another worker may now own the authoritative
// state. On loss the process must stop, then reload state after a fresh lock.
export async function createWorkerLock(client, {
  onLost,
  heartbeatMs = LOCK_HEARTBEAT_MS,
  queryTimeoutMs = LOCK_QUERY_TIMEOUT_MS,
  schedule = setInterval,
  cancel = clearInterval,
  log = console.info,
  lockKey = WORKER_LOCK_KEY,
} = {}) {
  let active = false;
  let closing = false;
  let checking = false;
  let timer;
  let backendPid;
  const lost = (error) => {
    if (!active || closing) return;
    active = false;
    cancel(timer);
    // Only a code is logged, never a connection string or driver message.
    console.error(`[Ah Sheli] Worker lock lost ${JSON.stringify({
      code: /^[A-Z0-9_]{1,40}$/u.test(error?.code ?? "") ? error.code : "connection_lost",
    })}; stopping.`);
    onLost?.(error);
  };
  client.on("error", lost);
  client.on("end", () => lost({ code: "CONNECTION_ENDED" }));

  const query = (text, values) => client.query({
    text, values, query_timeout: queryTimeoutMs,
  });
  try {
    await client.connect();
    const { rows } = await query(
      "SELECT pg_try_advisory_lock($1) AS acquired, pg_backend_pid() AS pid",
      [lockKey],
    );
    if (!rows[0]?.acquired) throw new Error("Another Ah Sheli worker is already active.");
    backendPid = rows[0].pid;
    active = true;
  } catch (error) {
    closing = true;
    await client.end().catch(() => undefined);
    throw error;
  }

  async function check() {
    if (!active || checking) return;
    checking = true;
    const started = performance.now();
    try {
      // Do not call pg_try_advisory_lock again: it would increment the lock
      // count, or silently acquire a new lock on a different pooled backend.
      const { rows } = await query(
        `SELECT pg_backend_pid() = $1 AND EXISTS (
           SELECT 1 FROM pg_locks
           WHERE locktype = 'advisory' AND pid = pg_backend_pid()
             AND classid = 0 AND objid = $2 AND objsubid = 1 AND granted
         ) AS owned`,
        [backendPid, lockKey],
      );
      if (!rows[0]?.owned) {
        lost({ code: "LOCK_NOT_OWNED" });
        return;
      }
      log(`[Ah Sheli] Worker lock heartbeat ${JSON.stringify({
        durationMs: Math.round(performance.now() - started),
      })}`);
    } catch (error) {
      lost(error);
    } finally {
      checking = false;
    }
  }

  timer = schedule(() => void check(), heartbeatMs);
  timer?.unref?.();
  log("[Ah Sheli] Worker session lock acquired; heartbeat enabled.");
  return {
    isActive: () => active && !closing,
    check,
    async release() {
      if (closing) return;
      closing = true;
      cancel(timer);
      const owned = active;
      active = false;
      try {
        if (owned) await query("SELECT pg_advisory_unlock($1)", [lockKey]);
      } finally {
        await client.end();
      }
    },
  };
}
