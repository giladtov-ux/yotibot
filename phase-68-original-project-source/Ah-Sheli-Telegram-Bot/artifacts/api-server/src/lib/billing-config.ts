// Published origin obtained from deployment metadata, not a guessed repl domain.
const publishedOrigin = "https://ah-sheli-telegram-bot.replit.app";
export function websiteOrigin() {
  return publishedOrigin;
}
export const planAmounts = { Pro: 2900, Unlimited: 7900 } as const;
