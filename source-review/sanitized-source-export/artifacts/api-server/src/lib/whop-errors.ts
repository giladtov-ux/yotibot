export type BillingFailureKind = "temporary" | "permission" | "signature";

// Only these local codes and HTTP statuses are inspected. Provider bodies,
// request URLs and messages are never copied into alerts or persisted.
export class WhopConnectionError extends Error {
  constructor(readonly code: string, readonly statusCode?: number) {
    super(code);
  }
}

export function billingFailureKind(error: unknown): BillingFailureKind {
  const value = error as { statusCode?: number; status?: number; code?: string; message?: string } | null;
  const code = value?.code ?? value?.message;
  if (code === "whop_webhook_signature_invalid") return "signature";
  if ([401, 403].includes(value?.statusCode ?? value?.status ?? 0)
    || ["whop_credentials_unavailable", "whop_account_mismatch", "whop_catalog_unavailable",
      "whop_webhook_secret_unavailable", "website_session_secret_missing"].includes(code ?? "")) return "permission";
  return "temporary";
}
