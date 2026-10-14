import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cloudEnvironmentErrors } from './cloud-start.mjs';
import { RENDER_WEBHOOK } from './telegram-render-webhook.mjs';

const valid = { CLOUD_CUTOVER_APPROVED: '1', NODE_ENV: 'production', PORT: '10000',
  DATABASE_URL: 'synthetic-database', TELEGRAM_BOT_TOKEN: 'synthetic-token',
  SESSION_SECRET: 'synthetic-session', CLERK_SECRET_KEY: 'synthetic-clerk',
  CLERK_PUBLISHABLE_KEY: 'synthetic-public', GROQ_API_KEY: 'synthetic-ai',
  CLERK_AUTH_MODE: 'external',
  PUBLIC_APP_URL: 'https://yotibot-azbu.onrender.com',
  GOOGLE_CALENDAR_REDIRECT_URI: 'https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback',
  TELEGRAM_WEBHOOK_URL: 'https://yotibot-azbu.onrender.com/telegram/webhook' };

test('approved complete cloud configuration passes without contacting external services', () => {
  assert.deepEqual(cloudEnvironmentErrors(valid), []);
});
test('Render blueprint and environment template use the same approved webhook as the repair script', () => {
  const blueprint = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.ok(blueprint.includes(`- key: TELEGRAM_WEBHOOK_URL\n        value: ${RENDER_WEBHOOK}`));
  assert.ok(template.split('\n').includes(`TELEGRAM_WEBHOOK_URL=${RENDER_WEBHOOK}`));
  assert.deepEqual(cloudEnvironmentErrors({ ...valid, TELEGRAM_WEBHOOK_URL: RENDER_WEBHOOK }), []);
});
test('cutover approval, database, credentials and platform port are required', () => {
  for (const key of ['CLOUD_CUTOVER_APPROVED', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN',
    'SESSION_SECRET', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_AUTH_MODE',
    'PUBLIC_APP_URL', 'GOOGLE_CALENDAR_REDIRECT_URI', 'GROQ_API_KEY', 'PORT']) {
    assert.ok(cloudEnvironmentErrors({ ...valid, [key]: '' }).length, key);
  }
});
test('stale origins and a managed Clerk mode cannot activate the external service', () => {
  for (const overrides of [
    { PUBLIC_APP_URL: 'https://obsolete.example' },
    { TELEGRAM_WEBHOOK_URL: 'https://obsolete.example/telegram/webhook' },
    { GOOGLE_CALENDAR_REDIRECT_URI: 'https://obsolete.example/api/mini-app/calendar/callback' },
    { CLERK_AUTH_MODE: 'managed' },
    { VITE_CLERK_PUBLISHABLE_KEY: 'synthetic-mismatched-public-key' },
  ]) {
    assert.ok(cloudEnvironmentErrors({ ...valid, ...overrides }).length);
  }
});
test('unsafe webhook configuration is rejected without exposing its value', () => {
  const secretUrl = 'https://user:private@example.com/api/telegram/webhook';
  const errors = cloudEnvironmentErrors({ ...valid, TELEGRAM_WEBHOOK_URL: secretUrl });
  assert.ok(errors.length);
  assert.ok(!errors.join('\n').includes('private'));
});
test('an unapproved CLI invocation exits before starting the API or Telegram worker', () => {
  const result = spawnSync(process.execPath, [new URL('./cloud-start.mjs', import.meta.url).pathname],
    { env: { NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cloud startup refused/);
  assert.ok(!result.stdout.includes('Server listening'));
});
