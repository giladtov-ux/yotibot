import nodeSchedule from "node-schedule";

// One scheduled background job, not a second Telegram polling process.
// The existing worker reads persisted dueAt values and owns delivery safety.
export const REMINDER_CHECK_INTERVAL_MS = 1000;
export const REMINDER_CRON = "* * * * * *";

export function createReminderScheduler(runReminders, {
  onError = () => {},
  schedule = (spec, callback) => nodeSchedule.scheduleJob(spec, callback),
  cancel = job => job.cancel(),
} = {}) {
  let job;
  let active = false;
  let running = false;

  async function tick() {
    if (!active || running) return;
    running = true;
    try {
      await runReminders();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      try {
        job = schedule({ rule: REMINDER_CRON, tz: "Asia/Jerusalem" }, () => { void tick(); });
        if (!job) throw new Error("Background reminder job could not be scheduled.");
      } catch (error) {
        active = false;
        job = undefined;
        throw error;
      }
      // Recover overdue persisted reminders immediately, not one tick later.
      void tick();
    },
    stop() {
      active = false;
      if (job !== undefined) cancel(job);
      job = undefined;
    },
  };
}
