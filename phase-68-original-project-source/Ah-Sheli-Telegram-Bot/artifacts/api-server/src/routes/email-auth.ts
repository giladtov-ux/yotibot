import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomBytes, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { verifiedEmailAccount, emailMiniAppIdentity, sameOriginMutation } from "../lib/email-identity";

const router: IRouter = Router();
router.use("/email-auth", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/email-auth/me", async (req, res) => {
  try {
    if (!getAuth(req).userId) { res.json({ signedIn: false }); return; }
    const account = await verifiedEmailAccount(req);
    if (!account) { res.json({ signedIn: true, verifiedEmail: false, telegramId: null, hasAccess: false }); return; }
    const identity = await emailMiniAppIdentity(req);
    res.json({ signedIn: true, verifiedEmail: true, email: account.email,
      telegramId: account.telegram_id, hasAccess: Boolean(identity) });
  } catch { res.status(503).json({ error: "auth_unavailable", message: "ההתחברות אינה זמינה כרגע. נסה שוב." }); }
});
router.post("/email-auth/link", async (req, res) => {
  if (!sameOriginMutation(req)) { res.status(403).json({ error: "invalid_origin" }); return; }
  try {
    const account = await verifiedEmailAccount(req);
    if (!account) { res.status(401).json({ error: "verified_email_required", message: "צריך להתחבר ולאמת את כתובת הדוא״ל." }); return; }
    if (account.telegram_id) { res.status(409).json({ error: "already_linked", message: "החשבון כבר מקושר לטלגרם." }); return; }
    const token = randomBytes(24).toString("hex");
    const digest = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(`INSERT INTO ah_sheli_email_links(digest,clerk_id,expires_at)
      SELECT $1,$2,NOW()+INTERVAL '15 minutes'
      WHERE NOT EXISTS(SELECT 1 FROM ah_sheli_email_links WHERE clerk_id=$2 AND created_at>NOW()-INTERVAL '15 seconds')
      RETURNING digest`, [digest, account.clerk_id]);
    if (!rows.length) { res.status(429).json({ error: "try_again", message: "המתן כמה שניות לפני יצירת קישור חדש." }); return; }
    res.json({ url: `https://t.me/AhSheli_Reminder_bot?start=email_${token}` });
  } catch { res.status(503).json({ error: "link_unavailable", message: "לא הצלחתי ליצור קישור כרגע. נסה שוב." }); }
});
export default router;
