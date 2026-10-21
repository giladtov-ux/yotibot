import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "./app";
import { logger } from "./lib/logger";
import { BOT_INTERNAL_PORT } from "./lib/telegram.functions";
import { createWorkerRestartDelay } from "./lib/worker-restart";
import { initializeBilling } from "./lib/billing-runtime";
import { startSelfKeepAlive } from "./lib/self-keep-alive";
import { isDevelopmentTelegramWebhook, shouldStartTelegramWorker } from "./lib/telegram-staging";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(moduleDirectory, "../../../");
const botEntry = path.join(workspaceRoot, "artifacts/ah-sheli-bot/index.js");
let botProcess: ChildProcess | undefined;
let botRestartTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
let apiServer: ReturnType<typeof app.listen> | undefined;
const restartDelay = createWorkerRestartDelay();
let workerStartedAt = 0;
let stopSelfKeepAlive = () => {};

function startTelegramWorker() {
  if (shuttingDown || botProcess || !process.env.TELEGRAM_BOT_TOKEN
    || !shouldStartTelegramWorker(process.env)) return;

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    logger.error("Telegram worker needs TELEGRAM_WEBHOOK_URL from the verified published URL.");
    return;
  }

  try {
    const parsedWebhookUrl = new URL(webhookUrl);
    if (
      parsedWebhookUrl.protocol !== "https:" ||
      !["/telegram/webhook", "/api/telegram/webhook", "/api/public/telegram/webhook"].includes(parsedWebhookUrl.pathname)
    ) {
      throw new Error("The Telegram webhook URL has an invalid path or protocol.");
    }
    if (process.env.NODE_ENV === "development"
      && !isDevelopmentTelegramWebhook(webhookUrl, process.env.REPLIT_DEV_DOMAIN)) {
      throw new Error("Staging Telegram webhooks must use this Replit development domain and /telegram/webhook.");
    }
  } catch (error) {
    logger.error({ err: error }, "Telegram webhook URL is invalid.");
    return;
  }

  workerStartedAt = Date.now();
  botProcess = spawn(process.execPath, [botEntry], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PORT: String(BOT_INTERNAL_PORT),
      TELEGRAM_WEBHOOK_URL: webhookUrl,
    },
    stdio: "inherit",
  });

  botProcess.once("error", (error) => {
    logger.error({ err: error }, "Telegram worker could not start.");
    botProcess = undefined;
    scheduleTelegramWorkerRestart();
  });
  botProcess.once("exit", (code, signal) => {
    botProcess = undefined;
    if (shuttingDown) return;
    logger.error(
      { code, signal },
      "Telegram worker stopped; restarting it shortly.",
    );
    scheduleTelegramWorkerRestart();
  });
}

function scheduleTelegramWorkerRestart() {
  if (shuttingDown || botRestartTimer) return;
  const delayMs = restartDelay(Date.now() - workerStartedAt);
  logger.info({ delayMs }, "Telegram worker recovery scheduled.");
  botRestartTimer = setTimeout(() => {
    botRestartTimer = undefined;
    startTelegramWorker();
  }, delayMs);
  botRestartTimer.unref();
}

function stopTelegramWorker() {
  shuttingDown = true;
  stopSelfKeepAlive();
  if (botRestartTimer) clearTimeout(botRestartTimer);
  botProcess?.kill("SIGTERM");
  apiServer?.close();
}

process.once("SIGINT", stopTelegramWorker);
process.once("SIGTERM", stopTelegramWorker);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

apiServer = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void initializeBilling().catch(() => logger.warn({ code: "billing_not_ready" }, "Billing unavailable; existing bot remains running"));
  if (process.env.NODE_ENV === "production") stopSelfKeepAlive = startSelfKeepAlive({ logger });
  if (shouldStartTelegramWorker(process.env)) startTelegramWorker();
});
