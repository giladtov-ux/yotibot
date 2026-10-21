import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function cloudEnvironmentErrors(env) {
  const errors = [];
  if (env.CLOUD_CUTOVER_APPROVED !== '1') errors.push('CLOUD_CUTOVER_APPROVED must be 1 after an approved cutover');
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  if (env.CLERK_AUTH_MODE !== 'external') errors.push('CLERK_AUTH_MODE must be external with a separately configured Clerk application');
  if (env.VITE_CLERK_PUBLISHABLE_KEY?.trim()
      && env.VITE_CLERK_PUBLISHABLE_KEY.trim() !== env.CLERK_PUBLISHABLE_KEY?.trim()) {
    errors.push('Build and runtime Clerk publishable keys must match');
  }
  for (const key of ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'SESSION_SECRET', 'TELEGRAM_WEBHOOK_URL',
    'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  if (![env.GROQ_API_KEY, env.OPENAI_API_KEY, env.OPENROUTER_API_KEY].some(value => value?.trim())) {
    errors.push('An AI provider key is required');
  }
  if (env.TELEGRAM_WEBHOOK_URL) {
    try {
      const url = new URL(env.TELEGRAM_WEBHOOK_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.origin !== 'https://yotibot-azbu.onrender.com'
        || !['/telegram/webhook', '/api/telegram/webhook', '/api/public/telegram/webhook'].includes(url.pathname)) throw new Error();
    } catch { errors.push('TELEGRAM_WEBHOOK_URL must be a valid HTTPS webhook URL'); }
  }
  if (env.PUBLIC_APP_URL !== 'https://yotibot-azbu.onrender.com') {
    errors.push('PUBLIC_APP_URL must match the approved Render origin');
  }
  if (env.GOOGLE_CALENDAR_REDIRECT_URI !== 'https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback') {
    errors.push('GOOGLE_CALENDAR_REDIRECT_URI must match the approved Render callback');
  }
  if (!/^\d+$/.test(env.PORT || '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = cloudEnvironmentErrors(process.env);
  if (errors.length) {
    // Names only: never print secret values or connection strings.
    console.error(`Cloud startup refused:\n${errors.join('\n')}`);
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const child = spawn(process.execPath, ['--enable-source-maps', 'artifacts/api-server/dist/index.mjs'],
      { cwd: root, env: process.env, stdio: 'inherit' });
    process.once('SIGTERM', () => child.kill('SIGTERM'));
    process.once('SIGINT', () => child.kill('SIGINT'));
    child.once('error', () => { console.error('Cloud server could not start'); process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
  }
}
