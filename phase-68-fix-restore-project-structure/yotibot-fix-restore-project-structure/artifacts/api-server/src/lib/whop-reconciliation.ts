import { whopPaymentProof } from "./payment-policy.ts";

type ReconciliationDependencies = {
  pool: any;
  company: string;
  getClient: () => Promise<any>;
  sendPaymentConfirmations: () => Promise<unknown>;
  now?: () => number;
};

export async function reconcileWhopPayments({
  pool,
  company,
  getClient,
  sendPaymentConfirmations,
  now = Date.now,
}: ReconciliationDependencies) {
  if (!company) throw new Error("whop_company_missing");
  const { rows } = await pool.query(`SELECT * FROM public.ah_sheli_website_registrations
    WHERE verified_at IS NOT NULL AND whop_checkout_id IS NOT NULL AND
      (fulfilled_at IS NULL OR whop_membership_id IS NOT NULL)
    ORDER BY created_at DESC`);
  let applied = 0;
  if (rows.length) {
    const client = await getClient();
    let after: string | undefined;
    do {
      const page = await client.payments.list({
        account_id: company,
        status: "paid",
        first: 100,
        direction: "desc",
        order: "created_at",
        after,
      });
      let allSeen = page.data.length > 0;
      for (const payment of page.data) {
        const { rows: receipt } = await pool.query(
          "SELECT 1 FROM public.ah_sheli_payment_grants WHERE invoice_id=$1",
          [`whop:${payment.id}`],
        );
        if (receipt.length) continue;
        allSeen = false;
        const pay = payment as Record<string, any>;
        const membershipId = pay.membership_id ?? pay.membership?.id;
        const checkoutId = pay.checkout_configuration_id ?? pay.checkout_configuration?.id;
        const reg = rows.find((row: Record<string, any>) =>
          row.whop_membership_id === membershipId || row.whop_checkout_id === checkoutId);
        if (!reg || !membershipId) continue;
        const membership = await client.memberships.retrieve({ id: membershipId });
        const proof = whopPaymentProof(pay, membership as Record<string, any>, reg, company);
        if (!proof || proof.expiresAt.getTime() <= now()) continue;
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const { rows: locked } = await db.query(
            "SELECT * FROM public.ah_sheli_website_registrations WHERE id=$1 FOR UPDATE",
            [reg.id],
          );
          if (!locked[0]?.verified_at
            || !whopPaymentProof(pay, membership as Record<string, any>, locked[0], company)) {
            throw new Error("whop_identity_changed");
          }
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
            applied++;
          }
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        } finally {
          db.release();
        }
      }
      after = allSeen || !page.hasNextPage()
        ? undefined
        : page.response.page_info.end_cursor ?? undefined;
    } while (after);
  }
  await sendPaymentConfirmations();
  return applied;
}
