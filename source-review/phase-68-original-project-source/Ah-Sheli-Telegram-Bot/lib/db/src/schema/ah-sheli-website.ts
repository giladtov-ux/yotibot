import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const ahSheliWebsiteRegistrations = pgTable("ah_sheli_website_registrations", {
  id: uuid("id").primaryKey(),
  telegramId: text("telegram_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  planTier: text("plan_tier").notNull(),
  sessionHash: text("session_hash").notNull().unique(),
  linkHash: text("link_hash").notNull().unique(),
  linkExpiresAt: timestamp("link_expires_at", { withTimezone: true }).notNull(),
  sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  codeAttempts: integer("code_attempts").notNull().default(0),
  whopUserId: text("whop_user_id"),
  whopCheckoutId: text("whop_checkout_id").unique(),
  whopPlanId: text("whop_plan_id"),
  whopMembershipId: text("whop_membership_id"),
  expectedAmount: integer("expected_amount"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("ah_sheli_website_telegram_idx").on(table.telegramId)]);
export const insertWebsiteRegistrationSchema = createInsertSchema(ahSheliWebsiteRegistrations);
export type WebsiteRegistrationRow = typeof ahSheliWebsiteRegistrations.$inferSelect;

// Application fulfillment receipts; the provider owns its catalog and subscriptions.
export const ahSheliPaymentGrants = pgTable("ah_sheli_payment_grants", {
  invoiceId: text("invoice_id").primaryKey(),
  registrationId: uuid("registration_id").notNull().references(() => ahSheliWebsiteRegistrations.id),
  telegramId: text("telegram_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  notificationStatus: text("notification_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertPaymentGrantSchema = createInsertSchema(ahSheliPaymentGrants);
