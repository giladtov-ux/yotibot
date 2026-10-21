import "./src/israel-timezone.js";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import {
  closeReminderDatabase,
  initializeReminderPersistence,
} from "./src/reminder-repository.js";
import { loadStore, saveStore, initializeStatePersistence,
  assertStatePersistenceActive, setUnknownCommitHandler } from "./src/store.js";
import { TelegramClient } from "./src/telegram.js";
import { acquireWorkerLock, getPool } from "./src/database.js";
import { claimUpdate, finishUpdate, getHookToken } from "./src/conversation-repository.js";
import { matchesSecret } from "./src/security.js";
import { createReminderWorker } from "./src/reminder-worker.js";
import { createReminderScheduler } from "./src/reminder-scheduler.js";
import { createOwnerConnections } from "./src/owner-connection.js";
import { createTelegramUserRepository } from "./src/telegram-users.js";
import { createUserAccess, botCommandUpdates, landingPageUrl } from "./src/user-access.js";
import { handleAuthorizedUpdate } from "./src/user-update-handler.js";
import { handleWebsiteRegistration } from "./src/website-registration.js";
import { handleEmailAccountLink } from "./src/email-account-link.js";
import { miniAppMenuUpdate } from "./src/telegram-mini-app.js";
import { applyMiniAppAction, verifyMiniAppRequest } from "./src/mini-app-actions.js";
import { requestMetadata } from "./src/interrupted-requests.js";
import { TELEGRAM_ALLOWED_UPDATES,
  createReminderOperationQueue } from "./src/reminder-actions.js";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const WEBHOOK_PATH = "/telegram/webhook";
const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is required. Add it through Replit Secrets before starting Ah Sheli.",
  );
}

const abortController = new AbortController();
let stopping = false;
let workerLock;
let ready = false;
function assertActive() {
  assertStatePersistenceActive();
  if (stopping || !workerLock?.isActive()) throw new Error("Telegram worker is not active.");
}
function stopUnsafeWorker() {
  // Exit rather than retrying or releasing ownership while stale work runs.
  stopping = true;
  ready = false;
  abortController.abort();
  reminderScheduler?.stop();
  httpServer?.close();
  process.exit(1);
}
setUnknownCommitHandler(() => {
  console.error("[Ah Sheli] State COMMIT outcome unknown; stopping for an exclusive reload.");
  stopUnsafeWorker();
});
const telegram = new TelegramClient(token, {
  signal: abortController.signal, assertActive,
});
const store = await loadStore(getPool());
let updateOffset = store.lastUpdateId + 1;
let reminderScheduler;
let httpServer;
let webhookSecret;
let webhookPath = WEBHOOK_PATH;
let webhookUpdateQueue = Promise.resolve();
let reminderRun;
let pollingRun = Promise.resolve();
let allowedChatId = null;
const users = createTelegramUserRepository(getPool());
const userAccess = createUserAccess({ repository: users, ownerId: () => allowedChatId, assertActive });
Object.defineProperty(store, "assistantIdentity", { value: id => userAccess.context(id) });
const ownerConnections = createOwnerConnections();
const reminderOperation = createReminderOperationQueue();
const deliverDueReminders = createReminderWorker(
  store, telegram, () => allowedChatId, logError, saveStore, assertActive,
  { isAuthorized: id => userAccess.canUse(id) },
);
function runReminders() {
  if (reminderRun) return reminderRun;
  reminderRun = reminderOperation(deliverDueReminders).finally(() => { reminderRun = undefined; });
  return reminderRun;
}

function logError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Ah Sheli] ${context}: ${message.slice(0, 300)}`);
}

function resolveWebhookConfig() {
  const explicitUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  if (explicitUrl) {
    const url = new URL(explicitUrl);
    if (url.protocol !== "https:" || !url.pathname.endsWith(WEBHOOK_PATH)) {
      throw new Error(
        `TELEGRAM_WEBHOOK_URL must be HTTPS and end with ${WEBHOOK_PATH}.`,
      );
    }
    return { url: url.toString(), path: url.pathname };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("TELEGRAM_WEBHOOK_URL must be the verified published HTTPS URL.");
  }

  return null;
}

function sendHttpJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readWebhookUpdate(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      throw new Error("Telegram webhook request is too large.");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function startHttpServer(webhookConfig) {
  webhookPath = webhookConfig?.path ?? WEBHOOK_PATH;

  httpServer = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      sendHttpJson(response, 200, {
        ok: true, service: "ah-sheli-bot", ownerConfigured: Boolean(allowedChatId),
        ready: ready && !stopping && Boolean(workerLock?.isActive()),
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/internal/mini-app") {
      if (!ready || stopping || !workerLock?.isActive()) {
        sendHttpJson(response, 503, { ok: false, error: "bot_unavailable" });
        return;
      }
      try {
        const body = await readWebhookUpdate(request);
        if (!verifyMiniAppRequest(body, request.headers["x-ah-sheli-auth"], token)) {
          sendHttpJson(response, 401, { ok: false });
          return;
        }
        if (!await userAccess.canUse(body.userId)) {
          sendHttpJson(response, 403, { ok: false, error: "access_required" });
          return;
        }
        const operation = webhookUpdateQueue.then(() => reminderOperation(async () => {
          assertActive();
          if (!await userAccess.canUse(body.userId)) {
            throw Object.assign(new Error("access_required"), { status: 403 });
          }
          await applyMiniAppAction(store, body.userId, body.action);
        }));
        webhookUpdateQueue = operation.catch(() => undefined);
        await operation;
        sendHttpJson(response, 200, { ok: true });
      } catch (error) {
        const status = error.status === 400 || error.status === 403 ? error.status : 503;
        if (status === 503) logError("Mini App action failed", error);
        sendHttpJson(response, status, {
          ok: false, error: status === 400 ? "invalid_action" : "bot_unavailable",
          message: status === 400 ? error.message : "לא הצלחתי לשמור כרגע. נסה שוב עוד רגע.",
        });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/public/hooks/send-reminders") {
      const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
      if (!matchesSecret(bearer, webhookSecret)) {
        sendHttpJson(response, 401, { ok: false });
        return;
      }
      if (!ready || stopping || !workerLock?.isActive()) {
        sendHttpJson(response, 503, { ok: false });
        return;
      }
      try {
        sendHttpJson(response, 200, await runReminders());
      } catch (error) {
        logError("Reminder hook failed", error);
        sendHttpJson(response, 503, { ok: false });
      }
      return;
    }
    if (request.method !== "POST" || pathname !== webhookPath) {
      sendHttpJson(response, 404, { ok: false });
      return;
    }
    if (!webhookConfig || !webhookSecret || !ready || stopping || !workerLock?.isActive()) {
      sendHttpJson(response, 503, { ok: false });
      return;
    }

    const headerSecret =
      request.headers["x-telegram-bot-api-secret-token"];
    if (!matchesSecret(headerSecret, webhookSecret)) {
      sendHttpJson(response, 403, { ok: false });
      return;
    }

    let update;
    try {
      update = await readWebhookUpdate(request);
    } catch {
      sendHttpJson(response, 400, { ok: false });
      return;
    }
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
      sendHttpJson(response, 400, { ok: false });
      return;
    }

    try {
      const receivedAt = performance.now();
      const queuedUpdate = webhookUpdateQueue.catch(() => undefined).then(async () => {
        console.info("[Ah Sheli] Update queue timing", { waitMs: Math.round(performance.now() - receivedAt) });
        await processUpdate(update);
      });
      webhookUpdateQueue = queuedUpdate.catch((error) => {
        logError("Could not process a queued Telegram update", error);
      });
      await queuedUpdate;
      sendHttpJson(response, 200, { ok: true });
    } catch (error) {
      logError("Could not process a Telegram webhook update", error);
      sendHttpJson(response, 500, { ok: false });
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(Number(process.env.PORT) || 18081, "0.0.0.0", () => {
      httpServer.removeListener("error", reject);
      resolve(httpServer);
    });
  });
}

async function processUpdate(update) {
  assertActive();
  const actorId = await userAccess.authorizedId(update);
  if (!await claimUpdate(update.update_id, requestMetadata(update, actorId))) return;
  try {
    await handleUpdate(update);
    store.lastUpdateId = Math.max(store.lastUpdateId, update.update_id);
    await saveStore(store);
    await finishUpdate(update.update_id, "done");
  } catch (error) {
    await finishUpdate(update.update_id, "failed");
    // Do not automatically replay ambiguous Telegram deliveries.
    throw error;
  }
}

async function handleUpdate(update) {
  const registrationNotifications = { onRegistered: id => userAccess.notifyNewRegistration(id, telegram) };
  if (await handleEmailAccountLink(update, telegram, getPool(), registrationNotifications)) return;
  if (update.callback_query) {
    return handleAuthorizedUpdate(store, telegram, update, { userAccess, reminderOperation, assertActive });
  }
  const message = update.message;
  if ((!message?.text && !message?.voice) || message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const commandText = message.text ?? "";
  if (/^\/connect(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(commandText.trim())) {
    const result = await ownerConnections.connect(message);
    if (result.status === "connected") {
      allowedChatId = result.chatId;
      await telegram.sendMessage(chatId,
        "סגור אח שלי, חיברתי את הצ׳אט שלך כמנהל. אפשר להתחיל לדבר ולנהל הרשאות עם /users.");
      console.info("[Ah Sheli] Private owner connection confirmed by Telegram.");
    } else if (result.status === "already_connected" && result.isOwner) {
      await telegram.sendMessage(chatId, "אח שלי, הצ׳אט שלך כבר מחובר והתקשורת פתוחה.");
    } else {
      await telegram.sendMessage(chatId, `חיבור המנהל לא אושר. צריך פקודת חיבור תקפה בצ׳אט פרטי. להצטרפות לבוט:\n${landingPageUrl()}`);
    }
    return;
  }
  if (/^\/id(?:@[a-z0-9_]+)?$/iu.test(commandText.trim())) {
    const reply = allowedChatId
      ? `מזהה הצ'אט שלך הוא ${chatId}.`
      : `מזהה הצ'אט שלך הוא ${chatId}.\nכדי להפעיל את העוזר הפרטי, שמור את המספר במשתנה TELEGRAM_ALLOWED_CHAT_ID ב-Replit.`;
    await telegram.sendMessage(chatId, reply);
    return;
  }
  try {
    if (await handleWebsiteRegistration(update, telegram, getPool(), registrationNotifications)) return;
    await handleAuthorizedUpdate(store, telegram, update, { userAccess, reminderOperation, assertActive });
  } catch (error) {
    if (stopping || !workerLock?.isActive()) throw error;
    logError("Could not handle an incoming message", error);
    try {
      await telegram.sendMessage(
        chatId,
        "אופס אח שלי, לא הצלחתי לעבד את ההודעה כרגע. תנסה שוב עוד רגע.",
      );
    } catch (sendError) {
      logError("Could not send an error reply", sendError);
      throw sendError;
    }
  }
}

async function pollUpdates() {
  while (!stopping) {
    try {
      const updates = await telegram.call(
        "getUpdates",
        {
          offset: updateOffset,
          timeout: 30,
          allowed_updates: TELEGRAM_ALLOWED_UPDATES,
        },
        { signal: abortController.signal, timeoutMs: 40_000 },
      );

      for (const update of updates) {
        await processUpdate(update);
        updateOffset = store.lastUpdateId + 1;
      }
    } catch (error) {
      if (stopping) break;
      logError("Telegram polling paused; retrying shortly", error);
      await sleep(4_000);
    }
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  ready = false;
  abortController.abort();
  reminderScheduler?.stop();
  httpServer?.close();
  void (async () => {
    await webhookUpdateQueue.catch(() => undefined);
    await pollingRun.catch(() => undefined);
    await reminderRun?.catch(() => undefined);
    await workerLock?.release();
    await closeReminderDatabase();
  })().catch((error) => logError("Shutdown failed", error));
  console.info(`[Ah Sheli] Received ${signal}; stopping cleanly.`);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const webhookConfig = resolveWebhookConfig();
// Check Telegram before any database initialization. Separate dev/prod
// databases cannot use a database lock to fence the same Telegram token.
if (!webhookConfig) {
  const currentWebhook = await telegram.call("getWebhookInfo");
  if (currentWebhook.url) {
    console.info(
      "[Ah Sheli] A webhook is already active for this bot; this local process will exit to avoid deleting it or sending duplicate reminders.",
    );
    process.exit(0);
  }
}
workerLock = await acquireWorkerLock(() => {
  // Fail closed. Never reacquire a session and continue with stale memory.
  stopUnsafeWorker();
});
await workerLock.check();
assertActive();
await initializeStatePersistence(store);
updateOffset = store.lastUpdateId + 1;
await initializeReminderPersistence(store);
allowedChatId = await ownerConnections.getOwner();
await users.initialize();
webhookSecret = await getHookToken();
assertActive();
// Listen before external setup; health distinguishes listening from readiness.
await startHttpServer(webhookConfig);

if (webhookConfig) {
  // Existing authenticated webhook requests can be served while registration
  // is refreshed; the database and exclusive lock are already initialized.
  ready = true;
  await telegram.call("setWebhook", {
    url: webhookConfig.url,
    secret_token: webhookSecret,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    drop_pending_updates: false,
    max_connections: 1,
  });
  console.info("[Ah Sheli] Telegram webhook is active.");
} else {
  // Recheck after initialization in case production activated in the meantime.
  const currentWebhook = await telegram.call("getWebhookInfo");
  if (currentWebhook.url) {
    console.info(
      "[Ah Sheli] A webhook is already active for this bot; this local process will exit to avoid deleting it or sending duplicate reminders.",
    );
    httpServer.close();
    await workerLock.release();
    await closeReminderDatabase();
    process.exit(0);
  }
  ready = true;
}

console.info(
  "[Ah Sheli] Bot is running with an exclusive live database lock.",
);
console.info(
  `[Ah Sheli] Incoming updates use ${webhookConfig ? "the HTTPS webhook" : "development long polling"}.`,
);
console.info(
  `[Ah Sheli] Loaded ${store.reminders.filter((reminder) => !reminder.sentAt).length} pending reminders.`,
);

reminderScheduler = createReminderScheduler(runReminders, {
  onError: error => logError("Reminder scheduler failed", error),
});
reminderScheduler.start();
console.info("[Ah Sheli] Background reminders are checked every second, independently of incoming messages.");

if (!webhookConfig) pollingRun = pollUpdates();

// Cosmetic Telegram setup must not hold up webhook readiness or reminders.
void (async () => {
  const uncertain = store.reminders.filter(reminder =>
    reminder.chatId === allowedChatId && !reminder.sentAt && reminder.lastAttemptAt);
  if (uncertain.length && !stopping) {
    console.warn(`[Ah Sheli] ${uncertain.length} reminder deliveries need owner verification; automatic replay blocked.`);
    try {
      await telegram.sendMessage(allowedChatId,
        `אח שלי, יש ${uncertain.length} תזכורות שניסיון השליחה שלהן נקטע ולא ידוע אם התקבלו. כדי שלא לשלוח לך פעמיים, לא אשלח אותן שוב אוטומטית. אפשר לבקש ״הצג את התזכורות שלי״, לבדוק מה התקבל בטלגרם, ולבטל או לקבוע מחדש את התזכורות האלו.`);
    } catch (error) {
      logError("Could not notify owner about interrupted reminder deliveries", error);
    }
  }
  for (const [method, payload] of [
    ...botCommandUpdates(allowedChatId).map(payload => ["setMyCommands", payload]),
    ["setChatMenuButton", miniAppMenuUpdate()],
    ["setMyName", { name: "אח שלי" }],
    ["setMyDescription", { description: "עוזר אישי חם בעברית לניהול משימות ותזכורות, לפי שעון ישראל." }],
  ]) {
    if (stopping) break;
    try {
      await telegram.call(method, payload);
    } catch (error) {
      logError(`Could not update the Telegram profile with ${method}`, error);
    }
  }
})();
