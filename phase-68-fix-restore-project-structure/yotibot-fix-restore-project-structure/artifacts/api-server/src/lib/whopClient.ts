import { WhopClient } from "@whop/sdk";
import { whopApiBaseUrl, whopCompanyId, whopMode, whopSandboxClientOptions } from "./whop-config";

// Server only. Explicit credentials take precedence; never mix provider accounts.
export async function getWhopClient() {
  const mode = whopMode();
  if (mode === "sandbox") {
    // Never fall back to the live Replit connector or WHOP_API_KEY in sandbox.
    return new WhopClient({
      ...whopSandboxClientOptions(),
      apiVersionDate: "2026-09-29",
      timeoutInSeconds: 15,
      maxRetries: 1,
    });
  }
  let token = process.env.WHOP_API_KEY;
  if (!token) {
    const host = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const identity = process.env.REPL_IDENTITY ? `repl ${process.env.REPL_IDENTITY}`
      : process.env.WEB_REPL_RENEWAL ? `depl ${process.env.WEB_REPL_RENEWAL}` : null;
    if (!host || !identity) throw new Error("whop_connection_unavailable");
    const response = await fetch(`https://${host}/api/v2/connection?include_secrets=true&connector_names=whop`, {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: identity },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("whop_connection_unavailable");
    const data = await response.json() as { items?: { settings?: { api_key?: string; company_id?: string } }[] };
    const settings = data.items?.[0]?.settings;
    if (settings?.company_id !== whopCompanyId()) throw new Error("whop_account_mismatch");
    token = settings?.api_key;
  }
  if (!token) throw new Error("whop_credentials_unavailable");
  return new WhopClient({
    token,
    baseUrl: whopApiBaseUrl(),
    apiVersionDate: "2026-09-29",
    timeoutInSeconds: 15,
    maxRetries: 1,
  });
}
