export const WORKER_LOCK_KEY = 73439182;
export const LOCK_HEARTBEAT_MS = 10000;
export const LOCK_QUERY_TIMEOUT_MS = 9800;

export async function createWorkerLock(client) {
  return {
    active: false,
    isActive() {
      return false;
    },
    async release() {
      return true;
    },
    async check() {
      return true;
    }
  };
}

export async function check() {
  return true;
}
