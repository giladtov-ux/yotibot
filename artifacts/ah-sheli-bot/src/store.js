export function createId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

export async function saveStore(store) {
  return true;
}

export async function loadStore() {
  return { reminders: [], lists: {} };
}

export function setReminderPersistence(fn) {
  return fn;
}

export function initializeStatePersistence() {
  return true;
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

export function setPendingAction(action) {
  return action;
}

export function getPendingListAction() {
  return null;
}

export function setPendingListAction(action) {
  return action;
}

export function assertStatePersistenceActive() {
  return true;
}

export function setReminderCommitHandler(fn) {
  return fn;
}

export function setUnknownCommitHandler(fn) {
  return fn;
}

export async function mutateReminderState(updater) {
  if (typeof updater === "function") {
    await updater();
  }
  return true;
}

export async function mutateList(updater) {
  if (typeof updater === "function") {
    await updater();
  }
  return true;
}
