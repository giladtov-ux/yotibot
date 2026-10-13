const CALLBACK = 'https://ah-sheli-telegram-bot.replit.app/api/mini-app/calendar/callback';

// Validate, never rewrite: changing a redirect only in the browser would break
// the server's OAuth state/token exchange and conceal an outdated deployment.
export function calendarAuthorizationUrl(value) {
  const url = new URL(value);
  const redirect = url.searchParams.get('redirect_uri');
  if (url.origin !== 'https://accounts.google.com'
    || url.pathname !== '/o/oauth2/v2/auth'
    || url.searchParams.getAll('redirect_uri').length !== 1
    || redirect !== CALLBACK) {
    throw new Error('כתובת החיבור ליומן אינה מעודכנת. יש לפתוח מחדש את האפליקציה לאחר עדכון השרת.');
  }
  return url.href;
}
