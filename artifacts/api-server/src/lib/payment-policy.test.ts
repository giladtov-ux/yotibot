import test from "node:test";
import assert from "node:assert/strict";
import { whopPaymentProof, whopUrl } from "./payment-policy";
const reg = { id: "registration", whop_checkout_id: "ch_example", whop_plan_id: "plan_example", expected_amount: 2900 };
const member = { id: "mem_example", account: { id: "biz_example" }, plan_id: "plan_example", user_id: "user_example", status: "active" };
const pay = { id: "pay_example", account_id: "biz_example", checkout_configuration_id: "ch_example",
  membership_id: "mem_example", plan_id: "plan_example", user: { id: "user_example" },
  status: "paid", currency: "ils", total: { amount: "29.00", currency: "ils" },
  paid_at: new Date(Date.now() - 60_000).toISOString(), metadata: { registration_id: "registration" } };
test("verified payment grants exactly 30 days from actual payment", () => {
  const proof = whopPaymentProof(pay, member, reg, "biz_example");
  assert.equal(proof!.expiresAt.getTime(), Date.parse(pay.paid_at) + 30 * 86_400_000);
});
test("unpaid, discounted, refunded and mismatched purchases never grant access", () => {
  for (const change of [
    { status: "pending" }, { total: { amount: "1.00", currency: "ils" } },
    { subtotal: { amount: "29.00", currency: "ils" }, total: { amount: "1.00", currency: "ils" } }, { currency: "usd" },
    { refunded_at: new Date().toISOString() }, { checkout_configuration_id: "ch_other" },
    { account_id: "biz_other" }, { plan_id: "plan_other" }, { metadata: { registration_id: "other" } },
    { paid_at: "" }, { user: { id: "user_other" } },
  ]) assert.equal(whopPaymentProof({ ...pay, ...change }, member, reg, "biz_example"), null);
});
test("renewals require the already-bound buyer and membership", () => {
  const linked = { ...reg, whop_membership_id: member.id, whop_user_id: member.user_id };
  assert.ok(whopPaymentProof({ ...pay, checkout_configuration_id: null }, member, linked, "biz_example"));
  assert.equal(whopPaymentProof(pay, member, { ...linked, whop_user_id: "user_other" }, "biz_example"), null);
  assert.equal(whopPaymentProof(pay, { ...member, status: "canceled" }, linked, "biz_example"), null);
});
test("redirects stay on HTTPS Whop domains", () => {
  assert.equal(whopUrl("https://whop.com/checkout/ch_example"), "https://whop.com/checkout/ch_example");
  for (const url of ["http://whop.com", "https://whop.com.evil.test", "https://user:pass@whop.com"])
    assert.throws(() => whopUrl(url));
});
