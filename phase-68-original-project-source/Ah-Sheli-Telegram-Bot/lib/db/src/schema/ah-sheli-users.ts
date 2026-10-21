import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ahSheliTelegramUsersTable = pgTable("ah_sheli_telegram_users", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  subscriptionStatus: text("subscription_status").notNull().default("pending"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("ah_sheli_telegram_users_telegram_user_id_check",
    sql`${table.telegramUserId} ~ '^[1-9][0-9]{0,15}$'`),
  check("ah_sheli_telegram_users_subscription_status_check",
    sql`${table.subscriptionStatus} IN ('pending', 'active', 'revoked')`),
]);

// Attempt is committed before network delivery. No automatic retry/replay.
export const ahSheliAccessNotificationsTable = pgTable("ah_sheli_access_notifications", {
  eventKey: text("event_key").primaryKey(),
  telegramUserId: text("telegram_user_id").notNull().references(() => ahSheliTelegramUsersTable.telegramUserId),
  recipientId: text("recipient_id").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("ah_sheli_access_notifications_status_check",
    sql`${table.deliveryStatus} IN ('unknown', 'sent', 'failed')`),
]);
