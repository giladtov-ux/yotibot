import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ahSheliRemindersTable = pgTable(
  "ah_sheli_reminders",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    text: text("text").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    repeatEveryMs: integer("repeat_every_ms"),
    remainingOccurrences: integer("remaining_occurrences"),
  },
  (table) => [
    index("ah_sheli_reminders_due_at_idx").on(table.dueAt),
    index("ah_sheli_reminders_chat_due_idx").on(table.chatId, table.dueAt),
  ],
);

export type AhSheliReminderRow = typeof ahSheliRemindersTable.$inferSelect;