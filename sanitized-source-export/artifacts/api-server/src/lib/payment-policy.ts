type Value = Record<string, any>;
function cents(value: unknown): number | null {
  const amount = typeof value === "object" && value !== null ? (value as Value).amount : value;
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(amount))) return null;
  const result = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(result) ? result : null;
}
export function whopPaymentProof(payment: Value, membership: Value, registration: Value, company: string) {
  const account = payment.account_id ?? payment.company?.id;
  const plan = payment.plan_id ?? payment.plan?.id;
  const memberPlan = membership.plan_id ?? membership.plan?.id;
  const memberAccount = membership.account?.id ?? membership.company?.id;
  const memberId = payment.membership_id ?? payment.membership?.id;
  const user = payment.user?.id ?? membership.user_id ?? membership.user?.id;
  const memberUser = membership.user_id ?? membership.user?.id;
  const total = cents(payment.total);
  if (payment.status !== "paid" || account !== company || memberAccount !== company
    || plan !== registration.whop_plan_id || memberPlan !== plan || memberId !== membership.id
    || !user || memberUser !== user || membership.status !== "active" || membership.valid === false
    || payment.refunded_at || (cents(payment.refunded_amount) ?? 0) > 0
    || payment.currency !== "ils" || total === null || total < Number(registration.expected_amount)
    || cents(payment.subtotal ?? payment.total) !== Number(registration.expected_amount)
    || payment.total?.currency && payment.total.currency !== "ils"
    || payment.subtotal?.currency && payment.subtotal.currency !== "ils") return null;
  const checkout = payment.checkout_configuration_id ?? payment.checkout_configuration?.id;
  if (registration.whop_membership_id) {
    if (registration.whop_membership_id !== membership.id || registration.whop_user_id !== user) return null;
  } else if (checkout !== registration.whop_checkout_id
    || payment.metadata?.registration_id !== registration.id) return null;
  const paidAt = typeof payment.paid_at === "string" ? Date.parse(payment.paid_at) : NaN;
  if (!Number.isFinite(paidAt) || paidAt > Date.now() + 5 * 60_000) return null;
  return { expiresAt: new Date(paidAt + 30 * 86_400_000), userId: String(user), membershipId: String(membership.id) };
}
export function whopUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("whop_url_missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password
    || !(url.hostname === "whop.com" || url.hostname.endsWith(".whop.com"))) throw new Error("whop_url_invalid");
  return url.toString();
}
