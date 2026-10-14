import { getPool } from "./database.js";
import { getJerusalemDateString, shiftJerusalemDate, parseJerusalemDateTime } from "./time.js";

// Read only the authenticated user's committed records, never the worker cache
// or conversational claims. One SQL statement gives a consistent snapshot.
export const DAILY_SUMMARY_SQL = `
  SELECT COALESCE((
      SELECT jsonb_agg(item ORDER BY (item->>'completedAt')::numeric, item->>'id')
      FROM jsonb_each(COALESCE(value->'lists'->($1::text), '{}'::jsonb)) list(name, items)
      CROSS JOIN LATERAL jsonb_array_elements(list.items) item
      WHERE list.name !~ '(קניות|מצרכים)'
        AND item->'checked' = 'true'::jsonb
        AND jsonb_typeof(item->'text') = 'string'
        AND CASE WHEN jsonb_typeof(item->'completedAt') = 'number'
          THEN (item->>'completedAt')::numeric END >= $2::numeric
        AND CASE WHEN jsonb_typeof(item->'completedAt') = 'number'
          THEN (item->>'completedAt')::numeric END < $3::numeric
    ), '[]'::jsonb) AS completed_tasks,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('listName', list.name, 'item', item)
        ORDER BY list.name, item->>'id')
      FROM jsonb_each(COALESCE(value->'lists'->($1::text), '{}'::jsonb)) list(name, items)
      CROSS JOIN LATERAL jsonb_array_elements(list.items) item
      WHERE list.name ~ '(משימ|מטר|היום)' AND list.name !~ '(קניות|מצרכים|רקע)'
        AND item->'checked' = 'false'::jsonb
        AND CASE
          WHEN item->>'scheduledDate' IS NOT NULL THEN item->>'scheduledDate' = $5
          WHEN jsonb_typeof(item->'dueAt') = 'number' THEN
            (item->>'dueAt')::numeric >= $2::numeric AND (item->>'dueAt')::numeric < $4::numeric
          ELSE TRUE END
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(ah_sheli_state.value->'reminders', '[]'::jsonb)) event
          WHERE event->>'chatId' = $1 AND event->>'trackingTaskId' = item->>'id'
            AND jsonb_typeof(event->'dueAt') = 'number'
            AND (event->>'dueAt')::numeric >= $4::numeric
            AND item->>'scheduledDate' IS NULL AND item->>'dueAt' IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_each(COALESCE(event->'telegramDeliveries', '{}'::jsonb)) delivery(key, receipt)
              WHERE jsonb_typeof(delivery.receipt->'sentAt') = 'number'
                AND (delivery.receipt->>'sentAt')::numeric >= $2::numeric
                AND (delivery.receipt->>'sentAt')::numeric < $4::numeric
            )
        )
    ), '[]'::jsonb) AS open_tasks,
    COALESCE((
      SELECT jsonb_agg(item ORDER BY item->>'id')
      FROM jsonb_each(COALESCE(value->'lists'->($1::text), '{}'::jsonb)) list(name, items)
      CROSS JOIN LATERAL jsonb_array_elements(list.items) item
      WHERE list.name ~ '(משימ|מטר|היום)' AND list.name !~ '(קניות|מצרכים|רקע)'
        AND item->'checked' = 'false'::jsonb AND item->>'scheduledDate' = $6
    ), '[]'::jsonb) AS deferred_tomorrow_tasks,
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

export async function loadDailySummaryStore(chatId, pool = getPool(), now = Date.now()) {
  const today = getJerusalemDateString(new Date(now));
  const from = parseJerusalemDateTime(today, "00:00", { allowPast: true });
  const until = Math.min(now + 1, parseJerusalemDateTime(shiftJerusalemDate(today, 1),
    "00:00", { allowPast: true }));
  const dayEnd = parseJerusalemDateTime(shiftJerusalemDate(today, 1), "00:00", { allowPast: true });
  const { rows } = await pool.query(DAILY_SUMMARY_SQL, [chatId, from, until, dayEnd, today, shiftJerusalemDate(today, 1)]);
  if (rows.length !== 1) throw new Error("The committed summary snapshot is unavailable.");
  return {
    completedTasks: rows[0].completed_tasks,
    openTasks: rows[0].open_tasks ?? [],
    deferredTomorrowTasks: rows[0].deferred_tomorrow_tasks ?? [],
    reminders: rows[0].reminders,
    savedSchedules: rows[0].schedules,
  };
}
