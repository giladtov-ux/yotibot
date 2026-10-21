-- Additive only. Existing Telegram users, reminders, lists and history are untouched.
CREATE TABLE IF NOT EXISTS public.ah_sheli_website_registrations (
  id uuid PRIMARY KEY,
  telegram_id text NOT NULL CHECK (telegram_id ~ '^[1-9][0-9]{0,15}$'),
  name text NOT NULL, email text NOT NULL, phone text NOT NULL,
  plan_tier text NOT NULL CHECK (plan_tier IN ('Basic','Pro','Unlimited')),
  session_hash text NOT NULL UNIQUE, link_hash text NOT NULL UNIQUE,
  link_expires_at timestamptz NOT NULL, session_expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  code_hash text, code_expires_at timestamptz, code_attempts integer NOT NULL DEFAULT 0,
  whop_user_id text, whop_checkout_id text UNIQUE,
  whop_plan_id text, whop_membership_id text, expected_amount integer,
  fulfilled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ah_sheli_website_telegram_idx
  ON public.ah_sheli_website_registrations (telegram_id);
CREATE TABLE IF NOT EXISTS public.ah_sheli_payment_grants (
  invoice_id text PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES public.ah_sheli_website_registrations(id),
  telegram_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending','sent','unknown','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve old provider records in existing databases; never drop billing history.
ALTER TABLE public.ah_sheli_website_registrations
  ADD COLUMN IF NOT EXISTS whop_user_id text,
  ADD COLUMN IF NOT EXISTS whop_checkout_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_membership_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ah_sheli_whop_checkout_idx
  ON public.ah_sheli_website_registrations (whop_checkout_id);
