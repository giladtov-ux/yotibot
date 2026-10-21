import { pool } from "@workspace/db";
import { logger } from "./logger";
import { createBillingAlerts, emptyBillingAlertState, type BillingAlertState, type BillingAlertStore } from "./billing-alerts";

const KEY = "whop_billing_alerts";
const store: BillingAlertStore = {
  async update(operation) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`INSERT INTO public.ah_sheli_config(key,value) VALUES($1,$2)
        ON CONFLICT(key) DO NOTHING`, [KEY, JSON.stringify(emptyBillingAlertState())]);
      const { rows } = await db.query("SELECT value FROM public.ah_sheli_config WHERE key=$1 FOR UPDATE", [KEY]);
      const state = JSON.parse(rows[0].value) as BillingAlertState;
      const { rows: owners } = await db.query("SELECT value FROM public.ah_sheli_config WHERE key='allowed_chat_id'");
      // Same trusted owner source as the bot. Never target a group, a buyer,
      // a request parameter or an arbitrary user marked as an administrator.
      const owner = owners[0]?.value ?? process.env.TELEGRAM_ALLOWED_CHAT_ID;
      const privateOwner = typeof owner === "string" && /^[1-9]\d{0,15}$/.test(owner.trim()) ? owner.trim() : null;
      const result = operation(state, privateOwner);
      await db.query("UPDATE public.ah_sheli_config SET value=$2 WHERE key=$1", [KEY, JSON.stringify(state)]);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally { db.release(); }
  },
};

export const billingAlerts = createBillingAlerts({
  store,
  send: async (owner, text) => {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: owner, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { ok?: boolean };
    if (!response.ok || result.ok !== true) throw new Error("billing_alert_delivery_failed");
  },
  warn: () => logger.warn({ code: "billing_alert_unavailable" }, "Private billing alert could not be recorded or delivered"),
});

let alertTimer: NodeJS.Timeout | undefined;
export function startBillingAlerts() {
  // Preview must not send operational alerts to the live owner's chat or
  // reserve production delivery slots.
  if (process.env.NODE_ENV !== "production" || !process.env.TELEGRAM_BOT_TOKEN) return;
  alertTimer ??= setInterval(() => void billingAlerts.flush(), 30_000);
  alertTimer.unref();
}
