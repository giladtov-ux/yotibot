import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { RunMiniAppActionBody, CreateMiniAppShareBody } from "@workspace/api-zod";
import { sharedLists } from "../lib/mini-app-sharing";
import { runMiniAppWorkerAction } from "../lib/mini-app-worker";

const router: IRouter = Router();
router.get("/", async (_req, res) => {
  try { res.json(await sharedLists(res.locals.miniAppIdentity.id)); }
  catch { res.status(503).json({ error: "sharing_unavailable", message: "השיתופים אינם זמינים כרגע." }); }
});
router.post("/", async (req, res) => {
  const parsed = CreateMiniAppShareBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid_share" }); return; }
  const { listName, memberTelegramId, role } = parsed.data;
  const userId = res.locals.miniAppIdentity.id;
  if (typeof listName !== "string" || listName.length > 60
    || typeof memberTelegramId !== "string" || !/^[1-9]\d{0,19}$/.test(memberTelegramId)
    || memberTelegramId === userId || !["viewer", "editor"].includes(role)) {
    res.status(400).json({ error: "invalid_share", message: "בחר רשימה, מזהה טלגרם והרשאה תקינים." }); return;
  }
  try {
    await sharedLists(userId); // Initializes only additive permission tables.
    const { rows } = await pool.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
    if (!Object.hasOwn(rows[0]?.value?.lists?.[userId] ?? {}, listName)) {
      res.status(404).json({ error: "list_not_found" }); return;
    }
    await pool.query(`INSERT INTO ah_sheli_list_shares(id,owner_id,list_name,member_id,role)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,list_name,member_id) DO UPDATE SET role=EXCLUDED.role`,
      [randomUUID(), userId, listName, memberTelegramId, role]);
    res.json(await sharedLists(userId));
  } catch { res.status(503).json({ error: "share_failed", message: "השיתוף לא נשמר. נסה שוב." }); }
});
router.delete("/:id", async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(String(req.params.id))) { res.status(400).json({ error: "invalid_share" }); return; }
  try {
    const id = res.locals.miniAppIdentity.id;
    await sharedLists(id);
    const result = await pool.query("DELETE FROM ah_sheli_list_shares WHERE id=$1 AND (owner_id=$2 OR member_id=$2)", [req.params.id, id]);
    if (!result.rowCount) { res.status(404).json({ error: "share_not_found" }); return; }
    res.json(await sharedLists(id));
  } catch { res.status(503).json({ error: "revoke_failed", message: "השיתוף לא בוטל. נסה שוב." }); }
});
router.post("/:id/action", async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(String(req.params.id))) { res.status(400).json({ error: "invalid_share" }); return; }
  const parsed = RunMiniAppActionBody.strict().safeParse(req.body);
  if (!parsed.success || parsed.data.entity !== "item") { res.status(400).json({ error: "invalid_action" }); return; }
  try {
    const id = res.locals.miniAppIdentity.id;
    await sharedLists(id);
    const { rows } = await pool.query(`SELECT owner_id,list_name,role FROM ah_sheli_list_shares
      WHERE id=$1 AND (owner_id=$2 OR member_id=$2)`, [req.params.id, id]);
    const share = rows[0];
    if (!share || (share.owner_id !== id && share.role !== "editor") || parsed.data.listName !== share.list_name) {
      res.status(403).json({ error: "share_access_denied", message: "אין הרשאת עריכה לרשימה הזו." }); return;
    }
    // Same canonical queue/SQL writer as Telegram; the browser cannot choose the owner.
    await runMiniAppWorkerAction(share.owner_id, parsed.data);
    res.json(await sharedLists(id));
  } catch (error: any) { res.status(error.status ?? 503).json({ error: error.code ?? "save_failed", message: error.message ?? "לא נשמר שינוי." }); }
});
export default router;
