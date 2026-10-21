const RETRY_DELAY_MS = 60_000;

export function getNextReminderAttemptAt(reminders) {
  return reminders.reduce((earliest, reminder) => {
    if (reminder.sentAt) return earliest;

    const retryAt = Number.isFinite(reminder.lastAttemptAt)
      ? reminder.lastAttemptAt + RETRY_DELAY_MS
      : -Infinity;
    return Math.min(earliest, Math.max(reminder.dueAt, retryAt));
  }, Infinity);
}