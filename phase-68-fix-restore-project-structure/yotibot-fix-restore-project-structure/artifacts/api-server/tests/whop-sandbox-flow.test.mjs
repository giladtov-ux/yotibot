import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  billingCheckoutEnabled,
  whopApiBaseUrl,
  whopMode,
} from "../src/lib/whop-config.ts";
import { getWhopClient } from "../src/lib/whopClient.ts";
import { createWhopCheckout } from "../src/lib/whop-checkout.ts";
import { processVerifiedWhopWebhook } from "../src/lib/whop-webhook.ts";
import { reconcileWhopPayments } from "../src/lib/whop-reconciliation.ts";

const sandboxEnv = {
  NODE_ENV: "development",
  WHOP_MODE: "live",
  WHOP_API_KEY: "synthetic-live-sentinel-not-a-credential",
  REPLIT_CONNECTORS_HOSTNAME: "must-not-be-contacted.invalid",
  REPL_IDENTITY: "synthetic-identity",
  WHOP_SANDBOX_API_KEY: "synthetic-sandbox-token",
  WHOP_SANDBOX_COMPANY_ID: "biz_sandbox_fixture",
  WHOP_SANDBOX_PRO_PLAN_ID: "plan_sandbox_pro_fixture",
  WHOP_SANDBOX_UNLIMITED_PLAN_ID: "plan_sandbox_unlimited_fixture",
};

test("sandbox checkout constructs only a sandbox client and intercepts checkout creation", async () => {
  const constructors = [];
  const providerCalls = [];
  let connectorCalls = 0;
  const fakeClient = {
    checkoutConfigurations: {
      create: async (...args) => {
        providerCalls.push(args);
        return {
          id: "checkout_sandbox_fixture",
          purchase_url: "https://checkout.whop.com/sandbox-fixture",
        };
      },
    },
  };
  const client = await getWhopClient(
    sandboxEnv,
    options => {
      constructors.push(options);
      return fakeClient;
    },
    async () => {
      connectorCalls++;
      throw new Error("connector fetch must not run in sandbox");
    },
  );

  assert.equal(whopMode(sandboxEnv), "sandbox");
  assert.equal(whopApiBaseUrl(sandboxEnv), "https://sandbox-api.whop.com/api/v1");
  assert.equal(billingCheckoutEnabled(sandboxEnv), true);
  assert.equal(client, fakeClient);
  assert.equal(constructors.length, 1);
  assert.equal(constructors[0].token, "synthetic-sandbox-token");
  assert.equal(constructors[0].baseUrl, "https://sandbox-api.whop.com/api/v1");
  assert.equal("WHOP_API_KEY" in constructors[0], false);
  assert.equal(connectorCalls, 0);

  const checkout = await createWhopCheckout(client, {
    companyId: sandboxEnv.WHOP_SANDBOX_COMPANY_ID,
    planId: sandboxEnv.WHOP_SANDBOX_PRO_PLAN_ID,
    registration: { id: "registration-fixture", telegram_id: "9000001" },
    redirectUrl: "https://staging.example.invalid/?billing=success",
  });
  assert.deepEqual(checkout, {
    id: "checkout_sandbox_fixture",
    url: "https://checkout.whop.com/sandbox-fixture",
  });
  assert.equal(providerCalls.length, 1);
  assert.deepEqual(providerCalls[0], [
    {
      account_id: "biz_sandbox_fixture",
      plan_id: "plan_sandbox_pro_fixture",
      metadata: {
        app: "ah_sheli",
        registration_id: "registration-fixture",
        telegram_id: "9000001",
      },
      redirect_url: "https://staging.example.invalid/?billing=success",
    },
    { idempotencyKey: "ah-sheli-checkout-registration-fixture" },
  ]);
});

test("missing sandbox configuration fails closed before client or checkout creation", async () => {
  const noSandboxKey = { ...sandboxEnv, WHOP_SANDBOX_API_KEY: undefined };
  let clientCreations = 0;
  let connectorCalls = 0;
  assert.equal(billingCheckoutEnabled(noSandboxKey), false);
  await assert.rejects(
    getWhopClient(noSandboxKey, () => {
      clientCreations++;
      return {};
    }, async () => {
      connectorCalls++;
      throw new Error("must not fall back to connector");
    }),
    /whop_sandbox_api_key_missing/u,
  );
  assert.equal(clientCreations, 0);
  assert.equal(connectorCalls, 0);

  assert.equal(
    billingCheckoutEnabled({ ...sandboxEnv, BILLING_CHECKOUTS_ENABLED: "false" }),
    false,
  );
});

function signedWebhook(event, key) {
  const payload = Buffer.from(JSON.stringify(event));
  const id = "msg_sandbox_fixture";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signedContent = `${id}.${timestamp}.${payload.toString("utf8")}`;
  const signature = createHmac("sha256", key).update(signedContent).digest("base64");
  return {
    payload,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  };
}

test("only a correctly signed payment.succeeded webhook triggers reconciliation", async () => {
  const key = "synthetic-sandbox-webhook-key";
  const signed = signedWebhook({ type: "payment.succeeded", id: "event_fixture" }, key);
  let reconciliations = 0;
  await processVerifiedWhopWebhook(signed.payload, signed.headers, key, async () => {
    reconciliations++;
  });
  assert.equal(reconciliations, 1);

  const nonPayment = signedWebhook({ type: "membership.updated" }, key);
  await processVerifiedWhopWebhook(nonPayment.payload, nonPayment.headers, key, async () => {
    reconciliations++;
  });
  assert.equal(reconciliations, 1);
});

test("missing webhook configuration and invalid signatures fail closed without reconciliation", async () => {
  const key = "synthetic-sandbox-webhook-key";
  const signed = signedWebhook({ type: "payment.succeeded" }, key);
  let reconciliations = 0;
  const reconcile = async () => { reconciliations++; };

  await assert.rejects(
    processVerifiedWhopWebhook(signed.payload, {}, key, reconcile),
    /webhook_unavailable/u,
  );
  await assert.rejects(
    processVerifiedWhopWebhook(signed.payload, signed.headers, undefined, reconcile),
    /webhook_unavailable/u,
  );
  await assert.rejects(
    processVerifiedWhopWebhook(
      signed.payload,
      { ...signed.headers, "webhook-signature": "v1,invalid-fixture-signature" },
      key,
      reconcile,
    ),
  );
  assert.equal(reconciliations, 0);
});

function fixtureRegistration() {
  return {
    id: "registration_sandbox_fixture",
    telegram_id: "9000001",
    verified_at: new Date("2026-10-01T00:00:00.000Z"),
    fulfilled_at: null,
    whop_checkout_id: "checkout_sandbox_fixture",
    whop_plan_id: "plan_sandbox_pro_fixture",
    whop_membership_id: null,
    whop_user_id: null,
    expected_amount: 3000,
  };
}

function fixturePayment() {
  return {
    id: "payment_sandbox_fixture",
    status: "paid",
    account_id: "biz_sandbox_fixture",
    plan_id: "plan_sandbox_pro_fixture",
    membership_id: "membership_sandbox_fixture",
    checkout_configuration_id: "checkout_sandbox_fixture",
    metadata: { registration_id: "registration_sandbox_fixture" },
    user: { id: "user_sandbox_fixture" },
    currency: "ils",
    total: { amount: "30.00", currency: "ils" },
    subtotal: { amount: "30.00", currency: "ils" },
    paid_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

function fixtureMembership() {
  return {
    id: "membership_sandbox_fixture",
    status: "active",
    valid: true,
    account: { id: "biz_sandbox_fixture" },
    plan_id: "plan_sandbox_pro_fixture",
    user_id: "user_sandbox_fixture",
  };
}

function fakePool(initialRegistration) {
  const state = {
    registration: structuredClone(initialRegistration),
    receipts: new Set(),
    transactions: [],
    subscriptionGrants: 0,
    queryLog: [],
  };
  const pool = {
    async query(sql, args = []) {
      state.queryLog.push({ sql, args });
      if (sql.includes("FROM public.ah_sheli_website_registrations")
        && sql.includes("ORDER BY created_at DESC")) {
        return { rows: [structuredClone(state.registration)] };
      }
      if (sql.includes("FROM public.ah_sheli_payment_grants WHERE invoice_id=$1")) {
        return { rows: state.receipts.has(args[0]) ? [{ invoice_id: args[0] }] : [] };
      }
      assert.fail(`Unexpected fake pool query: ${sql}`);
    },
    async connect() {
      let stagedReceipt;
      let stagedRegistration;
      const connection = {
        async query(sql, args = []) {
          state.queryLog.push({ sql, args });
          if (sql === "BEGIN") {
            stagedRegistration = structuredClone(state.registration);
            return { rows: [] };
          }
          if (sql.includes("FROM public.ah_sheli_website_registrations WHERE id=$1 FOR UPDATE")) {
            return { rows: [structuredClone(stagedRegistration)] };
          }
          if (sql.includes("INSERT INTO public.ah_sheli_payment_grants")) {
            const [invoiceId] = args;
            if (state.receipts.has(invoiceId)) return { rows: [], rowCount: 0 };
            stagedReceipt = invoiceId;
            return { rows: [{ invoice_id: invoiceId }], rowCount: 1 };
          }
          if (sql.includes("UPDATE public.ah_sheli_telegram_users")) {
            state.subscriptionGrants++;
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("UPDATE public.ah_sheli_website_registrations")) {
            stagedRegistration.whop_user_id = args[1];
            stagedRegistration.whop_membership_id = args[2];
            stagedRegistration.fulfilled_at ??= new Date("2026-10-22T00:00:00.000Z");
            return { rows: [], rowCount: 1 };
          }
          if (sql === "COMMIT") {
            if (stagedReceipt) state.receipts.add(stagedReceipt);
            state.registration = stagedRegistration;
            state.transactions.push("COMMIT");
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            state.transactions.push("ROLLBACK");
            return { rows: [] };
          }
          assert.fail(`Unexpected fake transaction query: ${sql}`);
        },
        release() {},
      };
      return connection;
    },
  };
  return { pool, state };
}

test("sandbox reconciliation grants one verified payment and suppresses its duplicate", async () => {
  const { pool, state } = fakePool(fixtureRegistration());
  const payment = fixturePayment();
  let paymentListCalls = 0;
  let membershipCalls = 0;
  let confirmations = 0;
  const client = {
    payments: {
      list: async request => {
        paymentListCalls++;
        assert.equal(request.account_id, "biz_sandbox_fixture");
        assert.equal(request.status, "paid");
        return {
          data: [payment],
          hasNextPage: () => false,
          response: { page_info: { end_cursor: undefined } },
        };
      },
    },
    memberships: {
      retrieve: async ({ id }) => {
        membershipCalls++;
        assert.equal(id, "membership_sandbox_fixture");
        return fixtureMembership();
      },
    },
  };
  const dependencies = {
    pool,
    company: "biz_sandbox_fixture",
    getClient: async () => client,
    sendPaymentConfirmations: async () => { confirmations++; },
    now: () => Date.now(),
  };

  assert.equal(await reconcileWhopPayments(dependencies), 1);
  assert.equal(await reconcileWhopPayments(dependencies), 0);
  assert.deepEqual([...state.receipts], ["whop:payment_sandbox_fixture"]);
  assert.equal(state.subscriptionGrants, 1);
  assert.equal(state.registration.whop_membership_id, "membership_sandbox_fixture");
  assert.ok(state.registration.fulfilled_at);
  assert.deepEqual(state.transactions, ["COMMIT"]);
  assert.equal(paymentListCalls, 2);
  assert.equal(membershipCalls, 1);
  assert.equal(confirmations, 2);
  assert.ok(state.queryLog.some(({ sql }) => /ON CONFLICT\(invoice_id\) DO NOTHING/u.test(sql)));
});

test("unverified sandbox payment and unavailable provider do not grant access", async () => {
  const { pool, state } = fakePool(fixtureRegistration());
  const payment = { ...fixturePayment(), account_id: "different_sandbox_account" };
  let confirmations = 0;
  const client = {
    payments: {
      list: async () => ({
        data: [payment],
        hasNextPage: () => false,
        response: { page_info: { end_cursor: undefined } },
      }),
    },
    memberships: { retrieve: async () => fixtureMembership() },
  };
  assert.equal(await reconcileWhopPayments({
    pool,
    company: "biz_sandbox_fixture",
    getClient: async () => client,
    sendPaymentConfirmations: async () => { confirmations++; },
  }), 0);
  assert.equal(state.receipts.size, 0);
  assert.equal(state.subscriptionGrants, 0);
  assert.deepEqual(state.transactions, []);
  assert.equal(confirmations, 1);

  const before = state.queryLog.length;
  await assert.rejects(reconcileWhopPayments({
    pool,
    company: "biz_sandbox_fixture",
    getClient: async () => ({
      payments: { list: async () => { throw new Error("synthetic sandbox outage"); } },
    }),
    sendPaymentConfirmations: async () => assert.fail("must not notify after reconciliation error"),
  }), /synthetic sandbox outage/u);
  assert.equal(state.receipts.size, 0);
  assert.equal(state.queryLog.length, before + 1);
});
