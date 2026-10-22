import test from "node:test";
import assert from "node:assert/strict";
import {
  billingCheckoutEnabled,
  hasWhopSandboxConfiguration,
  whopApiBaseUrl,
  whopCompanyId,
  whopMode,
  whopPlanId,
  whopSandboxClientOptions,
} from "../src/lib/whop-config.ts";

const sandbox = {
  NODE_ENV: "development",
  WHOP_MODE: "live",
  WHOP_API_KEY: "live-key-must-not-be-used",
  WHOP_COMPANY_ID: "biz_live",
  WHOP_SANDBOX_API_KEY: "sandbox-key",
  WHOP_SANDBOX_COMPANY_ID: "biz_test",
  WHOP_SANDBOX_PRO_PLAN_ID: "plan_test_pro",
  WHOP_SANDBOX_UNLIMITED_PLAN_ID: "plan_test_unlimited",
};

test("Staging is forced to Whop sandbox even if WHOP_MODE says live", () => {
  assert.equal(whopMode(sandbox), "sandbox");
  assert.equal(whopApiBaseUrl(sandbox), "https://sandbox-api.whop.com/api/v1");
  assert.equal(whopCompanyId(sandbox), "biz_test");
  assert.equal(whopPlanId("Pro", sandbox), "plan_test_pro");
  assert.equal(whopPlanId("Unlimited", sandbox), "plan_test_unlimited");
  assert.deepEqual(whopSandboxClientOptions(sandbox), {
    token: "sandbox-key",
    baseUrl: "https://sandbox-api.whop.com/api/v1",
  });
  assert.throws(() => whopSandboxClientOptions({
    ...sandbox, WHOP_SANDBOX_API_KEY: undefined,
  }), /whop_sandbox_api_key_missing/u);
});

test("Staging checkout stays disabled until all dedicated sandbox values exist", () => {
  assert.equal(billingCheckoutEnabled({ ...sandbox, WHOP_SANDBOX_API_KEY: undefined }), false);
  assert.equal(billingCheckoutEnabled({ ...sandbox, WHOP_SANDBOX_COMPANY_ID: undefined }), false);
  assert.equal(hasWhopSandboxConfiguration(sandbox), true);
  assert.equal(billingCheckoutEnabled(sandbox), true);
});

test("checkout kill switch disables sales but does not change provider mode", () => {
  const disabled = { ...sandbox, BILLING_CHECKOUTS_ENABLED: "false" };
  assert.equal(whopMode(disabled), "sandbox");
  assert.equal(billingCheckoutEnabled(disabled), false);
});

test("Production stays live by default and the code-level switch can stop new checkout", () => {
  const live = {
    NODE_ENV: "production",
    WHOP_API_KEY: "live-key",
    WHOP_COMPANY_ID: "biz_live",
  };
  assert.equal(whopMode(live), "live");
  assert.equal(whopApiBaseUrl(live), "https://api.whop.com/api/v1");
  assert.equal(billingCheckoutEnabled(live), true);
  assert.equal(billingCheckoutEnabled({ ...live, BILLING_CHECKOUTS_ENABLED: "false" }), false);
});
