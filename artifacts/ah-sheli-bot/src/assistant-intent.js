export function normalizeScheduledReminders(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return [];
  }
  const todayStr = new Date().toISOString().split("T")[0];
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const parsedHour = item.hour !== null && item.hour !== undefined && item.hour !== "" 
      ? optionalInteger(item.hour, "schedule hour", 0, 23) 
      : null;
      
    const parsedMinute = item.minute !== null && item.minute !== undefined && item.minute !== ""
      ? optionalInteger(item.minute, "schedule minute", 0, 59)
      : 0;

    return {
      text: optionalString(item.text, "schedule text", 300) || "תזכורת",
      date: item.date ? validDate(item.date) : todayStr,
      hour: parsedHour,
      minute: parsedMinute,
    };
  }).filter(Boolean);
}
