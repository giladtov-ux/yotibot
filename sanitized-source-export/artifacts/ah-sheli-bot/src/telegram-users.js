export function telegramUserId(value) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,15}$/u.test(id) || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid Telegram user ID");
  }
  return id;
}

export function effectiveSubscription(user, ownerId, now = Date.now()) {
  if (ownerId && user?.id === ownerId) return "owner";
  if (!user) return "pending";
  if (user.status !== "active") return user.status;
  const expiry = new Date(user.expiresAt ?? NaN).getTime();
  return Number.isFinite(expiry) && expiry > now ? "active" : "expired";
}

function fromRow(row) {
  return row && {
    id: row.telegram_user_id, name: row.display_name, username: row.username,
    status: row.subscription_status,
    expiresAt: row.subscription_expires_at
      ? new Date(row.subscription_expires_at).toISOString() : null,
    isNew: row.is_new === true,
  };
}

// Additive storage only: no rewrite of existing lists, reminders or state JSON.
export function createTelegramUserRepository(pool) {
  return {
    async initialize() {
      const { rows } = await pool.query(`SELECT
        to_regclass('public.ah_sheli_telegram_users') AS table_name,
        to_regclass('public.ah_sheli_access_notifications') AS notifications_table`);
      if (!rows[0]?.table_name || !rows[0]?.notifications_table) {
        throw new Error("Telegram users schema is missing. Apply the development schema and republish.");
      }
    },
    async register(actor, owner = false) {
      const id = telegramUserId(actor.id);
      const { rows } = await pool.query(
        `INSERT INTO ah_sheli_telegram_users
          (telegram_user_id, display_name, username, subscription_status)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN 'active' ELSE 'pending' END)
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name, username = EXCLUDED.username,
           subscription_status = CASE WHEN $4 THEN 'active'
             ELSE ah_sheli_telegram_users.subscription_status END,
           subscription_expires_at = CASE WHEN $4 THEN NULL
             ELSE ah_sheli_telegram_users.subscription_expires_at END,
           updated_at = NOW()
         RETURNING *, (xmax = 0) AS is_new`,
        [id, actor.name, actor.username ?? null, owner],
      );
      return fromRow(rows[0]);
    },
    async claimNotification(eventKey, userId, recipientId) {
      const { rows } = await pool.query(
        `INSERT INTO ah_sheli_access_notifications (event_key, telegram_user_id, recipient_id)
         VALUES ($1, $2, $3) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
        [eventKey, telegramUserId(userId), telegramUserId(recipientId)],
      );
      return rows.length === 1;
    },
    async finishNotification(eventKey, status) {
      if (!["sent", "failed", "unknown"].includes(status)) throw new Error("Invalid delivery status");
      await pool.query(
        `UPDATE ah_sheli_access_notifications SET delivery_status = $2, updated_at = NOW()
         WHERE event_key = $1 AND delivery_status = 'unknown'`,
        [eventKey, status],
      );
    },
    async get(id) {
      const { rows } = await pool.query(
        "SELECT * FROM ah_sheli_telegram_users WHERE telegram_user_id = $1",
        [telegramUserId(id)],
      );
      return fromRow(rows[0]);
    },
    async grant(id, days) {
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Invalid subscription duration");
      const { rows } = await pool.query(
        `UPDATE ah_sheli_telegram_users SET subscription_status = 'active',
           subscription_expires_at =
             GREATEST(NOW(), CASE WHEN subscription_status = 'active'
               THEN subscription_expires_at ELSE NULL END)
             + ($2 * INTERVAL '24 hours'),
           updated_at = NOW()
         WHERE telegram_user_id = $1 RETURNING *`,
        [telegramUserId(id), days],
      );
      return fromRow(rows[0]);
    },
    async revoke(id) {
      const { rows } = await pool.query(
        `UPDATE ah_sheli_telegram_users SET subscription_status = 'revoked',
           updated_at = NOW() WHERE telegram_user_id = $1 RETURNING *`,
        [telegramUserId(id)],
      );
      return fromRow(rows[0]);
    },
    async list(page = 1) {
      if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new Error("Invalid page");
      const { rows } = await pool.query(
        "SELECT * FROM ah_sheli_telegram_users ORDER BY created_at, telegram_user_id LIMIT 21 OFFSET $1",
        [(page - 1) * 20],
      );
      return { users: rows.slice(0, 20).map(fromRow), hasNext: rows.length > 20 };
    },
  };
}
