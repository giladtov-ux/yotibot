export function shouldStartTelegramWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production"
    || (env.NODE_ENV === "development" && env.TELEGRAM_STAGING_ENABLED === "true");
}

export function isDevelopmentTelegramWebhook(url: string, devDomain?: string): boolean {
  if (!devDomain) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && parsed.hostname.toLowerCase() === devDomain.trim().toLowerCase()
      && parsed.pathname === "/telegram/webhook"
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}
