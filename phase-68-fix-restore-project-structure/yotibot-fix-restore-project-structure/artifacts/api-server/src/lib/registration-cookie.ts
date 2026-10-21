import type { Request, CookieOptions } from "express";

// Transport choice only, not authentication. POST origin checks and private OTP
// verification remain unchanged. CHIPS keeps Telegram Web's iframe session isolated.
export function registrationCookie(req: Pick<Request, "get">) {
  const mini = req.get("x-ah-sheli-mini-app") === "1";
  return {
    name: mini ? "ah_sheli_registration_mini" : "ah_sheli_registration",
    options: {
      httpOnly: true, secure: true, path: "/",
      sameSite: mini ? "none" : "lax",
      ...(mini ? { partitioned: true } : {}),
    } satisfies CookieOptions,
  };
}
export function registrationSession(req: Pick<Request, "get" | "cookies">): string {
  const token = req.cookies?.[registrationCookie(req).name];
  return typeof token === "string" ? token : "";
}
