export const TELEGRAM_BOT_URL = 'https://t.me/AhSheli_Reminder_bot';

// Public onboarding needs no bot credential, SQL read or third-party lookup.
export function telegramChannelOptions() {
  return { telegram: { available: true, url: TELEGRAM_BOT_URL } };
}
