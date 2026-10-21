import { billingFailureKind, type BillingFailureKind } from "./whop-errors";

export const BILLING_ALERT_DELAY_MS = 10 * 60_000;
export const BILLING_ALERT_COOLDOWN_MS = 60 * 60_000;
const SIGNATURE_QUIET_MS = 30 * 60_000;
export type BillingAlertSource = "initialization" | "reconciliation" | "verification" | "webhook_setup" | "webhook_signature";
type Incident = { source: BillingAlertSource; kind: BillingFailureKind; firstAt: number; lastAt: number; count: number };
export type BillingAlertState = { incidents: Record<string, Incident>; lastAttemptAt: number | null };
export interface BillingAlertStore {
  update<T>(operation: (state: BillingAlertState, owner: string | null) => T): Promise<T>;
}
export function emptyBillingAlertState(): BillingAlertState {
  return { incidents: {}, lastAttemptAt: null };
}

const labels: Record<BillingFailureKind, string> = {
  temporary: "תקלה זמנית בחיבור או בעיבוד — יש לבדוק את זמינות השירות.",
  permission: "הרשאה או הגדרת סליקה חסרה — יש לבדוק את חיבור Whop והרשאותיו.",
  signature: "כשל באימות חתימת webhook — יש לבדוק את הגדרת החתימה; האירועים נדחו.",
};

export function createBillingAlerts({ store, send, now = Date.now, warn }: {
  store: BillingAlertStore;
  send: (owner: string, text: string) => Promise<void>;
  now?: () => number;
  warn: () => void;
}) {
  // Monitoring must never prevent billing retries or change paid access.
  async function safely(operation: () => Promise<void>) {
    try { await operation(); } catch { warn(); }
  }
  return {
    failure: (source: BillingAlertSource, error: unknown) => safely(async () => {
      const at = now(), kind = billingFailureKind(error);
      await store.update(state => {
        const key = `${source}:${kind}`;
        const incident = state.incidents[key];
        if (incident && !(source === "webhook_signature" && at - incident.lastAt >= SIGNATURE_QUIET_MS)) {
          incident.lastAt = at;
          incident.count = Math.min(incident.count + 1, 1_000_000_000);
        } else state.incidents[key] = { source, kind, firstAt: at, lastAt: at, count: 1 };
      });
    }),
    healthy: (source: BillingAlertSource) => safely(async () => {
      await store.update(state => {
        for (const [key, incident] of Object.entries(state.incidents)) {
          if (incident.source === source) delete state.incidents[key];
        }
      });
    }),
    flush: () => safely(async () => {
      const at = now();
      const alert = await store.update((state, owner) => {
        for (const [key, incident] of Object.entries(state.incidents)) {
          // A lone bad signature (often internet noise) is not an outage.
          if (incident.source === "webhook_signature" && at - incident.lastAt >= SIGNATURE_QUIET_MS)
            delete state.incidents[key];
        }
        const overdue = Object.values(state.incidents).filter(incident =>
          at - incident.firstAt >= BILLING_ALERT_DELAY_MS
          && (incident.source !== "webhook_signature" || incident.count >= 3));
        if (!owner || !overdue.length
          || state.lastAttemptAt !== null && at - state.lastAttemptAt < BILLING_ALERT_COOLDOWN_MS) return null;
        const lines = (["temporary", "permission", "signature"] as const).flatMap(kind => {
          const incidents = overdue.filter(incident => incident.kind === kind);
          if (!incidents.length) return [];
          const minutes = Math.floor((at - Math.min(...incidents.map(incident => incident.firstAt))) / 60_000);
          return [`• ${labels[kind]} משך: ${minutes} דקות; כשלים שנצפו: ${incidents.reduce((sum, incident) => sum + incident.count, 0)}.`];
        });
        // Reserve before network I/O, across workers and restarts. An uncertain
        // Telegram result must not trigger immediate automatic replay.
        state.lastAttemptAt = at;
        return { owner, text: `התראת סליקה פרטית — Whop\n${lines.join("\n")}\nהמספרים הם כשלים טכניים, לא מספר לקוחות או תשלומים.\nניסיונות האימות האוטומטיים ממשיכים. כשל באימות אינו מעניק או משנה גישה.` };
      });
      if (alert) await send(alert.owner, alert.text);
    }),
  };
}
