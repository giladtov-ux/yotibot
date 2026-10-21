import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import { pool } from "@workspace/db";
import { authorizedMiniAppUser } from "./mini-app-data";

let ready: Promise<void> | undefined;
const verifiedAddresses = new Map<string, { email: string; name: string; expires: number }>();
export function initializeEmailIdentity() {
  ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ah_sheli_email_users (
    clerk_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    telegram_id TEXT UNIQUE, verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ah_sheli_email_links (
    digest TEXT PRIMARY KEY, clerk_id TEXT NOT NULL REFERENCES ah_sheli_email_users(clerk_id),
    candidate_id TEXT, expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ah_sheli_list_shares (
    id UUID PRIMARY KEY, owner_id TEXT NOT NULL, list_name TEXT NOT NULL,
    member_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(owner_id,list_name,member_id)
  );`).then(() => undefined).catch(error => { ready = undefined; throw error; });
  return ready;
}

export async function verifiedEmailAccount(req: Request) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  await initializeEmailIdentity();
  // Only Clerk's verified primary address may provision a local account.
  let cached = verifiedAddresses.get(userId);
  if (!cached || cached.expires <= Date.now()) {
    const user = await clerkClient.users.getUser(userId);
    const address = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId);
    if (!address || address.verification?.status !== "verified") return null;
    cached = { email: address.emailAddress, name: [user.firstName, user.lastName].filter(Boolean).join(" "), expires: Date.now() + 30_000 };
    if (verifiedAddresses.size >= 1000) verifiedAddresses.clear();
    verifiedAddresses.set(userId, cached);
  }
  const { rows } = await pool.query(`INSERT INTO ah_sheli_email_users(clerk_id,email,name)
    VALUES($1,$2,$3) ON CONFLICT(clerk_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name
    RETURNING clerk_id,email,name,telegram_id`, [userId, cached.email, cached.name]);
  return rows[0] as { clerk_id: string; email: string; name: string; telegram_id: string | null };
}

export async function emailMiniAppIdentity(req: Request) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  await initializeEmailIdentity();
  const { rows } = await pool.query("SELECT telegram_id,name FROM ah_sheli_email_users WHERE clerk_id=$1", [userId]);
  if (!rows[0]?.telegram_id) return null;
  return authorizedMiniAppUser({ id: rows[0].telegram_id, name: rows[0].name });
}

export function sameOriginMutation(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  if (req.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.get("origin");
  if (!origin) return true;
  const host = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  try { return new URL(origin).host === host; } catch { return false; }
}
