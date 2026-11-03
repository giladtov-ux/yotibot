// פונקציית עזר ליצירת מזהה ייחודי
export function createId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// שמירת הסטור
export async function saveStore(store) {
  return true;
}

// עדכון אטומי של מצב התזכורות
export async function mutateReminderState(updater) {
  if (typeof updater === "function") {
    await updater();
  }
  return true;
}
