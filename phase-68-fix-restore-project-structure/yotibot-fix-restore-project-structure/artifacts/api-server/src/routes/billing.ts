import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { pool, type WebsiteRegistrationRow } from "@workspace/db";
import { RegisterWebsiteUserBody, VerifyWebsiteRegistrationBody } from "@workspace/api-zod";
import { websiteOrigin, planAmounts } from "../lib/billing-config";
import { billingStatus, paidPrice } from "../lib/billing-runtime";
import { getWhopClient } from "../lib/whopClient";
import { whopCompanyId } from "../lib/whop-config";
import { whopUrl } from "../lib/payment-policy";
import { registrationCookie, registrationSession } from "../lib/registration-cookie";

const router = Router();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function linkToken(session: string) {
  if (!process.env.SESSION_SECRET) throw new Error("website_session_secret_missing");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`website-link:${session}`).digest("hex").slice(0, 32);
}
type Registration = {
  id: string; telegram_id: string; name: string; email: string; phone: string; plan_tier: WebsiteRegistrationRow["planTier"];
  verified_at: Date | null; fulfilled_at: Date | null; whop_user_id: string | null;
  whop_checkout_id: string | null; link_expires_at: Date;
  code_hash: string | null; code_expires_at: Date | null; code_attempts: number;
};
class BillingError extends Error {
  constructor(public status: number, public label: string) { super(label); }
}
const limits = new Map<string, { at: number; count: number }>();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return next();
  if (req.get("origin") !== websiteOrigin() || req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "אפשר לבצע את הפעולה רק מתוך האתר." }); return;
  }
  const key = req.ip || "local";
  if (limits.size > 1024) limits.clear();
  const now = Date.now(), prior = limits.get(key);
  const limit = prior && now - prior.at < 60_000 ? prior : { at: now, count: 0 };
  limits.set(key, limit);
  if (++limit.count > 90) { res.status(429).json({ error: "רגע קטן, נסה שוב בעוד דקה." }); return; }
  next();
});

async function registration(req: Request): Promise<Registration | null> {
  const token = registrationSession(req);
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await pool.query(
    "SELECT * FROM public.ah_sheli_website_registrations WHERE session_hash=$1 AND session_expires_at>now()", [hash(token)]);
  return rows[0] ?? null;
}
async function requireRegistration(req: Request) {
  const value = await registration(req);
  if (!value) throw new BillingError(401, "כדי להמשיך, מלא את הפרטים וחבר את הטלגרם שלך.");
  return value;
}
async function responseStatus(reg: Registration, session: string) {
  const { rows } = await pool.query(
    "SELECT subscription_status,subscription_expires_at FROM public.ah_sheli_telegram_users WHERE telegram_user_id=$1", [reg.telegram_id]);
  const member = rows[0], expiry = member?.subscription_expires_at as Date | null;
  const active = member?.subscription_status === "active" && (!expiry || expiry.getTime() > Date.now());
  const { rows: paid } = reg.verified_at ? await pool.query(
    `SELECT r.plan_tier FROM public.ah_sheli_payment_grants g
     JOIN public.ah_sheli_website_registrations r ON r.id=g.registration_id
     WHERE g.telegram_id=$1 AND g.expires_at>now() ORDER BY g.expires_at DESC LIMIT 1`,
    [reg.telegram_id]) : { rows: [] };
  let state = !reg.verified_at ? "awaiting_telegram"
    : active && paid.length ? "active"
    : reg.plan_tier === "Basic" ? (active ? "active" : "pending_approval")
    : reg.fulfilled_at ? (active ? "active" : "expired")
    : reg.whop_checkout_id ? "checkout_pending" : "ready_for_checkout";
  const { rows: customer } = reg.verified_at ? await pool.query(
    `SELECT 1 FROM public.ah_sheli_website_registrations WHERE telegram_id=$1
     AND verified_at IS NOT NULL AND whop_membership_id IS NOT NULL LIMIT 1`, [reg.telegram_id]) : { rows: [] };
  const hasCustomer = customer.length > 0;
  const billing = billingStatus();
  return {
    state, plan_tier: state === "active" && paid.length ? paid[0].plan_tier : reg.plan_tier,
    telegram_url: reg.verified_at ? "https://t.me/AhSheli_Reminder_bot"
      : reg.link_expires_at.getTime() > Date.now()
        ? `https://t.me/AhSheli_Reminder_bot?start=web_${linkToken(session)}` : null,
    expires_at: reg.verified_at && expiry ? expiry.toISOString() : null,
    access_status: reg.verified_at ? (active ? "active" : member?.subscription_status ?? "pending") : null,
    billing_available: billing.ready,
    payment_mode: billing.liveMode ? "live" : "test",
    checkout_enabled: billing.checkoutEnabled,
    has_customer: hasCustomer,
    code_sent: !reg.verified_at && !!reg.code_hash && !!reg.code_expires_at
      && reg.code_expires_at.getTime() > Date.now() && reg.code_attempts < 5,
  };
}

router.post("/register-user", async (req, res) => {
  const parsed = RegisterWebsiteUserBody.strict().safeParse(req.body);
  if (!parsed.success) throw new BillingError(400, "בדוק שכל הפרטים מלאים ושהמזהה הוא המספר שקיבלת בטלגרם.");
  const input = parsed.data;
  if (BigInt(input.telegram_id) > BigInt(Number.MAX_SAFE_INTEGER)
    || input.name.trim().length < 2 || !/^\+?[0-9 ()-]{7,25}$/.test(input.phone)
    || input.phone.replace(/\D/g, "").length < 7 || input.phone.replace(/\D/g, "").length > 15) {
    throw new BillingError(400, "בדוק את השם, מספר הטלפון ומזהה הטלגרם.");
  }
  const session = randomBytes(32).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO public.ah_sheli_website_registrations
      (id,telegram_id,name,email,phone,plan_tier,session_hash,link_hash,link_expires_at,session_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '30 minutes',now()+interval '30 days') RETURNING *`,
    [randomUUID(), input.telegram_id, input.name.trim(), input.email.trim(), input.phone.trim(),
      input.plan_tier, hash(session), hash(linkToken(session))]);
  const cookie = registrationCookie(req);
  res.cookie(cookie.name, session, { ...cookie.options, maxAge: 30 * 86400_000 });
  res.status(201).json(await responseStatus(rows[0], session));
});
router.get("/registration", async (req, res) => {
  const reg = await registration(req);
  if (!reg) { res.status(404).json({ error: "אין הרשמה פתוחה בדפדפן הזה." }); return; }
  res.json(await responseStatus(reg, registrationSession(req)));
});
router.post("/registration/reset", (req, res) => {
  const cookie = registrationCookie(req);
  res.clearCookie(cookie.name, cookie.options);
  res.sendStatus(204);
});
router.post("/registration/verify", async (req, res) => {
  const parsed = VerifyWebsiteRegistrationBody.strict().safeParse(req.body);
  if (!parsed.success) throw new BillingError(400, "הזן את שמונה הספרות שקיבלת בהודעה הפרטית מהבוט.");
  const reg = await requireRegistration(req);
  if (reg.verified_at) { res.json(await responseStatus(reg, registrationSession(req))); return; }
  if (!process.env.SESSION_SECRET) throw new Error("website_session_secret_missing");
  const digest = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`website-code:${reg.id}:${parsed.data.code}`).digest("hex");
  // One atomic statement counts unsuccessful attempts too; errors cannot roll that count back.
  const { rows } = await pool.query(
    `UPDATE public.ah_sheli_website_registrations
     SET code_attempts=code_attempts+1,
       verified_at=CASE WHEN code_hash=$2 THEN now() ELSE verified_at END
     WHERE id=$1 AND verified_at IS NULL AND code_hash IS NOT NULL
       AND code_expires_at>now() AND code_attempts<5 RETURNING *`,
    [reg.id, digest]);
  if (!rows[0]) throw new BillingError(423, "צריך קוד חדש. פתח שוב את הקישור לבוט וקבל קוד חיבור.");
  if (!rows[0].verified_at) throw new BillingError(400, "הקוד לא מתאים. בדוק את ההודעה האחרונה שקיבלת מהבוט.");
  res.json(await responseStatus(rows[0], registrationSession(req)));
});
router.post("/checkout", async (req, res) => {
  const billing = billingStatus();
  if (!billing.checkoutEnabled) {
    throw new BillingError(503, billing.mode === "sandbox"
      ? "סביבת בדיקת התשלום עדיין אינה מוגדרת."
      : "פתיחת תשלומים חדשים מושבתת כרגע.");
  }
  const reg = await requireRegistration(req);
  if (!reg.verified_at) throw new BillingError(403, "קודם פתח את הבוט מהקישור ואמת שזה הטלגרם שלך.");
  if (!(reg.plan_tier in planAmounts)) throw new BillingError(400, "Basic חינמי וממתין לאישור בבוט, בלי תשלום.");
  const tier = reg.plan_tier as keyof typeof planAmounts;
  const price = await paidPrice(tier);
  if (!price) throw new BillingError(503, "התשלום עוד לא מוכן. נסה שוב בעוד רגע.");
  const whop = await getWhopClient();
  const client = await pool.connect();
  let url: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`website-billing:${reg.telegram_id}`]);
    const { rows: existing } = await client.query(
      `SELECT * FROM public.ah_sheli_website_registrations
       WHERE telegram_id=$1 AND verified_at IS NOT NULL AND whop_checkout_id IS NOT NULL
       ORDER BY created_at DESC`, [reg.telegram_id]);
    for (const prior of existing) {
      if (!prior.whop_membership_id) continue;
      const membership = await whop.memberships.retrieve({ id: prior.whop_membership_id });
      if (["active", "trialing", "past_due"].includes(membership.status))
        throw new BillingError(409, "כבר יש מנוי לחשבון הזה. אפשר לנהל אותו דרך כפתור ניהול המנוי.");
    }
    for (const prior of existing) {
      if (!prior.whop_checkout_id || prior.fulfilled_at || prior.plan_tier !== tier) continue;
      const open = await whop.checkoutConfigurations.retrieve({ id: prior.whop_checkout_id });
      if (open.plan?.id !== price || open.metadata?.registration_id !== prior.id) continue;
      url = whopUrl(open.purchase_url);
      break;
    }
    if (!url) {
      const checkout = await whop.checkoutConfigurations.create({
        account_id: whopCompanyId(), plan_id: price,
        metadata: { app: "ah_sheli", registration_id: reg.id, telegram_id: reg.telegram_id },
        redirect_url: `${websiteOrigin()}/?billing=success`,
      }, { idempotencyKey: `ah-sheli-checkout-${reg.id}` });
      url = whopUrl(checkout.purchase_url);
      await client.query(
        `UPDATE public.ah_sheli_website_registrations SET whop_checkout_id=$2,
          whop_plan_id=$3,expected_amount=$4 WHERE id=$1`,
        [reg.id, checkout.id, price, planAmounts[tier]]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (!url) throw new BillingError(503, "התשלום מתעכב. נסה שוב בעוד רגע.");
  res.json({ url });
});
router.post("/billing/portal", async (req, res) => {
  const reg = await requireRegistration(req);
  if (!reg.verified_at) throw new BillingError(403, "קודם מחברים את חשבון הטלגרם שלך.");
  const { rows } = await pool.query(
    `SELECT whop_membership_id,whop_user_id FROM public.ah_sheli_website_registrations
     WHERE telegram_id=$1 AND verified_at IS NOT NULL AND whop_membership_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`, [reg.telegram_id]);
  if (!rows[0]) throw new BillingError(404, "עוד לא נפתח מנוי בתשלום לחשבון הזה.");
  const whop = await getWhopClient();
  const membership = await whop.memberships.retrieve({ id: rows[0].whop_membership_id });
  if (membership.user_id !== rows[0].whop_user_id || membership.account.id !== whopCompanyId())
    throw new BillingError(403, "המנוי לא תואם לחשבון המחובר.");
  // Hosted Whop billing requires the buyer's Whop login, not a customer-supplied ID.
  const manage = (membership as unknown as { manage_url?: string }).manage_url;
  res.json({ url: whopUrl(manage || "https://whop.com/@me/settings/orders/") });
});
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BillingError) { res.status(error.status).json({ error: error.label }); return; }
  req.log.warn({ code: "website_billing_failed" }, "Website billing request failed");
  res.status(503).json({ error: "יש עיכוב בחיבור. הפרטים נשמרו; נסה שוב בעוד רגע." });
});
export default router;
