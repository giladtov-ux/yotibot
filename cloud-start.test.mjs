import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cloudEnvironmentErrors } from './cloud-start.mjs';

const valid = { CLOUD_CUTOVER_APPROVED: '1', NODE_ENV: 'production', PORT: '10000',
  DATABASE_URL: 'synthetic-database', TELEGRAM_BOT_TOKEN: 'synthetic-token',
  SESSION_SECRET: 'synthetic-session', CLERK_SECRET_KEY: 'synthetic-clerk',
  CLERK_PUBLISHABLE_KEY: 'synthetic-public', GROQ_API_KEY: 'synthetic-ai',
  TELEGRAM_WEBHOOK_URL: 'https://example.com/api/telegram/webhook' };

test('approved complete cloud configuration passes without contacting external services', () => {
  assert.deepEqual(cloudEnvironmentErrors(valid), []);
});
test('cutover approval, database, credentials and platform port are required', () => {
  for (const key of ['CLOUD_CUTOVER_APPROVED', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN',
    'SESSION_SECRET', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'GROQ_API_KEY', 'PORT']) {
    assert.ok(cloudEnvironmentErrors({ ...valid, [key]: '' }).length, key);
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
