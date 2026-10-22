import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import egressGate from '../lib/egress/egress-gate.cjs';
import { databaseUrlForProcess } from './database-isolation.mjs';

const PRODUCTION_ORIGIN = 'https://yotibot-azbu.onrender.com';
const TELEGRAM_WEBHOOK_PATHS = new Set([
  '/telegram/webhook',
  '/api/telegram/webhook',
  '/api/public/telegram/webhook',
]);

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function verifiedStagingOrigin(env) {
  const appUrl = validHttpsUrl(env.PUBLIC_APP_URL);
  const expectedUrl = validHttpsUrl(env.STAGING_PUBLIC_APP_URL);
  if (!appUrl || !expectedUrl || appUrl.pathname !== '/' || expectedUrl.pathname !== '/'
    || appUrl.origin !== expectedUrl.origin || appUrl.origin === PRODUCTION_ORIGIN
    || !/(?:^|[.-])staging(?:[.-]|$)/iu.test(appUrl.hostname)) {
    return null;
  }
  return appUrl.origin;
}

function stagingDatabaseIsVerified(env) {
  try {
    databaseUrlForProcess(env);
    return true;
  } catch {
    return false;
  }
}

export function cloudEnvironmentErrors(env) {
  const errors = [];
  const deploymentEnvironment = env.DEPLOYMENT_ENV
    ?? (env.NODE_ENV === 'production' ? 'production' : '');
  const isStaging = deploymentEnvironment === 'staging';
  const isProduction = deploymentEnvironment === 'production';
  if (!isStaging && !isProduction) errors.push('DEPLOYMENT_ENV must be staging or production');
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  if (isStaging && env.CLOUD_CUTOVER_APPROVED !== '0') {
    errors.push('CLOUD_CUTOVER_APPROVED must remain 0 in Staging');
  }
  if (isProduction && env.CLOUD_CUTOVER_APPROVED !== '1') {
    errors.push('CLOUD_CUTOVER_APPROVED must be 1 after an approved cutover');
  }
  if (isStaging && env.DATA_ENVIRONMENT !== 'staging') {
    errors.push('DATA_ENVIRONMENT must be staging for a Staging deployment');
  }
  if (!isStaging && env.DATA_ENVIRONMENT === 'staging') {
    errors.push('Staging data requires DEPLOYMENT_ENV=staging');
  }
  if (isStaging && !stagingDatabaseIsVerified(env)) {
    errors.push('The Staging database identity is missing, mismatched, or unverified');
  }
  if (env.CLERK_AUTH_MODE !== 'external') errors.push('CLERK_AUTH_MODE must be external with a separately configured Clerk application');
  if (env.VITE_CLERK_PUBLISHABLE_KEY?.trim()
      && env.VITE_CLERK_PUBLISHABLE_KEY.trim() !== env.CLERK_PUBLISHABLE_KEY?.trim()) {
    errors.push('Build and runtime Clerk publishable keys must match');
  }
  const requiredKeys = ['DATABASE_URL', 'SESSION_SECRET', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'];
  if (!isStaging || env.TELEGRAM_WORKER_ENABLED === 'true') {
    requiredKeys.push('TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_URL');
  }
  if (isStaging && !['true', 'false'].includes(env.TELEGRAM_WORKER_ENABLED)) {
    errors.push('TELEGRAM_WORKER_ENABLED must be explicitly true or false in Staging');
  }
  for (const key of requiredKeys) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  if (![env.GROQ_API_KEY, env.OPENAI_API_KEY, env.OPENROUTER_API_KEY].some(value => value?.trim())) {
    errors.push('An AI provider key is required');
  }

  if (isStaging) {
    const origin = verifiedStagingOrigin(env);
    if (!origin) errors.push('PUBLIC_APP_URL must match a verified HTTPS Staging origin');
    if (env.TELEGRAM_WEBHOOK_URL) {
      const webhook = validHttpsUrl(env.TELEGRAM_WEBHOOK_URL);
      if (!webhook || !origin || webhook.origin !== origin
        || !TELEGRAM_WEBHOOK_PATHS.has(webhook.pathname)) {
        errors.push('TELEGRAM_WEBHOOK_URL must use the verified Staging origin and webhook path');
      }
    }
    if (env.GOOGLE_CALENDAR_REDIRECT_URI) {
      const expectedRedirect = origin
        ? new URL('/api/mini-app/calendar/callback', origin).href
        : '';
      if (env.GOOGLE_CALENDAR_REDIRECT_URI !== expectedRedirect) {
        errors.push('GOOGLE_CALENDAR_REDIRECT_URI must use the verified Staging origin');
      }
    }
  } else {
    if (env.TELEGRAM_WEBHOOK_URL) {
      const webhook = validHttpsUrl(env.TELEGRAM_WEBHOOK_URL);
      if (!webhook || webhook.origin !== PRODUCTION_ORIGIN
        || !TELEGRAM_WEBHOOK_PATHS.has(webhook.pathname)) {
        errors.push('TELEGRAM_WEBHOOK_URL must be a valid HTTPS webhook URL');
      }
    }
    if (env.PUBLIC_APP_URL !== PRODUCTION_ORIGIN) {
      errors.push('PUBLIC_APP_URL must match the approved Render origin');
    }
    if (env.GOOGLE_CALENDAR_REDIRECT_URI !== `${PRODUCTION_ORIGIN}/api/mini-app/calendar/callback`) {
      errors.push('GOOGLE_CALENDAR_REDIRECT_URI must match the approved Render callback');
    }
  }
  if (!/^\d+$/.test(env.PORT || '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('../lib/egress/bootstrap.cjs');
  const errors = cloudEnvironmentErrors(process.env);
  if (errors.length) {
    // Names only: never print secret values or connection strings.
    console.error(`Cloud startup refused:\n${errors.join('\n')}`);
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const bootstrap = path.join(root, 'lib/egress/bootstrap.cjs');
    const entry = path.join(root, 'artifacts/api-server/dist/index.mjs');
    const child = spawn(process.execPath, ['--enable-source-maps', '--require', bootstrap, entry],
      { cwd: root, env: process.env, stdio: 'inherit' });
    egressGate.getProcessEgressGate()?.registerChild(child);
    process.once('SIGTERM', () => child.kill('SIGTERM'));
    process.once('SIGINT', () => child.kill('SIGINT'));
    child.once('error', () => { console.error('Cloud server could not start'); process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
  }
}
