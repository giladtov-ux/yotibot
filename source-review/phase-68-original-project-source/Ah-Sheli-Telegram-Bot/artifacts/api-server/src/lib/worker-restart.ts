// Recover a single transient disconnect quickly without a restart storm when
// the database is unavailable or another instance still holds the lock.
export function createWorkerRestartDelay() {
  let failures = 0;
  return (uptimeMs: number) => {
    if (uptimeMs >= 60_000) failures = 0;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));
    failures++;
    return delay;
  };
}
