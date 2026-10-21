import { createWorkerRestartDelay } from "../artifacts/api-server/src/lib/worker-restart.ts";

// Dev-only lifecycle management. The child still owns its original SQL lock,
// authoritative reload, reminder scheduler and delivery/uncertain-outcome fences.
export function createDevWorkerSupervisor({
  spawnWorker, now = Date.now, schedule = setTimeout, cancel = clearTimeout,
  onEvent = () => {}, shutdownTimeoutMs = 10_000,
}) {
  if (typeof spawnWorker !== "function" || !Number.isFinite(shutdownTimeoutMs)
    || shutdownTimeoutMs <= 0) throw new TypeError("Invalid isolated worker supervisor options.");
  const restartDelay = createWorkerRestartDelay();
  let child, restartTimer, shutdownTimer;
  let started = false, stopping = false, forced = false, settled = false;
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const clearRestart = () => {
    if (restartTimer !== undefined) cancel(restartTimer);
    restartTimer = undefined;
  };
  const clearShutdown = () => {
    if (shutdownTimer !== undefined) cancel(shutdownTimer);
    shutdownTimer = undefined;
  };
  function finish(code, signal = null) {
    if (settled) return;
    settled = true;
    clearRestart(); clearShutdown();
    complete({ code, signal, forced });
  }
  function retry(uptime) {
    if (stopping || restartTimer !== undefined) return;
    const delayMs = restartDelay(uptime);
    onEvent({ event: "dev_worker_restart_scheduled", delayMs });
    // Keep the Dev launcher alive while waiting; do not unref this timer.
    restartTimer = schedule(() => {
      restartTimer = undefined;
      launch();
    }, delayMs);
  }
  function launch() {
    if (stopping || child) return;
    const startedAt = now();
    let candidate;
    try {
      candidate = spawnWorker();
    } catch {
      onEvent({ event: "dev_worker_spawn_failed" });
      retry(0);
      return;
    }
    child = candidate;
    let failed = false;
    candidate.once("error", () => {
      failed = true;
      onEvent({ event: "dev_worker_process_error" });
      // Node emits close even after a failed spawn. Never replace a child
      // on error alone: it may still own a port or a database session.
    });
    candidate.once("close", (code, signal) => {
      if (child !== candidate) return;
      child = undefined;
      clearShutdown();
      onEvent({ event: "dev_worker_closed", code, signal });
      if (stopping) {
        const exitCode = Number.isInteger(code) && code !== 0
          ? Math.max(1, code) : signal === "SIGKILL" ? 1 : 0;
        finish(forced ? 1 : exitCode, signal);
      }
      else if (code === 0 && !failed) {
        // A clean exit can be an intentional webhook/isolation refusal.
        // Do not undo that guard with an automatic restart loop.
        stopping = true;
        finish(0, signal);
      } else retry(now() - startedAt);
    });
    onEvent({ event: "dev_worker_started", pid: candidate.pid });
  }
  return {
    done,
    start() {
      if (started || stopping) return;
      started = true;
      launch();
    },
    stop(signal = "SIGTERM") {
      if (stopping) return done;
      stopping = true;
      clearRestart();
      if (!child) finish(0);
      else {
        const candidate = child;
        candidate.kill(signal);
        if (child === candidate) shutdownTimer = schedule(() => {
          shutdownTimer = undefined;
          if (child !== candidate || candidate.exitCode !== null
            || candidate.signalCode !== null) return;
          forced = true;
          onEvent({ event: "dev_worker_shutdown_forced" });
          candidate.kill("SIGKILL");
        }, shutdownTimeoutMs);
      }
      return done;
    },
    get state() {
      return { running: Boolean(child), stopping, restartScheduled: restartTimer !== undefined };
    },
  };
}
