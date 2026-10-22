import { WhopClient } from "@whop/sdk";
import { whopApiBaseUrl, whopCompanyId, whopMode, whopSandboxClientOptions } from "./whop-config.ts";

// Server only. Explicit credentials take precedence; never mix provider accounts.
type WhopClientFactory = (options: ConstructorParameters<typeof WhopClient>[0]) => WhopClient;

export async function getWhopClient(
  env: NodeJS.ProcessEnv = process.env,
  createClient: WhopClientFactory = options => new WhopClient(options),
  connectorFetch: typeof fetch = fetch,
) {
  const mode = whopMode(env);
  if (mode === "sandbox") {
    // Never fall back to the live Replit connector or WHOP_API_KEY in sandbox.
    return createClient({
      ...whopSandboxClientOptions(env),
      apiVersionDate: "2026-09-29",
      timeoutInSeconds: 15,
      maxRetries: 1,
    });
  }
  let token = env.WHOP_API_KEY;
  if (!token) {
    const host = env.REPLIT_CONNECTORS_HOSTNAME;
    const identity = env.REPL_IDENTITY ? `repl ${env.REPL_IDENTITY}`
      : env.WEB_REPL_RENEWAL ? `depl ${env.WEB_REPL_RENEWAL}` : null;
    if (!host || !identity) throw new Error("whop_connection_unavailable");
    const response = await connectorFetch(`https://${host}/api/v2/connection?include_secrets=true&connector_names=whop`, {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: identity },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("whop_connection_unavailable");
    const data = await response.json() as { items?: { settings?: { api_key?: string; company_id?: string } }[] };
    const settings = data.items?.[0]?.settings;
    if (settings?.company_id !== whopCompanyId(env)) throw new Error("whop_account_mismatch");
    token = settings?.api_key;
  }
  if (!token) throw new Error("whop_credentials_unavailable");
  return createClient({
    token,
    baseUrl: whopApiBaseUrl(env),
    apiVersionDate: "2026-09-29",
    timeoutInSeconds: 15,
    maxRetries: 1,
  });
}
