import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logger } from "./logger";
import { websiteOrigin, planAmounts } from "./billing-config";
import {
  billingCheckoutEnabled, billingRuntimeEnabled, hasWhopSandboxConfiguration, whopCompanyId, whopMode, whopPlanId,
} from "./whop-config";
import egressGate from "../../../../lib/egress/egress-gate.cjs";

let ready = false, reconciling = false;
let init: Promise<void> | undefined;
let webhookKey: string | undefined;
let timer: NodeJS.Timeout | undefined, retryTimer: NodeJS.Timeout | undefined;
const egressStopped = () => egressGate.getProcessEgressGate()?.status().tripped === true;

async function loadBillingPool() {
  return (await import("@workspace/db")).pool;
}

async function createWhopClient() {
  const { getWhopClient } = await import("./whopClient");
  return getWhopClient();
}

export function stopBillingRuntime() {
  ready = false;
  webhookKey = undefined;
  if (timer) clearInterval(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = undefined;
  retryTimer = undefined;
}

export function billingStatus() {
  const mode = whopMode();
  return { ready, liveMode: mode === "live", mode, checkoutEnabled: ready && billingCheckoutEnabled() };
}
export async function paidPrice(tier: keyof typeof planAmounts) {
  if (!ready || egressStopped()) return null;
  const id = whopPlanId(tier);
  const companyId = whopCompanyId();
  if (!id || !companyId) return null;
  const plan = await (await createWhopClient()).plans.retrieve({ id });
  if (plan.account?.id !== companyId || plan.currency !== "ils"
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
  if (!billingRuntimeEnabled()) {
    stopBillingRuntime();
    init = undefined;
    return;
  }
  if (egressStopped()) return;
  if (whopMode() === "sandbox" && !hasWhopSandboxConfiguration()) {
    ready = false;
    return;
  }
  init ??= (async () => {
    const pool = await loadBillingPool();
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
    const client = await createWhopClient();
    ready = true;
    for (const tier of ["Pro", "Unlimited"] as const) {
      if (!await paidPrice(tier)) throw new Error("whop_catalog_unavailable");
    }
    const endpoint = `${websiteOrigin()}/api/whop/webhook`;
    try {
      // A pinned public origin must not let development register a live hook
      // using credentials/state from its separate database.
      if (process.env.NODE_ENV === "development" && whopMode() === "live")
        throw new Error("preview_live_webhook_registration_disabled");
      const { rows } = await pool.query("SELECT secret_ciphertext FROM public.ah_sheli_whop_webhooks WHERE endpoint=$1 AND company_id=$2",
        [endpoint, whopCompanyId()]);
      if (rows[0]) webhookKey = decrypt(rows[0].secret_ciphertext);
      else {
        const hooks = await client.webhooks.list({ account_id: whopCompanyId()!, first: 100 });
        const existing = hooks.data.find(h => h.url === endpoint && h.enabled);
        const hook = existing
          ? await client.webhooks.retrieve({ id: existing.id })
          : await client.webhooks.create({ url: endpoint, resource_id: whopCompanyId(),
            events: ["payment.succeeded"], enabled: true },
            { idempotencyKey: `ah-sheli-hook-${createHash("sha256").update(endpoint).digest("hex")}` });
        if (!hook.webhook_secret) throw new Error("whop_webhook_secret_unavailable");
        webhookKey = hook.webhook_secret;
        await pool.query(`INSERT INTO public.ah_sheli_whop_webhooks(endpoint,company_id,secret_ciphertext)
          VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET company_id=$2,secret_ciphertext=$3`,
          [endpoint, whopCompanyId(), encrypt(webhookKey)]);
      }
    } catch {
      logger.warn({ code: "whop_webhook_setup_pending" }, "Whop payments use authenticated reconciliation until webhook setup succeeds");
    }
    logger.info("Whop billing initialized");
    if (egressStopped()) return;
    timer ??= setInterval(() => {
      if (!egressStopped()) void reconcilePayments();
    }, 30_000);
    timer.unref();
    await reconcilePayments();
  })().catch(error => {
    ready = false; init = undefined;
    if (!egressStopped()) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!egressStopped()) void initializeBilling().catch(() => {});
      }, 30_000);
      retryTimer.unref();
    }
    throw error;
  });
  return init;
}
export async function processWhopWebhook(payload: Buffer, headers: Record<string, string>) {
  if (!billingRuntimeEnabled()) throw new Error("billing_runtime_disabled");
  await initializeBilling();
  if (!webhookKey || !Buffer.isBuffer(payload)) throw new Error("webhook_unavailable");
  const { processVerifiedWhopWebhook } = await import("./whop-webhook");
  await processVerifiedWhopWebhook(payload, headers, webhookKey, reconcilePayments);
}
export async function reconcilePayments() {
  if (!billingRuntimeEnabled() || !ready || reconciling || egressStopped()) return;
  reconciling = true;
  try {
    const company = whopCompanyId();
    if (!company) throw new Error("whop_company_missing");
    const pool = await loadBillingPool();
    const { reconcileWhopPayments } = await import("./whop-reconciliation");
    await reconcileWhopPayments({
      pool,
      company,
      getClient: createWhopClient,
      sendPaymentConfirmations: () => sendPaymentConfirmations(pool),
    });
  } catch {
    logger.warn({ code: "whop_reconciliation_failed" }, "Whop reconciliation will retry");
  } finally { reconciling = false; }
}
async function sendPaymentConfirmations(pool: Awaited<ReturnType<typeof loadBillingPool>>) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const { rows } = await pool.query(`UPDATE public.ah_sheli_payment_grants SET notification_status='unknown'
    WHERE invoice_id IN (SELECT invoice_id FROM public.ah_sheli_payment_grants
      WHERE invoice_id LIKE 'whop:%' AND notification_status='pending'
        AND EXISTS (SELECT 1 FROM public.ah_sheli_telegram_users u
          WHERE u.telegram_user_id = ah_sheli_payment_grants.telegram_id
            AND u.messages_opted_out = false)
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
