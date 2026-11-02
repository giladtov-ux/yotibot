const WORKER_LOCK_KEY = 73439182;
const LOCK_HEARTBEAT_MS = 10000;
const LOCK_QUERY_TIMEOUT_MS = 9800;

async function createWorkerLock(client) {
  return {
    active: false,
    async release() {
      return true;
    }
  };
}

module.exports = {
  WORKER_LOCK_KEY,
  LOCK_HEARTBEAT_MS,
  LOCK_QUERY_TIMEOUT_MS,
  createWorkerLock
};
