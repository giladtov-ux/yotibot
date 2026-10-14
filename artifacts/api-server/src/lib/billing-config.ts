// External production origin explicitly supplied and approved by the user.
const publishedOrigin = "https://yotibot-azbu.onrender.com";
export function websiteOrigin() {
  return publishedOrigin;
}
export const planAmounts = { Pro: 2900, Unlimited: 7900 } as const;
