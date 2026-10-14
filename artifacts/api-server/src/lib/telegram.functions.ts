import type { Request, Response } from "express";
export const BOT_INTERNAL_PORT = 18081;

export async function telegramWorkerReady(request: typeof fetch = fetch): Promise<boolean> {
  try {
    const health = await request(`http://127.0.0.1:${BOT_INTERNAL_PORT}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    const identity = await health.json();
    return health.ok && identity !== null && typeof identity === "object"
      && "service" in identity && identity.service === "ah-sheli-bot"
      && "ready" in identity && identity.ready === true;
  } catch {
    return false;
  }
}

// Only the internal bot port is reachable here. A Vite server can occupy this
// port when the worker is absent, so identify the service before forwarding.
export async function relayTelegramRequest(request: Request, response: Response, path: string) {
  try {
    const health = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    const identity = await health.json();
    if (!health.ok || !identity || typeof identity !== "object"
      || !("service" in identity) || identity.service !== "ah-sheli-bot"
      || !("ready" in identity) || identity.ready !== true) {
      response.status(503).json({ ok: false, error: "bot_unavailable" });
      return;
    }
    const upstream = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": request.get("authorization") ?? "",
        "x-telegram-bot-api-secret-token":
          request.get("x-telegram-bot-api-secret-token") ?? "",
      },
      body: JSON.stringify(request.body ?? {}),
      signal: AbortSignal.timeout(55_000),
    });
    response.status(upstream.status).type("application/json").send(await upstream.text());
  } catch {
    response.status(503).json({ ok: false, error: "bot_unavailable" });
  }
}
