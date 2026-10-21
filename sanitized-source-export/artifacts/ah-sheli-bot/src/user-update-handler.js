import { handleOwnerUpdate } from "./message-handler.js";
import { handleRecordMenuCallback } from "./record-menu-callbacks.js";
import { handleReminderCallback } from "./reminder-actions.js";
import { UserAccessError } from "./user-access.js";
import { handleDailyRecapCallback } from "./daily-recap-flow.js";
import { handleMorningCallback } from "./morning-brief.js";

// Shared by the real Telegram runtime and native-update integration tests.
// Existing handlers still receive exactly one verified private-chat identity.
export async function handleAuthorizedUpdate(store, telegram, update, {
  userAccess, reminderOperation = work => work(), assertActive = () => {},
  replyOptions, transcribeVoice, readMorningSnapshot,
}) {
  try {
    const actorId = await userAccess.handle(update, telegram);
    if (!actorId) return;
    const assertPermission = () => userAccess.assertPermission(actorId);
    if (update.callback_query) {
      if (typeof update.callback_query.data === "string" && update.callback_query.data.startsWith("mb:")) {
        return reminderOperation(async () => {
          await assertPermission(); assertActive();
          return handleMorningCallback(store, telegram, update.callback_query, {
            ownerChatId: actorId, assertActive, assertPermission, readSnapshot: readMorningSnapshot,
          });
        });
      }
      if (typeof update.callback_query.data === "string" && update.callback_query.data.startsWith("rc:")) {
        return reminderOperation(async () => {
          await assertPermission(); assertActive();
          return handleDailyRecapCallback(store, telegram, update.callback_query, {
            ownerChatId: actorId, assertActive, assertPermission,
          });
        });
      }
      if (typeof update.callback_query.data === "string" && update.callback_query.data.startsWith("v:")) {
        await assertPermission();
        return await reminderOperation(async () => {
          await assertPermission();
          return handleRecordMenuCallback(store, telegram, update.callback_query, {
            ownerChatId: actorId, assertActive,
          });
        });
      }
      return await reminderOperation(async () => {
        await assertPermission();
        return handleReminderCallback(store, telegram, update.callback_query, {
          ownerChatId: actorId, assertActive,
        });
      });
    }
    return await handleOwnerUpdate(store, telegram, update, {
      ownerChatId: actorId, assertActive, assertPermission,
      replyOptions: { ...replyOptions, recordOperation: reminderOperation,
        telegramResponseStyle: true }, transcribeVoice,
    });
  } catch (error) {
    if (!(error instanceof UserAccessError)) throw error;
    // It may expire during speech/AI or while waiting for the reminder queue.
    // Explain it without executing an action or replaying a historical request.
    await userAccess.handle(update, telegram);
  }
}
