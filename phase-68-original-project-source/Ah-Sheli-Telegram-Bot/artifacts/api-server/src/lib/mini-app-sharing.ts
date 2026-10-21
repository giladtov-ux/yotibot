import { pool } from "@workspace/db";
import { initializeEmailIdentity } from "./email-identity";

export async function sharedLists(userId: string) {
  await initializeEmailIdentity();
  const { rows: shares } = await pool.query(`SELECT id,owner_id,list_name,member_id,role FROM ah_sheli_list_shares
    WHERE owner_id=$1 OR member_id=$1 ORDER BY created_at DESC`, [userId]);
  if (!shares.length) return { shares: [] };
  const { rows } = await pool.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
  const state = rows[0]?.value;
  if (!state || state.version !== 1) throw new Error("bot_state_unavailable");
  return { shares: shares.filter(share => Object.hasOwn(state.lists?.[share.owner_id] ?? {}, share.list_name))
    .map(share => ({ id: share.id, ownerId: share.owner_id, memberId: share.member_id,
      listName: share.list_name, role: share.role, owned: share.owner_id === userId,
      items: state.lists[share.owner_id][share.list_name].map((item: any) => ({
        id: item.id, text: item.text, checked: item.checked, createdAt: item.createdAt ?? null,
        dueAt: item.dueAt ?? null,
      })) })) };
}
