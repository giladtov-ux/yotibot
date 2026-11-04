let memoryStore = {
  reminders: [],
  lists: {}
};

export function createId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

export async function saveStore(store) {
  if (store) {
    memoryStore = JSON.parse(JSON.stringify(store));
  }
  return true;
}

export async function loadStore() {
  return memoryStore;
}

export function setReminderPersistence(fn) {
  return fn;
}

export function initializeStatePersistence() {
  return true;
}

export function getChatLists(store, chatId) {
  if (!memoryStore.lists[chatId]) {
    memoryStore.lists[chatId] = {};
  }
  return memoryStore.lists[chatId];
}

export function getChatReminders(store, chatId) {
  return (memoryStore.reminders || []).filter(r => r.chatId === chatId);
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

export async function mutateReminderState(store, updater) {
  if (typeof updater === "function") {
    // מעביר את כל ה־memoryStore כדי ש־candidate.reminders יפעל נכון
    await updater(memoryStore);
  }
  return true;
}

export async function mutateList(store, chatId, name, updater) {
  if (typeof updater === "function") {
    await updater(memoryStore.lists);
  }
  return [];
}
