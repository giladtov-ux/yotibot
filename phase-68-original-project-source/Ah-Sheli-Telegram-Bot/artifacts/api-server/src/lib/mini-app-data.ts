import { pool } from "@workspace/db";
import { openTasksFromState } from "./mini-app-tasks";

export type MiniAppIdentity = {
  id: string; name: string; access: "owner" | "active"; expiresAt: string | null; isOwner: boolean;
};
let schemaReady: Promise<void> | undefined;
export async function initializeMiniAppStorage() {
  schemaReady ??= (async () => {
    // Additive preferences only; existing bot state/users/reminders are untouched.
    await pool.query(`CREATE TABLE IF NOT EXISTS public.ah_sheli_mini_app_profiles (
      telegram_user_id TEXT PRIMARY KEY, name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'unspecified', language TEXT NOT NULL DEFAULT 'he',
      timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.ah_sheli_google_calendar (
      telegram_user_id TEXT PRIMARY KEY, credentials TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.ah_sheli_google_oauth_states (
      digest TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
    );`);
  })().catch(error => { schemaReady = undefined; throw error; });
  return schemaReady;
}

export async function authorizedMiniAppUser(actor: { id: string; name: string }): Promise<MiniAppIdentity | null> {
  const { rows: config } = await pool.query("SELECT value FROM ah_sheli_config WHERE key = 'allowed_chat_id'");
  const owner = typeof config[0]?.value === "string" && /^\d+$/.test(config[0].value)
    ? config[0].value : process.env.TELEGRAM_ALLOWED_CHAT_ID;
  // Same owner-configured/access/expiry policy as the existing bot.
  if (!owner) return null;
  if (actor.id === owner) return { ...actor, access: "owner", expiresAt: null, isOwner: true };
  const { rows } = await pool.query(
    "SELECT display_name, subscription_status, subscription_expires_at FROM ah_sheli_telegram_users WHERE telegram_user_id=$1",
    [actor.id],
  );
  const user = rows[0];
  if (!user || user.subscription_status !== "active"
    || !(new Date(user.subscription_expires_at).getTime() > Date.now())) return null;
  return { id: actor.id, name: user.display_name, access: "active",
    expiresAt: new Date(user.subscription_expires_at).toISOString(), isOwner: false };
}

export async function miniAppProfile(identity: MiniAppIdentity) {
  await initializeMiniAppStorage();
  const { rows } = await pool.query("SELECT name, gender, language, timezone FROM ah_sheli_mini_app_profiles WHERE telegram_user_id=$1", [identity.id]);
  return {
    name: rows[0]?.name ?? identity.name, gender: rows[0]?.gender ?? "unspecified",
    language: rows[0]?.language ?? "he", timezone: rows[0]?.timezone ?? "Asia/Jerusalem",
    telegramId: identity.id, access: identity.access, expiresAt: identity.expiresAt, isOwner: identity.isOwner,
  };
}

async function readBotState() {
  const { rows } = await pool.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
  const state = rows[0]?.value;
  if (!state || typeof state !== "object" || state.version !== 1) {
    throw Object.assign(new Error("bot_state_unavailable"), { status: 503 });
  }
  return state;
}

export async function miniAppTasks(identity: MiniAppIdentity) {
  return openTasksFromState(await readBotState(), identity.id);
}

export async function miniAppData(identity: MiniAppIdentity) {
  const state = await readBotState();
  const lists = Object.entries(state.lists?.[identity.id] ?? {}).map(([name, items]) => ({
    name, items: (items as Array<Record<string, unknown>>).map(item => ({
      id: item.id, text: item.text, checked: item.checked, createdAt: item.createdAt ?? null,
      ...(item.dueAt !== undefined ? { dueAt: item.dueAt } : {}),
    })),
  }));
  const weekly = new Map<string, any>();
  for (const schedule of state.savedSchedules ?? []) {
    if (schedule.chatId !== identity.id) continue;
    for (const entry of schedule.entries ?? []) weekly.set(entry.reminderId, entry);
  }
  const reminders = (state.reminders ?? []).filter((record: any) => record.chatId === identity.id)
    .map((record: any) => {
      const entry = weekly.get(record.id);
      const recurring = Boolean(entry || record.repeatEveryMs);
      return {
        id: record.id, text: record.text, dueAt: record.dueAt,
        createdAt: record.createdAt ?? record.dueAt, sentAt: record.sentAt ?? null,
        recurring, weekdays: entry?.weekdays ?? [], hour: entry?.hour ?? null,
        minute: entry?.minute ?? null, repeatEveryMs: record.repeatEveryMs ?? null,
        completed: !recurring
          && record.telegramDeliveries?.[Math.trunc(record.dueAt).toString(36)]?.state === "done",
      };
    }).sort((a: any, b: any) => a.dueAt - b.dueAt);
  return { profile: await miniAppProfile(identity), lists, reminders,
    tasks: openTasksFromState(state, identity.id).tasks };
}
