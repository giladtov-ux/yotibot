import { BOT_INTERNAL_PORT } from "./telegram.functions";
import { signMiniAppRequest } from "./mini-app-auth";

export async function runMiniAppWorkerAction(userId: string, action: unknown) {
  const health = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
  const worker = await health.json() as { service?: string; ready?: boolean };
  if (!health.ok || worker.service !== "ah-sheli-bot" || worker.ready !== true) throw new Error("worker_unavailable");
  const body = { userId, timestamp: Date.now(), action };
  const result = await fetch(`http://127.0.0.1:${BOT_INTERNAL_PORT}/api/internal/mini-app`, {
    method: "POST", headers: { "content-type": "application/json",
      "x-ah-sheli-auth": signMiniAppRequest(body, process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "") },
    body: JSON.stringify(body), signal: AbortSignal.timeout(55_000),
  });
  if (!result.ok) {
    const failure = await result.json() as { error?: string; message?: string };
    throw Object.assign(new Error(failure.message ?? "לא הצלחתי לשמור כרגע."), { status: result.status, code: failure.error });
  }
}
