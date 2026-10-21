import { pool } from "@workspace/db";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { unwrapWebhook } from "@whop/sdk/helpers";
import { getWhopClient } from "./whopClient";
import { logger } from "./logger";
import { websiteOrigin, planAmounts } from "./billing-config";
import { whopPaymentProof } from "./payment-policy";

let ready = false, reconciling = false;
let init: Promise<void> | undefined;
let webhookKey: string | undefined;
let timer: NodeJS.Timeout | undefined;
export function billingStatus() { return { ready, liveMode: true }; }
export function whopPlanId(tier: keyof typeof planAmounts) {
  return tier === "Pro" ? process.env.WHOP_PRO_PLAN_ID : process.env.WHOP_UNLIMITED_PLAN_ID;
}
export async function paidPrice(tier: keyof typeof planAmounts) {
  if (!ready) return null;
  const id = whopPlanId(tier);
  if (!id) return null;
  const plan = await (await getWhopClient()).plans.retrieve({ id });
  if (plan.account?.id !== process.env.WHOP_COMPANY_ID || plan.currency !== "ils"
    || plan.plan_type !== "renewal" || plan.billing_period !== 30
    || plan.initial_price !== 0 || plan.renewal_price * 100 !== planAmounts[tier]
    || plan.trial_period_days || plan.visibility === "archived") return null;
  return id;
}
function cryptKey() {
  if (!process.env.SESSION_SECRET) throw new Error("website_session_secret_missing");
  return createHash("sha256").update(`whop-webhook:${process.env.SESSION_SECRET}`).digest();
}
function encrypt(secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", cryptKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decrypt(value: string) {
  const buffer = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", cryptKey(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
}
export async function initializeBilling() {
  init ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.ah_sheli_website_registrations(
        id uuid PRIMARY KEY, telegram_id text NOT NULL CHECK(telegram_id ~ '^[1-9][0-9]{0,19}$'),
        name text NOT NULL, email text NOT NULL, phone text NOT NULL,
        plan_tier text NOT NULL CHECK(plan_tier IN ('Basic','Pro','Unlimited')),
        session_hash text NOT NULL UNIQUE, link_hash text NOT NULL UNIQUE,
        link_expires_at timestamptz NOT NULL, session_expires_at timestamptz NOT NULL,
        verified_at timestamptz, code_hash text, code_expires_at timestamptz,
        verification_attempts integer NOT NULL DEFAULT 0, expected_amount integer,
        fulfilled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS public.ah_sheli_payment_grants(
        invoice_id text PRIMARY KEY,
        registration_id uuid NOT NULL REFERENCES public.ah_sheli_website_registrations(id),
        telegram_id text NOT NULL, expires_at timestamptz NOT NULL,
        notification_status text NOT NULL DEFAULT 'pending'
          CHECK(notification_status IN ('pending','sent','unknown','failed')),
        created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.ah_sheli_website_registrations
      ADD COLUMN IF NOT EXISTS whop_user_id text, ADD COLUMN IF NOT EXISTS whop_checkout_id text,
      ADD COLUMN IF NOT EXISTS whop_plan_id text, ADD COLUMN IF NOT EXISTS whop_membership_id text;
      CREATE UNIQUE INDEX IF NOT EXISTS ah_sheli_whop_checkout_idx ON public.ah_sheli_website_registrations(whop_checkout_id);
      CREATE TABLE IF NOT EXISTS public.ah_sheli_whop_webhooks(
        endpoint text PRIMARY KEY, company_id text NOT NULL, secret_ciphertext text NOT NULL);`);
    const client = await getWhopClient();
    ready = true;
    for (const tier of ["Pro", "Unlimited"] as const) {
      if (!await paidPrice(tier)) throw new Error("whop_catalog_unavailable");
    }
    const endpoint = `${websiteOrigin()}/api/whop/webhook`;
    try {
      // A pinned public origin must not let development register a live hook
      // using credentials/state from its separate database.
      if (process.env.NODE_ENV === "development") throw new Error("preview_webhook_registration_disabled");
      const { rows } = await pool.query("SELECT secret_ciphertext FROM public.ah_sheli_whop_webhooks WHERE endpoint=$1 AND company_id=$2",
        [endpoint, process.env.WHOP_COMPANY_ID]);
      if (rows[0]) webhookKey = decrypt(rows[0].secret_ciphertext);
      else {
        const hooks = await client.webhooks.list({ account_id: process.env.WHOP_COMPANY_ID!, first: 100 });
        const existing = hooks.data.find(h => h.url === endpoint && h.enabled);
        const hook = existing
          ? await client.webhooks.retrieve({ id: existing.id })
          : await client.webhooks.create({ url: endpoint, resource_id: process.env.WHOP_COMPANY_ID,
            events: ["payment.succeeded"], enabled: true },
            { idempotencyKey: `ah-sheli-hook-${createHash("sha256").update(endpoint).digest("hex")}` });
        if (!hook.webhook_secret) throw new Error("whop_webhook_secret_unavailable");
        webhookKey = hook.webhook_secret;
        await pool.query(`INSERT INTO public.ah_sheli_whop_webhooks(endpoint,company_id,secret_ciphertext)
          VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET company_id=$2,secret_ciphertext=$3`,
          [endpoint, process.env.WHOP_COMPANY_ID, encrypt(webhookKey)]);
      }
    } catch {
      logger.warn({ code: "whop_webhook_setup_pending" }, "Whop payments use authenticated reconciliation until webhook setup succeeds");
    }
    logger.info("Whop billing initialized");
    timer ??= setInterval(() => void reconcilePayments(), 30_000);
    timer.unref();
    await reconcilePayments();
  })().catch(error => {
    ready = false; init = undefined;
    const retry = setTimeout(() => void initializeBilling().catch(() => {}), 30_000);
    retry.unref();
    throw error;
  });
  return init;
}
export async function processWhopWebhook(payload: Buffer, headers: Record<string, string>) {
  await initializeBilling();
  if (!webhookKey || !Buffer.isBuffer(payload)) throw new Error("webhook_unavailable");
  const event = unwrapWebhook<{ type?: string }>(payload.toString("utf8"), { headers, key: webhookKey });
  // Signed delivery triggers provider reads, never an unverified grant from event data.
  if (event.type === "payment.succeeded") await reconcilePayments();
}
export async function reconcilePayments() {
  if (!ready || reconciling) return;
  reconciling = true;
  try {
    const company = process.env.WHOP_COMPANY_ID!;
    const { rows } = await pool.query(`SELECT * FROM public.ah_sheli_website_registrations
      WHERE verified_at IS NOT NULL AND whop_checkout_id IS NOT NULL AND
        (fulfilled_at IS NULL OR whop_membership_id IS NOT NULL)
      ORDER BY created_at DESC`);
    if (rows.length) {
      const client = await getWhopClient();
      // Paginate through new payments, stopping only after an already-processed payment.
      let after: string | undefined;
      do {
        const page = await client.payments.list({ account_id: company, status: "paid", first: 100,
          direction: "desc", order: "created_at", after });
        let allSeen = page.data.length > 0;
        for (const payment of page.data) {
          const { rows: receipt } = await pool.query("SELECT 1 FROM public.ah_sheli_payment_grants WHERE invoice_id=$1", [`whop:${payment.id}`]);
          if (receipt.length) continue;
          allSeen = false;
          const pay = payment as unknown as Record<string, any>;
          const membershipId = pay.membership_id ?? pay.membership?.id;
          const checkoutId = pay.checkout_configuration_id ?? pay.checkout_configuration?.id;
          const reg = rows.find(r => r.whop_membership_id === membershipId
            || r.whop_checkout_id === checkoutId);
          if (!reg || !membershipId) continue;
          const membership = await client.memberships.retrieve({ id: membershipId });
          const proof = whopPaymentProof(pay, membership as unknown as Record<string, any>, reg, company);
          if (!proof || proof.expiresAt.getTime() <= Date.now()) continue;
          const db = await pool.connect();
          try {
            await db.query("BEGIN");
            const { rows: locked } = await db.query("SELECT * FROM public.ah_sheli_website_registrations WHERE id=$1 FOR UPDATE", [reg.id]);
            if (!locked[0]?.verified_at || !whopPaymentProof(pay, membership as unknown as Record<string, any>, locked[0], company))
              throw new Error("whop_identity_changed");
            const claimed = await db.query(`INSERT INTO public.ah_sheli_payment_grants
              (invoice_id,registration_id,telegram_id,expires_at) VALUES($1,$2,$3,$4)
              ON CONFLICT(invoice_id) DO NOTHING RETURNING invoice_id`,
              [`whop:${payment.id}`, reg.id, reg.telegram_id, proof.expiresAt]);
            if (claimed.rowCount) {
              const grant = await db.query(`UPDATE public.ah_sheli_telegram_users
                SET subscription_status='active', subscription_expires_at=CASE
                  WHEN subscription_status='active' AND subscription_expires_at IS NULL THEN NULL
                  WHEN subscription_status='active' THEN GREATEST(subscription_expires_at,$2::timestamptz)
                  ELSE $2::timestamptz END, updated_at=now() WHERE telegram_user_id=$1`,
                [reg.telegram_id, proof.expiresAt]);
              if (grant.rowCount !== 1) throw new Error("verified_member_missing");
              await db.query(`UPDATE public.ah_sheli_website_registrations
                SET whop_user_id=$2,whop_membership_id=$3,fulfilled_at=COALESCE(fulfilled_at,now()) WHERE id=$1`,
                [reg.id, proof.userId, proof.membershipId]);
            }
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; }
          finally { db.release(); }
        }
        after = allSeen || !page.hasNextPage() ? undefined : page.response.page_info.end_cursor ?? undefined;
      } while (after);
    }
    await sendPaymentConfirmations();
  } catch {
    logger.warn({ code: "whop_reconciliation_failed" }, "Whop reconciliation will retry");
  } finally { reconciling = false; }
}
async function sendPaymentConfirmations() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const { rows } = await pool.query(`UPDATE public.ah_sheli_payment_grants SET notification_status='unknown'
    WHERE invoice_id IN (SELECT invoice_id FROM public.ah_sheli_payment_grants
      WHERE invoice_id LIKE 'whop:%' AND notification_status='pending'
      ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`);
  for (const receipt of rows) {
    const { rows: registrations } = await pool.query("SELECT plan_tier FROM public.ah_sheli_website_registrations WHERE id=$1", [receipt.registration_id]);
    try {
      const date = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem" }).format(receipt.expires_at);
      const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: receipt.telegram_id,
          text: `תודה על ההצטרפות, אחי! מסלול ${registrations[0].plan_tier} פעיל עד ${date}.\nשלח /help ואפשר להתחיל.` }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json() as { ok?: boolean };
      await pool.query("UPDATE public.ah_sheli_payment_grants SET notification_status=$2 WHERE invoice_id=$1",
        [receipt.invoice_id, result.ok ? "sent" : "failed"]);
    } catch { logger.warn({ code: "payment_confirmation_uncertain" }, "Access activated; confirmation not replayed"); }
  }
}
