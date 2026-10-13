import "./israel-timezone.js";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import {
  closeReminderDatabase,
  initializeReminderPersistence
} from "./reminder-repository.js";
import { loadStore, saveStore, initializeStatePersistence, assertStatePersistenceActive, setUnknownCommandHandler } from "./store.js";
import { TelegramClient } from "./telegram.js";
import { acquireWorkerLock, getPool } from "./database.js";
import { claimUpdate, finishUpdate, getHookToken } from "./conversation-repository.js";
import { matchesSecret } from "./security.js";
import { createReminderWorker } from "./reminder-worker.js";
import { createReminderScheduler } from "./reminder-scheduler.js";
import { createOwnerConnections } from "./owner-connection.js";
import { createTelegramUserRepository } from "./telegram-users.js";
import { createUserAccess, botCommandUpdates, landingPageUrl } from "./user-access.js";
import { handleAuthorizedUpdate } from "./user-update-handler.js";
import { handleWebsiteRegistration } from "./website-registration.js";
import { handleEmailAccountLink } from "./email-account-link.js";
import { miniAppMenuUpdate } from "./telegram-mini-app.js";
