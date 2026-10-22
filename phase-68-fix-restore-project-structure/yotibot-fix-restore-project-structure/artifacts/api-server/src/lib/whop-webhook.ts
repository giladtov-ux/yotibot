import { unwrapWebhook } from "@whop/sdk/helpers";

export async function processVerifiedWhopWebhook(
  payload: Buffer,
  headers: Record<string, string>,
  key: string | undefined,
  reconcile: () => Promise<unknown>,
) {
  if (!Buffer.isBuffer(payload) || !key?.trim() || !headers["webhook-signature"]?.trim()) {
    throw new Error("webhook_unavailable");
  }
  const event = unwrapWebhook<{ type?: string }>(payload.toString("utf8"), { headers, key });
  // A signed notification is only a trigger; reconciliation verifies payment with Whop.
  if (event.type === "payment.succeeded") await reconcile();
}
