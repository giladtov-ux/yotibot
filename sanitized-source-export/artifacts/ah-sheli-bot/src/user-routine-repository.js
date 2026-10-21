import { getPool } from "./database.js";
import { validateUserRoutine } from "./user-routine.js";

export function userRoutineKey(chatId) {
  if (typeof chatId !== "string" || !/^[1-9]\d{0,14}$/u.test(chatId)) {
    throw new TypeError("A canonical private Telegram user ID is required.");
  }
  return `daily_routine:v1:${chatId}`;
}

// Existing per-key settings table. No DDL, shared fallback or runtime writer.
export async function loadUserRoutine(chatId, pool) {
  const key = userRoutineKey(chatId);
  const { rows } = await (pool ?? getPool()).query(
    "SELECT value FROM ah_sheli_config WHERE key = $1", [key],
  );
  if (!rows.length) return null;
  if (rows.length !== 1 || typeof rows[0].value !== "string") {
    throw new TypeError("Invalid stored user daily routine.");
  }
  return validateUserRoutine(JSON.parse(rows[0].value));
}
