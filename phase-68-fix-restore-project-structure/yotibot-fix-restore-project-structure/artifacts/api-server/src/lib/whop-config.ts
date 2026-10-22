export type WhopMode = "sandbox" | "live";

const SANDBOX_API_BASE_URL = "https://sandbox-api.whop.com/api/v1";
const LIVE_API_BASE_URL = "https://api.whop.com/api/v1";

export function whopMode(env: NodeJS.ProcessEnv = process.env): WhopMode {
  // Development/Staging must never be redirected to the live Whop API.
  if (env.NODE_ENV !== "production") return "sandbox";
  return env.WHOP_MODE === "sandbox" ? "sandbox" : "live";
}

export function whopApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return whopMode(env) === "sandbox" ? SANDBOX_API_BASE_URL : LIVE_API_BASE_URL;
}

export function whopCompanyId(env: NodeJS.ProcessEnv = process.env) {
  return whopMode(env) === "sandbox"
    ? env.WHOP_SANDBOX_COMPANY_ID?.trim()
    : env.WHOP_COMPANY_ID?.trim();
}

export function whopPlanId(tier: "Pro" | "Unlimited", env: NodeJS.ProcessEnv = process.env) {
  if (whopMode(env) === "sandbox") {
    return (tier === "Pro" ? env.WHOP_SANDBOX_PRO_PLAN_ID : env.WHOP_SANDBOX_UNLIMITED_PLAN_ID)?.trim();
  }
  return (tier === "Pro" ? env.WHOP_PRO_PLAN_ID : env.WHOP_UNLIMITED_PLAN_ID)?.trim();
}

export function hasWhopSandboxConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.WHOP_SANDBOX_API_KEY?.trim()
    && env.WHOP_SANDBOX_COMPANY_ID?.trim()
    && env.WHOP_SANDBOX_PRO_PLAN_ID?.trim()
    && env.WHOP_SANDBOX_UNLIMITED_PLAN_ID?.trim(),
  );
}

export function billingCheckoutEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.BILLING_CHECKOUTS_ENABLED?.trim().toLowerCase() === "false") return false;
  if (whopMode(env) === "sandbox") return hasWhopSandboxConfiguration(env);
  return true;
}

export function whopSandboxApiKey(env: NodeJS.ProcessEnv = process.env) {
  return env.WHOP_SANDBOX_API_KEY?.trim();
}

export function whopSandboxClientOptions(env: NodeJS.ProcessEnv = process.env) {
  const token = whopSandboxApiKey(env);
  if (!token) throw new Error("whop_sandbox_api_key_missing");
  if (!whopCompanyId(env)) throw new Error("whop_sandbox_company_missing");
  return { token, baseUrl: whopApiBaseUrl(env) };
}
