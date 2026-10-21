import { getPool } from "./database.js";

// One read-only, owner-scoped SQL snapshot. No schema or task mutations.
export const MORNING_BRIEF_SQL = `
  SELECT COALESCE(value->'lists'->($1::text)->'משימות', '[]'::jsonb) AS tasks,
    COALESCE((
      SELECT jsonb_agg(reminder)
      FROM jsonb_array_elements(COALESCE(value->'reminders', '[]'::jsonb)) reminder
      WHERE reminder->>'chatId' = $1
    ), '[]'::jsonb) AS reminders,
    COALESCE((
      SELECT jsonb_agg(schedule)
      FROM jsonb_array_elements(COALESCE(value->'savedSchedules', '[]'::jsonb)) schedule
      WHERE schedule->>'chatId' = $1
    ), '[]'::jsonb) AS schedules
  FROM ah_sheli_state WHERE key = 'owner'`;

export async function loadMorningSnapshot(chatId, pool = getPool()) {
  const { rows } = await pool.query(MORNING_BRIEF_SQL, [chatId]);
  const row = rows[0];
  if (rows.length !== 1 || !Array.isArray(row.tasks) || !Array.isArray(row.reminders)
    || !Array.isArray(row.schedules)) throw new Error("The committed morning snapshot is unavailable.");
  return { tasks: row.tasks, reminders: row.reminders, savedSchedules: row.schedules };
}
