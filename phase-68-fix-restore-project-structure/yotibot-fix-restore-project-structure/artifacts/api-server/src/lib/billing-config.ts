// External production origin explicitly supplied and approved by the user.
const publishedOrigin = "https://yotibot-azbu.onrender.com";
export function websiteOrigin() {
  if (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN) {
    return new URL(`https://${process.env.REPLIT_DEV_DOMAIN}`).origin;
  }
  if (process.env.NODE_ENV === "production" && process.env.PUBLIC_APP_URL) {
    return new URL(process.env.PUBLIC_APP_URL).origin;
  }
  return publishedOrigin;
}
export const planAmounts = { Pro: 2900, Unlimited: 7900 } as const;
