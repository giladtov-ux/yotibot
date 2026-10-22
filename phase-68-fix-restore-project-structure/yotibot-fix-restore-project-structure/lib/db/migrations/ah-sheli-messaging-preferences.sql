-- Additive only. Opt-outs suppress bot messages without changing access,
-- subscriptions, reminders, or user-owned data.
ALTER TABLE public.ah_sheli_telegram_users
  ADD COLUMN IF NOT EXISTS messages_opted_out boolean NOT NULL DEFAULT false;
