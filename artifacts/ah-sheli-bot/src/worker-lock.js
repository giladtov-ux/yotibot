export const WORKER_LOCK_KEY = 73439182;
export const LOCK_HEARTBEAT_MS = 10000;
export const LOCK_QUERY_TIMEOUT_MS = 9800;

export async function createWorkerLock(client) {
  let active = false;
  let heartbeat = null;

  return {
    active: false,
    async release() {
      active = false;
      if (heartbeat) clearInterval(heartbeat);
    }
  };
}
