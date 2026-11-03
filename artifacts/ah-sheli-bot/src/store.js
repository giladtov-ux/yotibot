export function createId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

export async function saveStore(store) {
  return true;
}

export function setReminderPersistence(fn) {
  return fn;
}

export function getChatLists() {
  return [];
}

export function getChatReminders() {
  return [];
}

export function getLastListAction() {
  return null;
}

export function getPendingAction() {
  return null;
}

export async function mutateReminderState(updater) {
  if (typeof updater === "function") {
    await updater();
  }
  return true;
}
