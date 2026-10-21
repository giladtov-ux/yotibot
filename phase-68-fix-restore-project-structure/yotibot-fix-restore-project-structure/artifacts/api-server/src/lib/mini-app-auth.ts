import { createHmac, timingSafeEqual } from "node:crypto";

// initDataUnsafe is display data, not authentication. Validate Telegram's signed
// envelope on the server before inspecting the identity or any saved records.
export function validateTelegramInitData(raw: string, token: string, now = Date.now()) {
  if (!raw || raw.length > 16_384 || !token) return null;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const timestamp = Number(params.get("auth_date")) * 1000;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0
    || timestamp > now + 60_000 || now - timestamp > 24 * 60 * 60_000) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null");
    if (!user || user.is_bot || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { id: String(user.id), name: String(user.first_name ?? "").slice(0, 100) };
  } catch { return null; }
}

export function signMiniAppRequest(body: unknown, token: string) {
  return createHmac("sha256", token).update("AhSheliMiniApp\n")
    .update(JSON.stringify(body)).digest("hex");
}
