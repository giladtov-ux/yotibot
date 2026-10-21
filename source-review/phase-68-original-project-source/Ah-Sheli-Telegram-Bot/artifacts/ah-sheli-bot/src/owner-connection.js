import { createHash, randomBytes } from "node:crypto";
import { getPool } from "./database.js";
import { matchesSecret } from "./security.js";

const OWNER_KEY = "allowed_chat_id";
const CONNECTION_KEY = "owner_connection";
const CONNECTION_LOCK = 724839103;
const CONNECTION_LIFETIME_MS = 15 * 60_000;

function digest(code) {
  return createHash("sha256").update(code).digest("hex");
}

export function numericChatId(value) {
  return typeof value === "string" && /^-?\d{1,20}$/.test(value.trim())
    ? value.trim() : null;
}

export function verifyConnection(message, connection, now = Date.now()) {
  if (message?.chat?.type !== "private" || message.from?.is_bot
    || !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0
    || message.from?.id !== message.chat.id) return null;
  const match = /^\/connect(?:@[a-z0-9_]+)?\s+([a-f0-9]{32})$/iu.exec(message.text?.trim() ?? "");
  if (!match || !connection || !Number.isFinite(connection.expiresAt)
    || connection.expiresAt <= now
    || !matchesSecret(digest(match[1].toLowerCase()), connection.digest)) return null;
  return String(message.chat.id);
}

// A repository factory permits isolated DB tests without touching real owners.
export function createOwnerConnections({
  pool = getPool(),
  legacyOwner = process.env.TELEGRAM_ALLOWED_CHAT_ID,
  now = Date.now,
} = {}) {
  const configuredOwner = numericChatId(legacyOwner);

  async function ownerFrom(client) {
    const { rows } = await client.query(
      "SELECT value FROM ah_sheli_config WHERE key = $1", [OWNER_KEY],
    );
    return numericChatId(rows[0]?.value) ?? configuredOwner;
  }

  async function transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [CONNECTION_LOCK]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    getOwner: () => ownerFrom(pool),
    begin: () => transaction(async (client) => {
      if (await ownerFrom(client)) throw new Error("An owner is already connected; automatic replacement is forbidden.");
      const code = randomBytes(16).toString("hex");
      const expiresAt = now() + CONNECTION_LIFETIME_MS;
      await client.query(
        `INSERT INTO ah_sheli_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [CONNECTION_KEY, JSON.stringify({ digest: digest(code), expiresAt })],
      );
      return { command: `/connect ${code}`, expiresAt };
    }),
    connect: (message) => transaction(async (client) => {
      const existingOwner = await ownerFrom(client);
      if (existingOwner) {
        return { status: "already_connected", isOwner: existingOwner === String(message?.chat?.id) };
      }
      const { rows } = await client.query(
        "SELECT value FROM ah_sheli_config WHERE key = $1", [CONNECTION_KEY],
      );
      let connection;
      try { connection = JSON.parse(rows[0]?.value ?? "null"); } catch { connection = null; }
      const chatId = verifyConnection(message, connection, now());
      if (!chatId) return { status: "invalid" };
      await client.query(
        "INSERT INTO ah_sheli_config (key, value) VALUES ($1, $2)",
        [OWNER_KEY, chatId],
      );
      await client.query("DELETE FROM ah_sheli_config WHERE key = $1", [CONNECTION_KEY]);
      return { status: "connected", chatId };
    }),
  };
}
