export function normalizeScheduledReminders(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("AI returned an invalid schedule.");
  }
  const todayStr = new Date().toISOString().split("T")[0];
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("AI returned an invalid schedule entry.");
    }
    return {
      text: optionalString(item.text, "schedule text", 300),
      date: item.date ? validDate(item.date) : todayStr,
      hour: optionalInteger(item.hour, "schedule hour", 0, 23),
      minute: optionalInteger(item.minute, "schedule minute", 0, 59),
    };
  });
}
