import { bigint, bigserial, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ahSheliConfigTable = pgTable("ah_sheli_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const ahSheliUpdatesTable = pgTable("ah_sheli_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  status: text("status").notNull(),
  chatId: text("chat_id"),
  requestText: text("request_text"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ahSheliMessagesTable = pgTable("ah_sheli_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  chatId: text("chat_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ahSheliStateTable = pgTable("ah_sheli_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
