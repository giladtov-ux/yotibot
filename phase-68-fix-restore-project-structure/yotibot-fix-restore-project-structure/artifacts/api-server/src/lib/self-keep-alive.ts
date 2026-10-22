const INTERVAL_MS = 4 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

type Log = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};

type Options = {
  logger: Log;
  production?: boolean;
  deploymentEnvironment?: string;
  dataEnvironment?: string;
  publicUrl?: string;
  request?: typeof fetch;
  schedule?: typeof setInterval;
  cancel?: typeof clearInterval;
  requestTimeoutMs?: number;
};

/**
 * Best effort only: this timer cannot execute or wake its host after suspension.
 * Telegram-only API health traffic stays separate from bot actions, SQL writes
 * and the canonical Telegram reminder scheduler; never replay alerts in a pulse.
 */
export function startSelfKeepAlive({
  logger,
  production = process.env.NODE_ENV === "production",
  deploymentEnvironment = process.env.DEPLOYMENT_ENV,
  dataEnvironment = process.env.DATA_ENVIRONMENT,
  publicUrl = process.env.SELF_KEEP_ALIVE_URL,
  request = fetch,
  schedule = setInterval,
  cancel = clearInterval,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}: Options): () => void {
  if (!production || deploymentEnvironment === "staging" || dataEnvironment === "staging") {
    return () => {};
  }

  let endpoint: URL;
  try {
    const published = new URL(publicUrl ?? "");
    if (published.protocol !== "https:" || published.username || published.password) {
      throw new Error("Invalid public origin");
    }
    endpoint = new URL("/api/healthz", published.origin);
  } catch {
    logger.warn(
      { code: "self_keep_alive_not_configured" },
      "Self keep-alive disabled: a verified HTTPS public URL is required.",
    );
    return () => {};
  }

  let stopped = false;
  let running = false;
  let pending: AbortController | undefined;

  async function pulse() {
    if (stopped || running) return;
    running = true;
    const controller = new AbortController();
    pending = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(requestTimeoutMs),
    ]);
    try {
      const response = await request(endpoint.href, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal,
      });
      await response.body?.cancel();
      if (stopped) return;
      if (response.ok) {
        logger.info(
          { code: "self_keep_alive_ok", status: response.status },
          "Best-effort self keep-alive health request succeeded.",
        );
      } else {
        logger.warn(
          { code: "self_keep_alive_http_error", status: response.status },
          "Self keep-alive health request was rejected; retrying at the next interval.",
        );
      }
    } catch {
      if (!stopped) {
        logger.warn(
          { code: signal.aborted ? "self_keep_alive_timeout" : "self_keep_alive_request_failed" },
          "Self keep-alive request failed; retrying at the next interval.",
        );
      }
    } finally {
      pending = undefined;
      running = false;
    }
  }

  const timer = schedule(() => { void pulse(); }, INTERVAL_MS);
  timer.unref();
  logger.info(
    { code: "self_keep_alive_started", intervalMs: INTERVAL_MS, requestTimeoutMs },
    "Best-effort self keep-alive enabled; this does not guarantee uninterrupted hosting.",
  );

  return () => {
    if (stopped) return;
    stopped = true;
    cancel(timer);
    pending?.abort();
  };
}
